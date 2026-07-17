import { Hono } from 'hono'

import type { Config } from './config'
import { logger } from './logger'
import type { Opencode } from './opencode'
import { isRepoMaterialized } from './git'
import { createHealthRouter, type SandboxBootState } from './routes/health'
import { createRefreshRouter } from './routes/refresh'
import { createAbortRouter } from './routes/abort'
import { createModelUpdateRouter } from './routes/model-update'
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
  const modelUpdateRouter = createModelUpdateRouter(cfg, opencode)
  kortixRouter.route('/model', modelUpdateRouter)
  kortixRouter.route('/model/', modelUpdateRouter)
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

  // Reverse-proxy catch-all → OpenCode. Stream both directions so SSE works.
  // If opencode hasn't bound its port yet (state !== 'ok') we 503 instead of
  // attempting a fetch — surfaces the situation clearly to the client and
  // prevents noisy ECONNREFUSED loops.
  app.all('*', async (c) => {
    // ─── Model override for prompt requests ─────────────────────────────
    // The frontend may send a stale model from localStorage (e.g.
    // 'opencode/big-pickle') that doesn't match the admin-configured default.
    // When the daemon has KORTIX_DEFAULT_MODEL set, REWRITE the model field
    // to vaelorx/<default> so OpenCode uses the config default instead.
    //
    // When KORTIX_DEFAULT_MODEL is UNSET (legacy daemons or DB mis-config),
    // at least STRIP the stale 'opencode/<anything>' / 'opencode' provider
    // models from the body so OpenCode doesn't error with "Model not found:
    // opencode/big-pickle" — it will then fall back to the vaelorx agent's
    // configured model (which has a sensible default in opencode.jsonc).
    const url = new URL(c.req.url)
    const isPromptRequest =
      c.req.method.toUpperCase() === 'POST' &&
      /\/session\/[^/]+\/prompt(\/async)?$/.test(url.pathname)
    const defaultModel = process.env.KORTIX_DEFAULT_MODEL?.trim()
    if (isPromptRequest) {
      try {
        const rawBody = await c.req.text()
        const body = JSON.parse(rawBody)
        let shouldRewrite = false
        if (body.model) {
          // Detect a stale 'opencode/<id>' model (e.g. 'opencode/big-pickle')
          // — these are OpenCode Zen built-in models that are NOT in our
          // enabled_providers list, so OpenCode will reject them.
          const modelStr = typeof body.model === 'string'
            ? body.model
            : (body.model?.providerID && body.model?.modelID
                ? `${body.model.providerID}/${body.model.modelID}`
                : (body.model?.modelID || body.model?.providerID || ''))
          const isStaleOpencodeModel =
            modelStr === 'opencode' ||
            modelStr.startsWith('opencode/') ||
            modelStr === 'big-pickle'
          if (defaultModel) {
            // Always rewrite to the admin-configured default
            shouldRewrite = true
            logger.info(`[proxy] overriding model in prompt: ${JSON.stringify(body.model)} → vaelorx/${defaultModel}`)
            body.model = { providerID: 'vaelorx', modelID: defaultModel }
          } else if (isStaleOpencodeModel) {
            // No admin default — but at least strip the stale opencode model
            // so OpenCode falls back to the vaelorx agent's configured model
            shouldRewrite = true
            logger.warn(`[proxy] stripping stale OpenCode model "${modelStr}" from prompt (no KORTIX_DEFAULT_MODEL set)`)
            delete body.model
          }
        }
        if (shouldRewrite) {
          // Re-forward with the modified body
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
        logger.warn('[proxy] failed to parse/override prompt body, forwarding as-is', { err: (err as Error).message })
        // Fall through to normal proxy below — but we already consumed the
        // body, so just return a 400 to surface the parse error clearly.
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
