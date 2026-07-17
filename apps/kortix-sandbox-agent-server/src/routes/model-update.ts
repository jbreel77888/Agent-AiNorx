import { Hono } from 'hono'
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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
 * Receives a model update from the API server and:
 *   1. Updates process.env.KORTIX_DEFAULT_MODEL in memory
 *      (read by proxy.ts on every prompt — takes effect immediately)
 *   2. Rewrites the model field in:
 *        - vaelorx.toml        (the [[agents]] model = "..." line)
 *        - opencode.jsonc      (model + small_model fields)
 *        - agents/vaelorx.md   (frontmatter model: field)
 *
 * Without (2), the agent's self-reported model (from vaelorx.md frontmatter
 * and opencode.jsonc) would still show the OLD model even though the proxy
 * is correctly forwarding prompts to the NEW model. Users see the agent
 * say "I'm running on z-ai/glm-5.2" when it's actually on
 * deepseek-v4-flash-free — confusing.
 *
 * The proxy.ts override is the SOURCE OF TRUTH for what model is actually
 * used; the file rewrites here just keep the displayed/declared model in
 * sync so the agent's self-description matches reality.
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
    const newModel = body.modelKey
    process.env.KORTIX_DEFAULT_MODEL = newModel

    logger.info(`[model-update] Model changed: ${previousModel ?? 'none'} → ${newModel}`)

    // ─── Rewrite the model in the on-disk config files ───────────────────
    // Best-effort: a failure to rewrite one file doesn't fail the whole
    // request — the env var update above is the authoritative change and
    // proxy.ts will use it on the next prompt regardless.
    const rewritten: string[] = []
    const errors: string[] = []
    const ws = cfg.projectTarget

    // 1. vaelorx.toml — replace `model = "..."` in the [[agents]] section
    try {
      const tomlPath = join(ws, 'vaelorx.toml')
      const toml = readFileSync(tomlPath, 'utf8')
      // Match: model = "..." (with optional surrounding whitespace)
      const updated = toml.replace(
        /(^|\n)(\s*model\s*=\s*)"[^"]*"/g,
        `$1$2"${newModel}"`,
      )
      if (updated !== toml) {
        writeFileSync(tomlPath, updated)
        rewritten.push('vaelorx.toml')
      }
    } catch (err) {
      errors.push(`vaelorx.toml: ${(err as Error).message}`)
    }

    // 2. opencode.jsonc — update model + small_model
    try {
      const jsoncPath = join(ws, '.vaelorx', 'opencode', 'opencode.jsonc')
      const jsonc = readFileSync(jsoncPath, 'utf8')
      // Parse JSONC (strip // comments and trailing commas — JSON.parse won't handle them)
      // For safety, do a regex replace on the "model" and "small_model" string values
      const updated = jsonc
        .replace(
          /("model"\s*:\s*")vaelorx\/[^"]*(")/g,
          `$1vaelorx/${newModel}$2`,
        )
        .replace(
          /("small_model"\s*:\s*")vaelorx\/[^"]*(")/g,
          `$1vaelorx/${newModel}$2`,
        )
      if (updated !== jsonc) {
        writeFileSync(jsoncPath, updated)
        rewritten.push('opencode.jsonc')
      }
    } catch (err) {
      errors.push(`opencode.jsonc: ${(err as Error).message}`)
    }

    // 3. agents/vaelorx.md — update frontmatter `model: vaelorx/...`
    try {
      const agentPath = join(ws, '.vaelorx', 'opencode', 'agents', 'vaelorx.md')
      const md = readFileSync(agentPath, 'utf8')
      // Only replace inside the YAML frontmatter (between --- markers)
      const updated = md.replace(
        /^(---[\s\S]*?)(model:\s*vaelorx\/)[^\n]*(\s*[\s\S]*?---)$/m,
        `$1$2${newModel}$3`,
      )
      if (updated !== md) {
        writeFileSync(agentPath, updated)
        rewritten.push('agents/vaelorx.md')
      }
    } catch (err) {
      errors.push(`agents/vaelorx.md: ${(err as Error).message}`)
    }

    logger.info(
      `[model-update] Rewrote files: ${rewritten.length ? rewritten.join(', ') : 'none'}`
      + (errors.length ? ` | errors: ${errors.join('; ')}` : ''),
    )

    return c.json({
      ok: true,
      previousModel,
      currentModel: newModel,
      rewrittenFiles: rewritten,
      errors,
    })
  })

  return router
}
