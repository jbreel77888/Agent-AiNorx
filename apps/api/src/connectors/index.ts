/**
 * Account-scoped Connectors API (Phase 6)
 *
 * Mounted at /v1/connectors/*
 * Auth: supabaseAuth (user must be authenticated)
 *
 * These endpoints let users manage their own connectors (Pipedream, MCP,
 * OpenAPI, HTTP) without a project — connectors belong to their account.
 *
 * Backward compatible: project-scoped connectors still work via /v1/projects/:id/*
 * (used by mobile app).
 */
import { Hono } from 'hono';
import { eq, and, isNull } from 'drizzle-orm';
import { supabaseAuth } from '../middleware/auth';
import { db } from '../shared/db';
import { executorConnectors } from '@kortix/db';
import { resolveAccountId } from '../shared/resolve-account';

export const connectorsApp = new Hono();

connectorsApp.use('*', supabaseAuth);

// ─── List user's connectors (account-scoped, project_id = NULL) ──────────────

connectorsApp.get('/', async (c) => {
  const userId = c.get('userId') as string;
  let accountId = c.get('accountId') as string;
  if (!accountId && userId) {
    accountId = await resolveAccountId(userId);
  }
  if (!accountId) return c.json({ connectors: [] });

  const rows = await db
    .select()
    .from(executorConnectors)
    .where(
      and(
        eq(executorConnectors.accountId, accountId),
        isNull(executorConnectors.projectId),
      ),
    );

  return c.json({ connectors: rows });
});

// ─── Create a new connector (account-scoped) ─────────────────────────────────

connectorsApp.post('/', async (c) => {
  const userId = c.get('userId') as string;
  let accountId = c.get('accountId') as string;
  if (!accountId && userId) {
    accountId = await resolveAccountId(userId);
  }
  if (!accountId) return c.json({ error: 'Account ID required' }, 400);

  const body = await c.req.json();
  const { slug, name, providerType, config, enabled } = body;

  if (!slug || !name || !providerType) {
    return c.json({ error: 'slug, name, and providerType are required' }, 400);
  }

  try {
    const [row] = await db.insert(executorConnectors).values({
      accountId,
      projectId: null,
      slug,
      name,
      providerType,
      config: config || {},
      enabled: enabled !== false,
      shareScope: 'project',
      credentialMode: 'shared',
      status: 'active',
    }).returning();

    return c.json({ connector: row }, 201);
  } catch (err: any) {
    if (err?.code === '23505') {
      return c.json({ error: 'A connector with this slug already exists' }, 409);
    }
    throw err;
  }
});

// ─── Update a connector ──────────────────────────────────────────────────────

connectorsApp.patch('/:connectorId', async (c) => {
  const connectorId = c.req.param('connectorId');
  const userId = c.get('userId') as string;
  let accountId = c.get('accountId') as string;
  if (!accountId && userId) {
    accountId = await resolveAccountId(userId);
  }
  if (!accountId) return c.json({ error: 'Account ID required' }, 400);

  const [existing] = await db
    .select()
    .from(executorConnectors)
    .where(
      and(
        eq(executorConnectors.connectorId, connectorId),
        eq(executorConnectors.accountId, accountId),
        isNull(executorConnectors.projectId),
      ),
    )
    .limit(1);

  if (!existing) return c.json({ error: 'Connector not found' }, 404);

  const body = await c.req.json();
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.name !== undefined) updates.name = body.name;
  if (body.config !== undefined) updates.config = body.config;
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  if (body.status !== undefined) updates.status = body.status;

  const [row] = await db
    .update(executorConnectors)
    .set(updates)
    .where(eq(executorConnectors.connectorId, connectorId))
    .returning();

  return c.json({ connector: row });
});

// ─── Delete a connector ──────────────────────────────────────────────────────

connectorsApp.delete('/:connectorId', async (c) => {
  const connectorId = c.req.param('connectorId');
  const userId = c.get('userId') as string;
  let accountId = c.get('accountId') as string;
  if (!accountId && userId) {
    accountId = await resolveAccountId(userId);
  }
  if (!accountId) return c.json({ error: 'Account ID required' }, 400);

  const [existing] = await db
    .select()
    .from(executorConnectors)
    .where(
      and(
        eq(executorConnectors.connectorId, connectorId),
        eq(executorConnectors.accountId, accountId),
        isNull(executorConnectors.projectId),
      ),
    )
    .limit(1);

  if (!existing) return c.json({ error: 'Connector not found' }, 404);

  await db
    .delete(executorConnectors)
    .where(eq(executorConnectors.connectorId, connectorId));

  return c.json({ ok: true });
});
