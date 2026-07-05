import { spawn, type ChildProcess } from 'node:child_process'
import { chmodSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { access, constants, stat } from 'node:fs/promises'

import { AGENT_ENV_SH } from './agent-env-file'
import type { Config } from './config'
import { buildGitIdentityEnv } from './git'
import { logger } from './logger'
import { mergeProjectEnv, type ProjectEnvStore } from './project-env'

const READY_POLL_MS = 100
const BOOT_READY_POLL_MS = 50
const READY_TIMEOUT_MS = 20_000
// Once opencode is READY, the readiness probe becomes a slow LIVENESS check.
// Polling /session every READY_POLL_MS (100ms) forever pegged opencode's Bun
// event loop at ~55% of a CPU core PER IDLE SANDBOX (load-tested 2026-06-16) —
// the dominant cap on warm-sandbox density (~14/host). A crash is already caught
// by proc.on('exit'); after ready we only need an occasional liveness ping, so
// drop to a 5s interval (~50x fewer probes → idle opencode falls to ~2% of a core).
const READY_LIVENESS_MS = 5_000

export const OPENCODE_HOME = '/opt/kortix/home'
const OPENCODE_DATA_HOME = `${OPENCODE_HOME}/.local/share`
const OPENCODE_CONFIG_HOME = `${OPENCODE_HOME}/.config`
const OPENCODE_CACHE_HOME = `${OPENCODE_HOME}/.cache`
const OPENCODE_AUTH_PATH = `${OPENCODE_DATA_HOME}/opencode/auth.json`
const CODEX_AUTH_JSON_SECRET = 'CODEX_AUTH_JSON'
const OPENCODE_AUTH_JSON_SECRET = 'OPENCODE_AUTH_JSON'

// Assemble the inline opencode config (OPENCODE_CONFIG_CONTENT) the daemon hands
// opencode at spawn. It MERGES over the repo's own opencode config and has three
// independent contributors, any of which may apply:
//   1. the Kortix Executor MCP server   (when KORTIX_EXECUTOR_TOKEN + API url)
//   2. the Kortix LLM gateway provider  (when KORTIX_LLM_* env)
//   3. a Slack permission override      (when this is a Slack session)
// If NONE apply there's nothing to inject, so we return undefined and opencode
// just uses the repo config as-is.
export async function buildOpencodeConfigContent(env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const executorToken = env.KORTIX_EXECUTOR_TOKEN
  const apiUrl = env.KORTIX_API_URL
  const llmBaseUrl = env.KORTIX_LLM_BASE_URL
  const llmApiKey = env.KORTIX_LLM_API_KEY

  const hasExecutor = !!executorToken && !!apiUrl
  const hasLlmGateway = !!llmBaseUrl && !!llmApiKey
  // A Slack-provisioned session carries SLACK_CHANNEL_ID / SLACK_THREAD_TS (the
  // session identity the API hands us at boot; also what the in-sandbox `slack`
  // CLI uses to post back to the thread). Contributor #3 keys off it.
  const isSlackSession = !!(env.SLACK_THREAD_TS || env.SLACK_CHANNEL_ID)
  if (!hasExecutor && !hasLlmGateway && !isSlackSession) return undefined

  let base: Record<string, unknown> = {}
  if (env.OPENCODE_CONFIG_CONTENT) {
    try {
      const parsed = JSON.parse(env.OPENCODE_CONFIG_CONTENT)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>
      }
    } catch {
    }
  }
  const out: Record<string, unknown> = { ...base }

  // (1) Kortix Executor MCP server.
  if (hasExecutor) {
    const mcp =
      out.mcp && typeof out.mcp === 'object' && !Array.isArray(out.mcp)
        ? (out.mcp as Record<string, unknown>)
        : {}
    out.mcp = {
      ...mcp,
      'vaelorx-executor': {
        type: 'local',
        // The Executor MCP server is a face of the unified `kortix` CLI
        // (`kortix executor mcp`), baked onto PATH in every sandbox image.
        command: ['vaelorx', 'executor', 'mcp'],
        enabled: true,
        environment: {
          KORTIX_EXECUTOR_TOKEN: executorToken,
          KORTIX_API_URL: apiUrl,
          // Lets the CLI target the project-explicit gateway route. Optional —
          // the session token also pins the project for the legacy flat route,
          // so this is belt-and-suspenders.
          ...(env.KORTIX_PROJECT_ID ? { KORTIX_PROJECT_ID: env.KORTIX_PROJECT_ID } : {}),
        },
      },
    }
  }

  // (2) LLM gateway provider.
  if (hasLlmGateway) {
    const provider =
      out.provider && typeof out.provider === 'object' && !Array.isArray(out.provider)
        ? (out.provider as Record<string, unknown>)
        : {}

    // Use a custom "vaelorx" provider for ALL gateway types (OpenRouter, NVIDIA,
    // OpenCode Zen, etc.). The @ai-sdk/openai-compatible npm package works with
    // any OpenAI-compatible endpoint, and we explicitly list the models fetched
    // from the gateway's /models endpoint so OpenCode never marks them disabled.
    //
    // We DO NOT use OpenCode's built-in "opencode" provider for Zen, because
    // that provider's internal catalog (from Models.dev) may not include every
    // model Zen actually serves (e.g. deepseek-v4-flash-free). OpenCode would
    // then say "Model is disabled" even though Zen's /models lists it.
    const DEFAULT_VAELORX_MODEL = getDefaultVaelorxModel(env)
    const gatewayModels = await fetchGatewayModels(llmBaseUrl!, llmApiKey!)
    // Make absolutely sure the default model is in the catalog (the gateway
    // should already return it, but if the fetch fell back to MINIMAL_FALLBACK
    // we add it explicitly so OpenCode never marks it disabled).
    if (gatewayModels[DEFAULT_VAELORX_MODEL] === undefined) {
      logger.warn(`[opencode] default model "${DEFAULT_VAELORX_MODEL}" not in gateway catalog — adding it`)
      gatewayModels[DEFAULT_VAELORX_MODEL] = {
        name: DEFAULT_VAELORX_MODEL,
        tool_call: true,
        attachment: true,
        temperature: true,
      }
    }
    // Reorder: put the default model FIRST so OpenCode picks it as default
    const orderedModels: Record<string, VaelorXGatewayModel> = {}
    orderedModels[DEFAULT_VAELORX_MODEL] = gatewayModels[DEFAULT_VAELORX_MODEL]
    for (const [key, val] of Object.entries(gatewayModels)) {
      if (key !== DEFAULT_VAELORX_MODEL) orderedModels[key] = val
    }
    out.provider = {
      ...provider,
      vaelorx: {
        npm: '@ai-sdk/openai-compatible',
        name: 'VaelorX',
        options: {
          baseURL: llmBaseUrl,
          apiKey: llmApiKey,
        },
        models: withModelLimits(orderedModels),
      },
    }
    const modelWithPrefix = `vaelorx/${DEFAULT_VAELORX_MODEL}`
    out.model = modelWithPrefix
    out.small_model = modelWithPrefix

    // Lock opencode to the gateway as the ONLY LLM path. enabled_providers is an
    // allowlist — opencode loads ONLY these and ignores every provider it would
    // otherwise auto-detect from env (e.g. GITHUB_TOKEN → GitHub Models,
    // OPENAI_API_KEY → openai), so a leaked key can't open a native path that
    // bypasses budgets/logging/spend. This is the robust complement to the env
    // deny-strip in spawnChild (which can be defeated if a key reaches opencode
    // by some path the deny-list didn't enumerate). We keep `kortix` plus any
    // providers the Codex/OpenCode subscription auth.json enables — those are the
    // user's own subscription (consumed into auth.json, intentionally not gated).
    const allowList = gatewayEnabledProviders(env)
    if (!allowList.includes('vaelorx')) allowList.push('vaelorx')
    // Note: we intentionally do NOT remove 'opencode' here. If the user has
    // an OpenCode Zen subscription via auth.json (configured through OpenCode's
    // /connect command), gatewayEnabledProviders() will include 'opencode' —
    // that's the user's own subscription and should keep working. We just make
    // sure 'vaelorx' (our gateway provider) is also enabled.
    out.enabled_providers = allowList

    // Set default_agent to 'vaelorx' and add a vaelorx agent definition with
    // the explicit model. Without this, OpenCode falls back to its built-in
    // 'build' agent (with model 'big-pickle' from the 'opencode' provider),
    // which causes "Model not found: opencode/big-pickle" because 'opencode'
    // isn't in enabled_providers.
    out.default_agent = 'vaelorx'
    const agents = (out.agent && typeof out.agent === 'object' && !Array.isArray(out.agent))
      ? (out.agent as Record<string, unknown>)
      : {}
    const DEFAULT_VAELORX_MODEL_FOR_AGENT = getDefaultVaelorxModel(env)
    agents.vaelorx = {
      ...(agents.vaelorx as Record<string, unknown> | undefined),
      description: 'VaelorX AI agent — handles coding, research, content, and data tasks.',
      mode: 'primary',
      model: `vaelorx/${DEFAULT_VAELORX_MODEL_FOR_AGENT}`,
      permission: { '*': 'allow' },
    }
    out.agent = agents
  }

  // (3) Slack sessions: DENY opencode's blocking `question` tool. A Slack thread
  // is async — there's no live form to answer a synchronous question, so the
  // agent must ask via `slack send` instead; a `question` call would otherwise
  // stall the turn. The web dashboard keeps the tool (it answers `question.asked`
  // natively over opencode's SSE). This is the "make it impossible" half of the
  // fix; the in-box question relay stays as a safety net (and the only path if a
  // project's agent overrides this with its own `"*": "allow"`).
  if (isSlackSession) {
    const permission =
      out.permission && typeof out.permission === 'object' && !Array.isArray(out.permission)
        ? (out.permission as Record<string, unknown>)
        : {}
    out.permission = { ...permission, question: 'deny' }
  }

  return JSON.stringify(out)
}

