import { Hono } from 'hono'

import type { Config } from '../config'
import { logger } from '../logger'
import type { Opencode } from '../opencode'
import {
  KORTIX_USER_CONTEXT_HEADER,
  verifyKortixUserContext,
} from '../kortix-user-context'

/**
 * Model Update Router — POST /kortix/model
 *
 * Receives a model update from the API server and updates
 * process.env.KORTIX_DEFAULT_MODEL in memory.
 *
 * The proxy.ts reads this env var on every prompt request, so
 * the new model takes effect immediately on the next prompt —
 * no restart needed.
 *
 * Auth: X-Kortix-User-Context header (same as /kortix/refresh)
 */
export function createModelUpdateRouter(cfg: Config, _opencode: Opencode): Hono {
  const router = new Hono()

  router.post('/', async (c) => {
    if (!cfg.sandboxToken) {
      return c.json({ error: 'daemon not configured', detail: 'KORTIX_TOKEN unset' }, 503)
    }

    const auth = verifyKortixUserContext(c.req.header(KORTIX_USER_CONTEXT_HEADER), cfg.sandboxToken)
    if (!auth.ok) {
      logger.warn('[model-update] reject', { reason: auth.reason })
      return c.json({ error: 'unauthorized', reason: auth.reason }, 401)
    }

    let body: { modelKey?: string }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400)
    }

    if (!body.modelKey || typeof body.modelKey !== 'string') {
      return c.json({ error: 'modelKey is required' }, 400)
    }

    const previousModel = process.env.KORTIX_DEFAULT_MODEL || null
    process.env.KORTIX_DEFAULT_MODEL = body.modelKey

    logger.info(`[model-update] Model changed: ${previousModel ?? 'none'} → ${body.modelKey}`)

    return c.json({
      ok: true,
      previousModel,
      currentModel: body.modelKey,
    })
  })

  return router
}
