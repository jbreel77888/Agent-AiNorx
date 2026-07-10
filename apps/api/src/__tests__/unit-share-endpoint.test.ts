import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

/**
 * Unit tests for /v1/p/share input validation.
 *
 * The real handlers proxy to the sandbox's /kortix/share routes, so these tests
 * focus on validating the request-shape guards for create/list/revoke.
 */

describe('/v1/p/share input validation', () => {
  function buildApp() {
    const app = new Hono()

    app.post('/v1/p/share', async (c) => {
      let body: { sandbox_id: string; port: number; ttl?: string; label?: string }
      try {
        body = await c.req.json()
      } catch {
        return c.json({ error: 'Invalid JSON body' }, 400)
      }

      const { sandbox_id, port } = body
      if (!sandbox_id || typeof sandbox_id !== 'string') {
        return c.json({ error: 'sandbox_id is required (string)' }, 400)
      }
      if (!port || typeof port !== 'number' || port < 1 || port > 65535) {
        return c.json({ error: 'port is required (1-65535)' }, 400)
      }

      // In real code, this proxies to sandbox — just return success for validation tests
      return c.json({ ok: true, sandbox_id, port, ttl: body.ttl })
    })

    app.get('/v1/p/share', async (c) => {
      const sandbox_id = c.req.query('sandbox_id')
      if (!sandbox_id || typeof sandbox_id !== 'string') {
        return c.json({ error: 'sandbox_id is required (string)' }, 400)
      }

      return c.json({ ok: true, sandbox_id, shares: [] })
    })

    app.delete('/v1/p/share/:token', async (c) => {
      const sandbox_id = c.req.query('sandbox_id')
      if (!sandbox_id || typeof sandbox_id !== 'string') {
        return c.json({ error: 'sandbox_id is required (string)' }, 400)
      }

      const token = c.req.param('token')
      if (!token) {
        return c.json({ error: 'token is required' }, 400)
      }

      return c.json({ ok: true, sandbox_id, token })
    })

    return app
  }

  test('accepts valid sandbox_id + port', async () => {
    const app = buildApp()
    const res = await app.request('/v1/p/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sandbox_id: 'sb_1', port: 3000 }),
    })
    expect(res.status).toBe(200)
  })

  test('passes ttl through', async () => {
    const app = buildApp()
    const res = await app.request('/v1/p/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sandbox_id: 'sb_1', port: 3000, ttl: '30m' }),
    })
    const body = await res.json() as any
    expect(body.ttl).toBe('30m')
  })

  test('returns 400 for missing sandbox_id', async () => {
    const app = buildApp()
    const res = await app.request('/v1/p/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: 3000 }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('sandbox_id')
  })

  test('returns 400 for missing port', async () => {
    const app = buildApp()
    const res = await app.request('/v1/p/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sandbox_id: 'sb_1' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('port')
  })

  test('returns 400 for port 0', async () => {
    const app = buildApp()
    const res = await app.request('/v1/p/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sandbox_id: 'sb_1', port: 0 }),
    })
    expect(res.status).toBe(400)
  })

  test('returns 400 for port > 65535', async () => {
    const app = buildApp()
    const res = await app.request('/v1/p/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sandbox_id: 'sb_1', port: 70000 }),
    })
    expect(res.status).toBe(400)
  })

  test('returns 400 for invalid JSON', async () => {
    const app = buildApp()
    const res = await app.request('/v1/p/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    expect(res.status).toBe(400)
  })

  test('returns 400 for non-string sandbox_id', async () => {
    const app = buildApp()
    const res = await app.request('/v1/p/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sandbox_id: 123, port: 3000 }),
    })
    expect(res.status).toBe(400)
  })

  test('GET requires sandbox_id query param', async () => {
    const app = buildApp()
    const res = await app.request('/v1/p/share')
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('sandbox_id')
  })

  test('GET accepts sandbox_id query param', async () => {
    const app = buildApp()
    const res = await app.request('/v1/p/share?sandbox_id=sb_1')
    expect(res.status).toBe(200)
  })

  test('DELETE requires sandbox_id query param', async () => {
    const app = buildApp()
    const res = await app.request('/v1/p/share/tok_123', { method: 'DELETE' })
    expect(res.status).toBe(400)
    const body = await res.json() as any
    expect(body.error).toContain('sandbox_id')
  })

  test('DELETE accepts sandbox_id query param', async () => {
    const app = buildApp()
    const res = await app.request('/v1/p/share/tok_123?sandbox_id=sb_1', { method: 'DELETE' })
    expect(res.status).toBe(200)
  })
})