// The opencode provider allowlist when the gateway is active: always `kortix`,
// plus any providers the Codex/OpenCode subscription auth.json declares (its
// top-level keys are provider ids) so a connected subscription keeps working.
// The auth secret is still present on the env passed here — materializeOpencodeAuth
// strips it from the spawned process env later, not from this copy.
function gatewayEnabledProviders(env: NodeJS.ProcessEnv): string[] {
  const allow = new Set<string>(['vaelorx'])
  const authJson = env[CODEX_AUTH_JSON_SECRET] ?? env[OPENCODE_AUTH_JSON_SECRET]
  if (authJson?.trim()) {
    try {
      const parsed = JSON.parse(authJson)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const provider of Object.keys(parsed)) allow.add(provider)
      }
    } catch {
    }
  }
  return [...allow]
}

export const buildExecutorMcpConfigContent = buildOpencodeConfigContent

const GATEWAY_MODELS_RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000]

async function fetchGatewayModels(
  baseUrl: string,
  apiKey: string,
): Promise<Record<string, VaelorXGatewayModel>> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  const attempts = GATEWAY_MODELS_RETRY_DELAYS_MS.length + 1
  logger.info(`[opencode] fetching gateway models from ${url}`)
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      // Some upstreams (e.g. opencode.ai/zen) sit behind Cloudflare which
      // blocks requests with no/Node-style User-Agent (HTTP 1010). Send a
      // realistic browser UA to avoid being filtered.
      const res = await fetch(url, {
        headers: {
          authorization: `Bearer ${apiKey}`,
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          accept: 'application/json',
        },
      })
      if (!res.ok) {
        const detail = (await res.text().catch(() => '')).slice(0, 200)
        throw new Error(`HTTP ${res.status}${detail ? ` ${detail}` : ''}`)
      }
      const body = (await res.json()) as {
        // Kortix gateway format (rare): { models: { "id": {...} } }
        models?: Record<string, VaelorXGatewayModel>
        // OpenAI / OpenRouter / Zen format: { data: [{ id: "...", ... }] }
        data?: Array<{ id?: string; [k: string]: unknown }>
      }
      // Normalize BOTH response shapes to a Record<modelId, modelMeta>.
      // OpenCode's catalog expects the latter; the OpenAI-style array
      // (which is what BOTH the Kortix gateway and OpenCode Zen actually
      // return — see apps/api/src/llm-gateway/routes/models.ts) needs
      // converting.
      let models: Record<string, VaelorXGatewayModel> | undefined = body.models
      if (!models && Array.isArray(body.data)) {
        models = {}
        for (const entry of body.data) {
          const id = typeof entry?.id === 'string' ? entry.id : undefined
          if (!id) continue
          models[id] = {
            name: typeof entry.name === 'string' ? entry.name : id,
            reasoning: typeof entry.reasoning === 'boolean' ? entry.reasoning : undefined,
            tool_call: typeof entry.tool_call === 'boolean' ? entry.tool_call : true,
            attachment: typeof entry.attachment === 'boolean' ? entry.attachment : true,
            temperature: typeof entry.temperature === 'boolean' ? entry.temperature : true,
          }
        }
      }
      if (!models || Object.keys(models).length === 0) {
        throw new Error('gateway returned an empty catalog')
      }
      logger.info(`[opencode] fetched ${Object.keys(models).length} gateway models from ${url}`)
      return models
    } catch (err) {
      logger.warn(
        `[opencode] gateway models fetch failed (attempt ${attempt + 1}/${attempts}) ${url}: ${(err as Error).message}`,
      )
      const delay = GATEWAY_MODELS_RETRY_DELAYS_MS[attempt]
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  logger.error(`[opencode] gateway models unavailable after ${attempts} attempts (${url}); using minimal fallback`)
  return MINIMAL_FALLBACK_MODELS
}

