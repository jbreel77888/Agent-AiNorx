import { Hono } from 'hono'

import type { Config } from './config'
import { logger } from './logger'
import type { Opencode } from './opencode'
import { isRepoMaterialized } from './git'
import { createHealthRouter, type SandboxBootState } from './routes/health'
import { createRefreshRouter } from './routes/refresh'
import { createAbortRouter } from './routes/abort'
import { createEnvRouter } from './routes/env'
import { createGitRouter } from './routes/git'
import { createPortProxyRouter } from './routes/port-proxy'
import { createFilesRouter } from './routes/files'
import { createFindRouter } from './routes/find'
import webProxyRouter from './routes/web-proxy'
import type { ProjectEnvStore } from './project-env'
import {
  KORTIX_USER_CONTEXT_HEADER,
  verifyKortixUserContext,
} from './kortix-user-context'

// Headers that must not be forwarded — they're connection-scoped or set by us.
const STRIP_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
])

const STRIP_RESPONSE_HEADERS = new Set(['transfer-encoding', 'connection'])

export function buildOpencodeApp(
  cfg: Config,
  opencode: Opencode,
  bootTime: number,
  bootState: SandboxBootState = { repoMaterializationError: null, timeline: [] },
  projectEnv?: ProjectEnvStore,
  staticWebPort: number | null = null,
): Hono {
  const app = new Hono()

  // The daemon owns a small Kortix-namespaced control surface. Everything else is
  // pure passthrough to opencode. Mount at both `/health` and `/health/` so
  // a trailing slash doesn't fall through to the reverse proxy.
  // Health bypasses auth — it's how the cloud probes liveness mid-boot.
  const kortixRouter = new Hono()
  const healthRouter = createHealthRouter(cfg, opencode, bootTime, bootState, staticWebPort)
  const refreshRouter = createRefreshRouter(cfg, opencode)
  const abortRouter = createAbortRouter(cfg)
  const envRouter = projectEnv ? createEnvRouter(cfg, opencode, projectEnv) : null
  // NOTE: /kortix/git is currently unused by the product (the agent commits +
  // opens change requests from a chat prompt). Kept as a host-driven primitive.
  const gitRouter = createGitRouter(cfg)
  kortixRouter.route('/health', healthRouter)
  kortixRouter.route('/health/', healthRouter)
  kortixRouter.route('/refresh', refreshRouter)
  kortixRouter.route('/refresh/', refreshRouter)
  kortixRouter.route('/abort', abortRouter)
  kortixRouter.route('/abort/', abortRouter)
  kortixRouter.route('/git', gitRouter)
  kortixRouter.route('/git/', gitRouter)
  if (envRouter) {
    kortixRouter.route('/env', envRouter)
    kortixRouter.route('/env/', envRouter)
  }

  app.route('/kortix', kortixRouter)

  // Auth gate for everything except /kortix/*. Spec §3.5: the daemon MUST
  // validate X-Kortix-User-Context (HMAC-signed by the API with KORTIX_TOKEN)
  // before forwarding to opencode. Without a configured token the daemon is
  // an open door; we log loudly at boot and reject all proxied requests until
  // KORTIX_TOKEN is provided.
  app.use('*', async (c, next) => {
    const path = new URL(c.req.url).pathname
    if (path.startsWith('/kortix/')) return next()

    if (!cfg.sandboxToken) {
      logger.warn('[proxy] rejecting request: KORTIX_TOKEN not configured')
      return c.json({ error: 'daemon not configured', detail: 'KORTIX_TOKEN unset' }, 503)
    }

    const header = c.req.header(KORTIX_USER_CONTEXT_HEADER)
    const result = verifyKortixUserContext(header, cfg.sandboxToken)
    if (!result.ok) {
      logger.warn('[proxy] reject', { reason: result.reason, path })
      return c.json({ error: 'unauthorized', reason: result.reason }, 401)
    }

    return next()
  })

  // /proxy/{port}/* — per-port reverse proxy to anything bound on localhost
  // inside the sandbox (the "internal browser" backend). Carried over from
  // legacy kortix-master so any process the agent starts (e.g. `python -m
  // http.server 8080`) is reachable via /v1/p/{sandboxId}/{port}/* on the API.
  // The agent server's own port is blocked to prevent recursion; opencode's
  // internal port is reachable via the catch-all below, not /proxy.
  const portProxyRouter = createPortProxyRouter({
    blockedPorts: new Set([cfg.servicePort]),
  })
  app.route('/proxy', portProxyRouter)

  // /web-proxy/{scheme}/{host}/{path} — forward proxy that rewrites HTML/CSS
  // so external sites embed cleanly inside the internal browser iframe.
  app.route('/web-proxy', webProxyRouter)

  // /file/* — the daemon owns the ENTIRE file API: reads (GET / list,
  // /content, /raw, /status) and writes (upload, delete, mkdir, rename). We do
  // NOT forward file reads to OpenCode — its /file/content base64-inlines
  // images only and returns empty content for every other binary, breaking
  // Office-doc/PDF previews and downloads. Serving off disk here is correct for
  // all types. (/project/current + /global/health still fall through.)
  app.route('/file', createFilesRouter(cfg))

  // /find/* — daemon-served search (file-by-name + ripgrep text search), also
  // formerly forwarded to OpenCode.
  app.route('/find', createFindRouter(cfg))

  // ─── Dynamic default model cache ───────────────────────────────────────
  // The admin can change the default model at any time. The daemon's local
  // KORTIX_DEFAULT_MODEL env var is set at boot and may be stale. To always
  // display the CURRENT default model in OpenCode's UI, we fetch it from the
  // gateway's /models endpoint (which returns is_default:true on the admin's
  // choice) and cache it for 30 seconds. This is a tiny GET with no body, so
  // the latency cost is negligible.
  let cachedDefaultModel: { model: string | null; fetchedAt: number } = {
    model: null,
    fetchedAt: 0,
  };
  const DEFAULT_MODEL_CACHE_MS = 30_000; // 30s

  async function fetchCurrentDefaultModel(): Promise<string | null> {
    const now = Date.now();
    if (
      cachedDefaultModel.model &&
      now - cachedDefaultModel.fetchedAt < DEFAULT_MODEL_CACHE_MS
    ) {
      return cachedDefaultModel.model;
    }
    const llmBaseUrl = process.env.KORTIX_LLM_BASE_URL?.trim();
    const llmApiKey = process.env.KORTIX_LLM_API_KEY?.trim();
    if (!llmBaseUrl || !llmApiKey) {
      // No gateway configured — fall back to env var
      return process.env.KORTIX_DEFAULT_MODEL?.trim() || null;
    }
    try {
      const url = `${llmBaseUrl.replace(/\/+$/, '')}/models`;
      const res = await fetch(url, {
        headers: {
          authorization: `Bearer ${llmApiKey}`,
          'user-agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const body = (await res.json()) as {
        data?: Array<{ id?: string; is_default?: boolean }>;
      };
      if (Array.isArray(body.data)) {
        // Find the model with is_default=true
        const defaultEntry = body.data.find((m) => m?.is_default === true);
        if (defaultEntry?.id) {
          cachedDefaultModel = { model: defaultEntry.id, fetchedAt: now };
          return defaultEntry.id;
        }
      }
      // No is_default flag in the response — fall back to env var
      const envModel = process.env.KORTIX_DEFAULT_MODEL?.trim() || null;
      cachedDefaultModel = { model: envModel, fetchedAt: now };
      return envModel;
    } catch (err) {
      logger.warn(`[proxy] failed to fetch default model from gateway: ${(err as Error).message}`);
      // Fall back to env var (may be stale, but better than nothing)
      const envModel = process.env.KORTIX_DEFAULT_MODEL?.trim() || null;
      cachedDefaultModel = { model: envModel, fetchedAt: now };
      return envModel;
    }
  }

  // Reverse-proxy catch-all → OpenCode. Stream both directions so SSE works.
  // If opencode hasn't bound its port yet (state !== 'ok') we 503 instead of
  // attempting a fetch — surfaces the situation clearly to the client and
  // prevents noisy ECONNREFUSED loops.
  app.all('*', async (c) => {
    // ─── Model override for prompt requests ─────────────────────────────
    // The frontend may send a stale model from localStorage (e.g.
    // 'opencode/big-pickle') that doesn't match the admin-configured default.
    // We rewrite the model field to the CURRENT default model (fetched
    // dynamically from the gateway, cached 30s) so OpenCode displays the
    // correct model in its UI. The gateway itself ignores the model field
    // and uses the DB default for the actual upstream call, so this rewrite
    // is purely cosmetic — but it prevents the user from seeing a stale
    // model name in the session info panel.
    const url = new URL(c.req.url)
    const isPromptRequest =
      c.req.method.toUpperCase() === 'POST' &&
      /\/session\/[^/]+\/prompt(\/async)?$/.test(url.pathname)
    if (isPromptRequest) {
      try {
        const rawBody = await c.req.text()
        const body = JSON.parse(rawBody)
        let shouldRewrite = false
        if (body.model) {
          // Always fetch the current default from the gateway — this ensures
          // we display the admin's CURRENT choice, not a stale env var.
          const currentDefault = await fetchCurrentDefaultModel()
          if (currentDefault) {
            // Rewrite to the current default model
            shouldRewrite = true
            logger.info(
              `[proxy] overriding model in prompt: ${JSON.stringify(body.model)} → vaelorx/${currentDefault}`,
            )
            body.model = { providerID: 'vaelorx', modelID: currentDefault }
          } else {
            // No gateway default available — strip the stale model so
            // OpenCode falls back to its configured default
            shouldRewrite = true
            logger.warn(
              `[proxy] no default model from gateway — stripping stale model ${JSON.stringify(body.model)}`,
            )
            delete body.model
          }
        }
        if (shouldRewrite) {
          const upstreamUrl = `${opencode.getInternalUrl()}${url.pathname}${url.search}`
          const headers = new Headers()
          c.req.raw.headers.forEach((value, key) => {
            if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase()) && key.toLowerCase() !== 'content-length') headers.set(key, value)
          })
          headers.set('content-type', 'application/json')
          if (opencode.getState() !== 'ok') {
            return c.json({ error: 'opencode not ready', opencode: opencode.getState() }, 503)
          }
          try {
            const upstream = await fetch(upstreamUrl, {
              method: 'POST',
              headers,
              body: JSON.stringify(body),
            })
            const respHeaders = new Headers()
            upstream.headers.forEach((value, key) => {
              if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) respHeaders.set(key, value)
            })
            return new Response(upstream.body, {
              status: upstream.status,
              statusText: upstream.statusText,
              headers: respHeaders,
            })
          } catch (err) {
            logger.error('[proxy] prompt override upstream fetch failed', err)
            return c.json({ error: 'upstream unreachable', details: (err as Error).message }, 502)
          }
        }
        // No rewrite needed — re-forward the original body
        const upstreamUrl = `${opencode.getInternalUrl()}${url.pathname}${url.search}`
        const headers = new Headers()
        c.req.raw.headers.forEach((value, key) => {
          if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase()) && key.toLowerCase() !== 'content-length') headers.set(key, value)
        })
        headers.set('content-type', 'application/json')
        if (opencode.getState() !== 'ok') {
          return c.json({ error: 'opencode not ready', opencode: opencode.getState() }, 503)
        }
        try {
          const upstream = await fetch(upstreamUrl, {
            method: 'POST',
            headers,
            body: rawBody,
          })
          const respHeaders = new Headers()
          upstream.headers.forEach((value, key) => {
            if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) respHeaders.set(key, value)
          })
          return new Response(upstream.body, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: respHeaders,
          })
        } catch (err) {
          logger.error('[proxy] prompt forward failed', err)
          return c.json({ error: 'upstream unreachable', details: (err as Error).message }, 502)
        }
      } catch (err) {
        logger.warn('[proxy] failed to parse/override prompt body', { err: (err as Error).message })
        return c.json({ error: 'invalid JSON in prompt body' }, 400)
      }
    }
    if (bootState.repoMaterializationError) {
      return c.json(
        {
          error: 'sandbox runtime not ready',
          reason: 'repo_materialization_failed',
          message: bootState.repoMaterializationError,
        },
        503,
      )
    }

    if (cfg.autoClone && !(await isRepoMaterialized(cfg.projectTarget))) {
      return c.json(
        {
          error: 'sandbox runtime not ready',
          reason: 'repo_not_materialized',
        },
        503,
      )
    }

    if (bootState.initialOpenCodeSessionError) {
      return c.json(
        {
          error: 'sandbox runtime not ready',
          reason: 'initial_opencode_session_failed',
          message: bootState.initialOpenCodeSessionError,
        },
        503,
      )
    }

    if (bootState.initialOpenCodeSessionRequired && !bootState.initialOpenCodeSessionId) {
      return c.json(
        {
          error: 'sandbox runtime not ready',
          reason: 'initial_opencode_session_pending',
        },
        503,
      )
    }

    if (opencode.getState() !== 'ok') {
      return c.json(
        {
          error: 'opencode not ready',
          opencode: opencode.getState(),
        },
        503,
      )
    }

    const upstreamUrl = `${opencode.getInternalUrl()}${url.pathname}${url.search}`

    const headers = new Headers()
    c.req.raw.headers.forEach((value, key) => {
      if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value)
    })

    const method = c.req.method.toUpperCase()
    const hasBody = method !== 'GET' && method !== 'HEAD'

    try {
      const fetchInit: RequestInit & { duplex?: 'half' } = {
        method,
        headers,
        body: hasBody ? (c.req.raw.body as ReadableStream | null) : undefined,
        // duplex: 'half' is required by undici when piping a ReadableStream body;
        // Bun accepts the extra key too. Not in lib.dom RequestInit yet.
        duplex: 'half',
      }
      const upstream = await fetch(upstreamUrl, fetchInit)

      const respHeaders = new Headers()
      upstream.headers.forEach((value, key) => {
        if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) respHeaders.set(key, value)
      })

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: respHeaders,
      })
    } catch (err) {
      logger.error('[proxy] upstream fetch failed', err)
      return c.json({ error: 'upstream unreachable', details: (err as Error).message }, 502)
    }
  })

  return app
}

