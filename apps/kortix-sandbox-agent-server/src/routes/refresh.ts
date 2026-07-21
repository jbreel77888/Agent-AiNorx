import { Hono } from 'hono'

import type { Config } from '../config'
import { refreshRepo, syncWorkspaceToBase } from '../git'
import {
  KORTIX_USER_CONTEXT_HEADER,
  verifyKortixUserContext,
} from '../kortix-user-context'
import { logger } from '../logger'
import type { Opencode } from '../opencode'

export function createRefreshRouter(cfg: Config, opencode: Opencode): Hono {
  const router = new Hono()
  let refreshInFlight: Promise<Response> | null = null

  router.post('/', async (c) => {
    if (!cfg.sandboxToken) {
      return c.json({ error: 'daemon not configured', detail: 'KORTIX_TOKEN unset' }, 503)
    }

    const auth = verifyKortixUserContext(c.req.header(KORTIX_USER_CONTEXT_HEADER), cfg.sandboxToken)
    if (!auth.ok) {
      logger.warn('[refresh] reject', { reason: auth.reason })
      return c.json({ error: 'unauthorized', reason: auth.reason }, 401)
    }

    if (refreshInFlight) {
      return c.json({ error: 'refresh already running' }, 409)
    }

    // `?base=1` syncs the workspace to the latest base tip (warm-pool claim);
    // `?restart=0` skips the opencode restart (the file watcher picks up changes
    // — keeps a warm claim fast). Default behaviour is the full refresh+restart.
    const syncBase = c.req.query('base') === '1'
    const skipRestart = c.req.query('restart') === '0'

    // In session-only mode (simple mode), there is no git remote to pull from.
    // The scaffold was injected locally via materializeScaffoldSeed — there's
    // no `origin` to fetch. Skip git operations entirely and just restart
    // opencode so it rescans its config directory for updated agents/skills.
    //
    // This is triggered by the admin "Publish" button (live-update.ts) which
    // writes new agent/skill files to /workspace/.vaelorx/opencode/ via the
    // Tensorlake SDK, then calls /kortix/refresh to make opencode pick them up.
    const isSimpleMode = cfg.sessionMode === 'simple' || !cfg.repoUrl

    refreshInFlight = (async () => {
      try {
        if (isSimpleMode) {
          // Session-only mode: no git operations, just restart opencode
          logger.info('[refresh] simple mode — skipping git, restarting opencode only')
          if (!skipRestart) await opencode.restart()
          return c.json({
            ok: true,
            repo: { skipped: true, reason: 'simple_mode' },
            opencode: opencode.getState(),
            opencode_pid: opencode.getPid(),
          })
        }

        // Project mode: full git refresh
        const repo = syncBase ? await syncWorkspaceToBase(cfg) : await refreshRepo(cfg)
        if (!skipRestart) await opencode.restart()
        return c.json({
          ok: true,
          repo: {
            before: repo.before,
            after: repo.after,
          },
          opencode: opencode.getState(),
          opencode_pid: opencode.getPid(),
        })
      } catch (err) {
        const message = (err as Error).message || 'refresh failed'
        logger.error('[refresh] failed', err)
        const status = message.includes('not materialized') || message.includes('git pull refresh failed')
          ? 409
          : 500
        return c.json({ error: 'refresh failed', message }, status)
      } finally {
        refreshInFlight = null
      }
    })()

    return refreshInFlight
  })

  return router
}