// Default model — read from env var (set by API from platform_settings/platform_models).
// The value should be a model id that exists in the gateway's /models response.
// Falls back to "anthropic/claude-sonnet-4.6" if not set.
// Note: NO "vaelorx/" prefix — the gateway proxies to OpenRouter which expects
// provider/model format. The "vaelorx" prefix is only the opencode provider name,
// not part of the model id sent to the upstream.
//
// IMPORTANT: This is computed INSIDE buildOpencodeConfigContent() from the `env`
// parameter, NOT at module load time. The previous module-level constant read
// process.env at import time, which was fragile (if the env var wasn't set yet
// when the module loaded, it fell back to the wrong default). The function below
// reads from the `env` parameter which is the actual session env.
function getDefaultVaelorxModel(env: NodeJS.ProcessEnv): string {
  return env.KORTIX_DEFAULT_MODEL?.trim() || 'anthropic/claude-sonnet-4.6'
}

type VaelorXGatewayModel = {
  name: string
  reasoning?: boolean
  tool_call?: boolean
  attachment?: boolean
  temperature?: boolean
  limit?: { context?: number; output?: number }
}

const MINIMAL_FALLBACK_MODELS: Record<string, VaelorXGatewayModel> = {
  'claude-opus-4.8': {
    name: 'Claude Opus 4.8',
    reasoning: true,
    tool_call: true,
    attachment: true,
    temperature: true,
    limit: { context: 1_000_000, output: 64_000 },
  },
  'claude-sonnet-4.6': {
    name: 'Claude Sonnet 4.6',
    reasoning: true,
    tool_call: true,
    attachment: true,
    temperature: true,
    limit: { context: 1_000_000, output: 64_000 },
  },
  'openai/gpt-5.5': {
    name: 'GPT-5.5',
    reasoning: true,
    tool_call: true,
    attachment: true,
    temperature: true,
    limit: { context: 1_050_000, output: 64_000 },
  },
  'google/gemini-3.5-flash': {
    name: 'Gemini 3.5 Flash',
    reasoning: true,
    tool_call: true,
    attachment: true,
    temperature: true,
    limit: { context: 1_048_576, output: 65_536 },
  },
  'google/gemini-3.1-pro-preview': {
    name: 'Gemini 3.1 Pro',
    reasoning: true,
    tool_call: true,
    attachment: true,
    temperature: true,
    limit: { context: 1_048_576, output: 65_536 },
  },
  'deepseek/deepseek-v4-flash': {
    name: 'DeepSeek V4 Flash',
    reasoning: true,
    tool_call: true,
    attachment: true,
    temperature: true,
    limit: { context: 1_048_576, output: 64_000 },
  },
  // OpenCode Zen exposes this free tier — make sure it's always in the
  // fallback catalog too, so OpenCode never marks it disabled even if the
  // /models fetch fails entirely.
  'deepseek-v4-flash-free': {
    name: 'DeepSeek V4 Flash (Free)',
    reasoning: true,
    tool_call: true,
    attachment: true,
    temperature: true,
    limit: { context: 1_048_576, output: 64_000 },
  },
  'deepseek/deepseek-v4-pro': {
    name: 'DeepSeek V4 Pro',
    reasoning: true,
    tool_call: true,
    attachment: true,
    temperature: true,
    limit: { context: 1_048_576, output: 64_000 },
  },
  'minimax/minimax-m3': {
    name: 'MiniMax M3',
    reasoning: true,
    tool_call: true,
    attachment: true,
    temperature: true,
    limit: { context: 1_048_576, output: 64_000 },
  },
  'moonshotai/kimi-k2.6': {
    name: 'Kimi K2.6',
    reasoning: true,
    tool_call: true,
    attachment: true,
    temperature: true,
    limit: { context: 262_144, output: 64_000 },
  },
  'z-ai/glm-5.1': {
    name: 'GLM 5.1',
    reasoning: true,
    tool_call: true,
    attachment: true,
    temperature: true,
    limit: { context: 202_752, output: 64_000 },
  },
  'x-ai/grok-4.3': {
    name: 'Grok 4.3',
    reasoning: true,
    tool_call: true,
    attachment: true,
    temperature: true,
    limit: { context: 1_000_000, output: 64_000 },
  },
}