export type ProxyServer = {
  stop(): Promise<void>
  port: number
  // Rebuild the control surface with a new Config. A warm-pool spare boots
  // tokenless and only learns its session cfg (KORTIX_TOKEN, projectId, …) on
  // claim; without this the proxy auth gate + routers keep the empty boot cfg
  // and reject every request with "KORTIX_TOKEN not configured".
  reload(next: Config): void
}

export function startProxy(
  cfg: Config,
  opencode: Opencode,
  bootTime: number,
  bootState: SandboxBootState = { repoMaterializationError: null, timeline: [] },
  projectEnv?: ProjectEnvStore,
  staticWebPort: number | null = null,
): ProxyServer {
  // Mutable so claim-time reload() can hot-swap the handler in place; the
  // indirection below re-reads `app` per request, so reassigning it is enough.
  let app = buildOpencodeApp(cfg, opencode, bootTime, bootState, projectEnv, staticWebPort)

  const server = Bun.serve({
    port: cfg.servicePort,
    hostname: '0.0.0.0',
    // SSE streams from OpenCode can be long-lived with no traffic; default 10s
    // kills them. 255s matches kortix-master's tuned value.
    idleTimeout: 255,
    fetch: (req, srv) => app.fetch(req, srv),
  })

  const boundPort = server.port ?? cfg.servicePort
  logger.info('[proxy] listening', { port: boundPort, hostname: '0.0.0.0' })

  return {
    port: boundPort,
    reload(next: Config) {
      app = buildOpencodeApp(next, opencode, bootTime, bootState, projectEnv, staticWebPort)
      logger.info('[proxy] reloaded with session config', { projectId: next.projectId })
    },
    async stop() {
      server.stop(true)
    },
  }
}