// Conservative window for a model we have no declared limit for. Better to
// compact a little early than to never compact and get stuck at the wall.
const DEFAULT_MODEL_LIMIT = { context: 200_000, output: 32_000 } as const

// Known limits indexed by bare model id (the tail after the last "/"), so a
// catalog model offered under any provider prefix (e.g.
// "alibaba-cn/deepseek-v4-flash") still resolves to the right window.
const KNOWN_LIMIT_BY_TAIL: Record<string, { context?: number; output?: number }> = (() => {
  const out: Record<string, { context?: number; output?: number }> = {}
  for (const [id, model] of Object.entries(MINIMAL_FALLBACK_MODELS)) {
    if (!model.limit) continue
    out[id.split('/').pop() ?? id] = model.limit
  }
  return out
})()

// Guarantee every model carries a context window. The gateway /models endpoint
// returns NO per-model limits, so without this OpenCode sees models with no
// context limit, can't size the conversation, and auto-compaction never fires —
// long sessions then blow past the window and get stuck (session pinned at 100%
// context). Backfill from the known-model table (exact id, then bare id), else a
// conservative default. Models that already declare a usable limit are untouched.
export function withModelLimits(
  models: Record<string, VaelorXGatewayModel>,
): Record<string, VaelorXGatewayModel> {
  const out: Record<string, VaelorXGatewayModel> = {}
  for (const [id, model] of Object.entries(models)) {
    if (typeof model.limit?.context === 'number' && model.limit.context > 0) {
      out[id] = model
      continue
    }
    const known = MINIMAL_FALLBACK_MODELS[id]?.limit ?? KNOWN_LIMIT_BY_TAIL[id.split('/').pop() ?? id]
    out[id] = { ...model, limit: known ?? { ...DEFAULT_MODEL_LIMIT } }
  }
  return out
}

function materializeOpencodeAuth(env: NodeJS.ProcessEnv) {
  const authJson = env[CODEX_AUTH_JSON_SECRET] ?? env[OPENCODE_AUTH_JSON_SECRET]
  delete env[CODEX_AUTH_JSON_SECRET]
  delete env[OPENCODE_AUTH_JSON_SECRET]
  if (!authJson?.trim()) return

  try {
    const parsed = JSON.parse(authJson)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('auth json must be an object')
    }

    mkdirSync(dirname(OPENCODE_AUTH_PATH), { recursive: true })
    writeFileSync(OPENCODE_AUTH_PATH, JSON.stringify(parsed, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    })
    chmodSync(OPENCODE_AUTH_PATH, 0o600)
    logger.info('[opencode] materialized project-scoped Codex auth.json')
  } catch (err) {
    logger.warn('[opencode] ignored invalid Codex/OpenCode auth project secret', {
      err: (err as Error).message,
    })
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function which(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', `command -v ${bin}`])
    let out = ''
    child.stdout.on('data', (d) => (out += d.toString()))
    child.on('close', (code) => resolve(code === 0 ? out.trim() || null : null))
    child.on('error', () => resolve(null))
  })
}

async function detectOpencodeBinary(): Promise<string | null> {
  if (await isExecutable('/usr/local/bin/opencode-kortix')) {
    return '/usr/local/bin/opencode-kortix'
  }
  return await which('opencode')
}

async function resolveOpencodeCwd(cfg: Config): Promise<string> {
  try {
    const project = await stat(cfg.projectTarget)
    if (project.isDirectory()) return cfg.projectTarget
  } catch {}
  return cfg.workspace
}

type OpencodeState = 'starting' | 'ok' | 'down'

export type Opencode = {
  start(): Promise<void>
  stop(signal?: NodeJS.Signals): Promise<void>
  restart(): Promise<void>
  reconfigure(nextCfg: Config, nextOpencodeConfigDir: string, nextProjectEnv?: ProjectEnvStore): void
  getPid(): number | null
  getInternalUrl(): string
  getBinaryPath(): string | null
  getState(): OpencodeState
  markReady(): void
}

export function createOpencodeSupervisor(
  cfg: Config,
  opencodeConfigDir: string,
  projectEnv?: ProjectEnvStore,
): Opencode {
  let currentCfg = cfg
  let currentOpencodeConfigDir = opencodeConfigDir
  let currentProjectEnv = projectEnv
  let child: ChildProcess | null = null
  let binaryPath: string | null = null
  let stopping = false
  let restartDelayMs = 500
  let state: OpencodeState = 'starting'
  let readinessTimer: ReturnType<typeof setTimeout> | null = null
  let opencodeCwd = cfg.workspace

  function ensureCwdExists(): string {
    try {
      mkdirSync(opencodeCwd, { recursive: true })
      return opencodeCwd
    } catch (err) {
      logger.warn('[opencode] could not mkdir cwd, falling back to /', { opencodeCwd, err: (err as Error).message })
      return '/'
    }
  }

  function sweepBunExtractions() {
    const tmp = process.env.TMPDIR || '/tmp'
    try {
      for (const name of readdirSync(tmp)) {
        if (name.endsWith('-00000000.so')) {
          try { unlinkSync(join(tmp, name)) } catch {}
        }
      }
    } catch {}
  }

  async function spawnChild(bin: string) {
    sweepBunExtractions()
    try {
      mkdirSync(OPENCODE_HOME, { recursive: true })
    } catch (err) {
      logger.warn('[opencode] could not create home dir; falling back to inherited HOME', {
        opencodeHome: OPENCODE_HOME,
        err: (err as Error).message,
      })
    }
    const baseEnv = currentProjectEnv ? mergeProjectEnv(process.env, currentProjectEnv) : process.env
    const env: NodeJS.ProcessEnv = {
      ...baseEnv,
      ...buildGitIdentityEnv(currentCfg),
      HOME: OPENCODE_HOME,
      XDG_DATA_HOME: OPENCODE_DATA_HOME,
      XDG_CONFIG_HOME: OPENCODE_CONFIG_HOME,
      XDG_CACHE_HOME: OPENCODE_CACHE_HOME,
      OPENCODE_CONFIG_DIR: currentOpencodeConfigDir,
      // Every non-interactive shell opencode spawns (`bash -c`) sources this,
      // so live project secrets reach the agent's commands without any
      // opencode plugin/config. Interactive shells + terminals get it from the
      // image-baked /etc/profile.d + /etc/bash.bashrc hooks instead.
      BASH_ENV: AGENT_ENV_SH,
      PORT: undefined,
      APP_PORT: undefined,
    }

    materializeOpencodeAuth(env)

    // Withhold provider API keys (ANTHROPIC_API_KEY, OPENAI_API_KEY, …) from the
    // opencode process. With any such key in its env, opencode auto-connects a
    // NATIVE provider and calls it directly — bypassing the gateway (no logs /
    // spend / budgets) and leaving stale models that survive a BYOK disconnect.
    // The gateway must be the only LLM path, so the API hands us the exact names
    // to strip (Codex/OpenCode subscription auth is excluded — it's already been
    // consumed into auth.json by materializeOpencodeAuth above). This only touches
    // the opencode process env; it doesn't change what the container itself holds.
    const denyEnv = (env.KORTIX_OPENCODE_DENY_ENV || '').split(',').map((n) => n.trim()).filter(Boolean)
    let withheld = 0
    for (const name of denyEnv) {
      if (name in env) {
        delete env[name]
        withheld++
      }
    }
    if (withheld > 0) {
      logger.info(`[opencode] withheld ${withheld} provider credential(s) from opencode (gateway-only routing)`)
    }

    // Boot profiling: when KORTIX_OPENCODE_DEBUG=1, ask opencode to emit its own
    // verbose startup logs (interleaved into the daemon log via inherited
    // stdio) so a real cold boot reveals where the spawn→ready window goes.
    // Opt-in only — no log noise in normal operation.
    if (process.env.KORTIX_OPENCODE_DEBUG === '1') {
      env.OPENCODE_LOG_LEVEL = 'DEBUG'
    }

    const opencodeConfig = await buildOpencodeConfigContent(baseEnv)
    if (opencodeConfig) {
      // The assembled config carries the gateway's full model catalog, which is
      // ~400KB — far over Linux's 128KB per-env-var ceiling (MAX_ARG_STRLEN).
      // Inlining it via OPENCODE_CONFIG_CONTENT makes execve fail with E2BIG and
      // opencode never spawns ("runtime not ready"). Hand it a file path instead.
      const configPath = join(OPENCODE_CONFIG_HOME, 'vaelorx-opencode.json')
      mkdirSync(dirname(configPath), { recursive: true })
      writeFileSync(configPath, opencodeConfig, { mode: 0o600 })
      env.OPENCODE_CONFIG = configPath
      delete env.OPENCODE_CONFIG_CONTENT
      logger.info(`[opencode] wrote config (${opencodeConfig.length} bytes) to ${configPath}`)

      // ALSO write the config to the project's opencode.jsonc. Per OpenCode's
      // config precedence (https://opencode.ai/docs/config/), the project config
      // (priority 4) OVERRIDES the custom config from OPENCODE_CONFIG (priority 3).
      // By writing to BOTH locations, we guarantee our model + provider settings
      // are seen by OpenCode regardless of which source it reads first.
      // This fixes "Model not found: opencode/big-pickle" — which happened because
      // OpenCode fell back to its built-in default model when our OPENCODE_CONFIG
      // wasn't being read correctly.
      const projectConfigPath = join(currentOpencodeConfigDir, 'opencode.jsonc')
      try {
        mkdirSync(currentOpencodeConfigDir, { recursive: true })
        writeFileSync(projectConfigPath, opencodeConfig, { mode: 0o600 })
        logger.info(`[opencode] also wrote config to project dir ${projectConfigPath}`)
      } catch (err) {
        logger.warn(`[opencode] failed to write project config to ${projectConfigPath}`, { err: (err as Error).message })
      }
    }

    const args = [
      'serve',
      '--port',
      String(currentCfg.opencodeInternalPort),
      '--hostname',
      '127.0.0.1',
    ]

    const cwd = ensureCwdExists()
    logger.info('[opencode] spawning', { bin, port: currentCfg.opencodeInternalPort, cwd })
    const proc = spawn(bin, args, {
      cwd,
      env,
      stdio: ['ignore', 'inherit', 'inherit'],
    })

    proc.on('exit', (code, signal) => {
      logger.warn('[opencode] child exited', { code, signal })
      child = null
      state = stopping ? 'down' : 'starting'
      if (stopping) return
      const delay = restartDelayMs
      restartDelayMs = Math.min(restartDelayMs * 2, 30_000)
      logger.info('[opencode] restarting', { delayMs: delay })
      setTimeout(() => {
        if (!stopping && binaryPath) void spawnChild(binaryPath)
      }, delay)
    })

    proc.on('error', (err) => {
      logger.error('[opencode] spawn error', err)
    })

    child = proc
  }

  function markReady() {
    if (state !== 'ok') logger.info('[opencode] ready')
    state = 'ok'
    restartDelayMs = 500
  }

  async function checkReady(): Promise<boolean> {
    return probeOpencodeSessionApi(`http://127.0.0.1:${currentCfg.opencodeInternalPort}`, currentCfg.projectTarget, 2_000)
  }

  function scheduleReadinessProbe() {
    if (stopping) return
    // Poll fast until ready (quick boot detection), then slow to a liveness ping.
    // The forever-100ms poll cost ~55% of a core per idle sandbox (READY_LIVENESS_MS).
    const interval = state === 'ok' ? READY_LIVENESS_MS : READY_POLL_MS
    readinessTimer = setTimeout(async () => {
      if (stopping) return
      const ready = await checkReady()
      if (ready) {
        markReady()
      } else if (state !== 'starting') {
        state = 'starting'
      }
      scheduleReadinessProbe()
    }, interval)
  }

  return {
    async start() {
      stopping = false
      state = 'starting'
      const bin = await detectOpencodeBinary()
      if (!bin) {
        logger.warn('[opencode] binary not found on PATH (and /usr/local/bin/opencode-kortix missing); daemon will continue, opencode reports as starting')
        state = 'starting'
        scheduleReadinessProbe()
        return
      }
      binaryPath = bin
      opencodeCwd = await resolveOpencodeCwd(currentCfg)
      try {
        await spawnChild(bin)
      } catch (err) {
        logger.error('[opencode] initial spawn failed', err)
      }
      scheduleReadinessProbe()
    },

    async stop(signal: NodeJS.Signals = 'SIGTERM') {
      stopping = true
      state = 'down'
      if (readinessTimer) {
        clearTimeout(readinessTimer)
        readinessTimer = null
      }
      if (!child) return
      const c = child
      return new Promise<void>((resolve) => {
        const onExit = () => resolve()
        c.once('exit', onExit)
        try {
          c.kill(signal)
        } catch {
          resolve()
          return
        }
        // Hard kill if the child ignores SIGTERM.
        setTimeout(() => {
          try {
            c.kill('SIGKILL')
          } catch {}
          resolve()
        }, 5_000).unref()
      })
    },

    async restart() {
      await this.stop('SIGTERM')
      restartDelayMs = 500
      await this.start()
    },

    reconfigure(nextCfg: Config, nextOpencodeConfigDir: string, nextProjectEnv?: ProjectEnvStore) {
      currentCfg = nextCfg
      currentOpencodeConfigDir = nextOpencodeConfigDir
      if (nextProjectEnv) currentProjectEnv = nextProjectEnv
      state = 'starting'
      logger.info('[opencode] reconfigured', {
        projectId: nextCfg.projectId,
        opencodeConfigDir: nextOpencodeConfigDir,
      })
    },

    getPid() {
      return child?.pid ?? null
    },

    getInternalUrl() {
      return `http://127.0.0.1:${currentCfg.opencodeInternalPort}`
    },

    getBinaryPath() {
      return binaryPath
    },

    getState() {
      return state
    },

    markReady,
  }
}

/**
 * Probe the same OpenCode API the app needs. A plain process/HTTP health route
 * is too weak because OpenCode can bind while the project directory is still
 * unusable for real session APIs.
 */
async function probeOpencodeSessionApi(
  baseUrl: string,
  directory: string,
  timeoutMs = 1_000,
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/session?directory=${encodeURIComponent(directory)}`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    return res.status >= 200 && res.status < 400
  } catch {
    return false
  }
}

/**
 * Tail-readiness probe used at boot to deadline-bound the first ready state.
 * Returns true if opencode reported ready before the deadline, false otherwise.
 * Non-throwing — the daemon should boot even on false so we can report `starting`.
 */
export async function waitForOpencodeReady(
  opencode: Opencode,
  directory?: string,
  // Boot-profiling hook: fired once the moment opencode's port answers ANY
  // HTTP (process bound + listening), which is strictly before /session serves
  // 200 (== ready). The gap between this and `opencode-ready` localizes the
  // cold-start cost: a big spawn→listening gap = process/runtime startup; a big
  // listening→ready gap = opencode's internal app/session init.
  onListening?: () => void,
): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  let listeningSeen = false
  while (Date.now() < deadline) {
    if (opencode.getState() === 'ok') return true
    if (directory) {
      const probe = await probeOpencodeReadiness(opencode.getInternalUrl(), directory, 500)
      if (probe !== 'down' && !listeningSeen) {
        listeningSeen = true
        onListening?.()
      }
      if (probe === 'ready') {
        opencode.markReady()
        return true
      }
    }
    await new Promise((r) => setTimeout(r, directory ? BOOT_READY_POLL_MS : READY_POLL_MS))
  }
  return false
}

/** Richer boot probe: 'down' = port not answering at all, 'listening' = answers
 *  HTTP but /session not 2xx yet, 'ready' = /session 2xx/3xx. */
async function probeOpencodeReadiness(
  baseUrl: string,
  directory: string,
  timeoutMs: number,
): Promise<'down' | 'listening' | 'ready'> {
  try {
    const res = await fetch(`${baseUrl}/session?directory=${encodeURIComponent(directory)}`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    return res.status >= 200 && res.status < 400 ? 'ready' : 'listening'
  } catch {
    return 'down'
  }
}
