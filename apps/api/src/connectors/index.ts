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
import { executorConnectors, executorConnectorActions } from '@kortix/db';
import { resolveAccountId } from '../shared/resolve-account';
import { config } from '../config';
import { pipedreamCatalog } from '../executor/pipedream';
import { normalizePipedream } from '../executor/normalize';

export const connectorsApp = new Hono<{
  Variables: { userId: string; accountId?: string; userEmail?: string };
}>();

connectorsApp.use('*', supabaseAuth);

// ─── Pipedream Connect: catalog + OAuth flow (account-scoped) ─────────────
// Uses Pipedream's Connect API to browse 3,235+ apps and 1-click connect.
// Requires PIPEDREAM_CLIENT_ID, PIPEDREAM_CLIENT_SECRET, PIPEDREAM_PROJECT_ID.

const PD_BASE = 'https://api.pipedream.com/v1';

interface PipedreamTokenCache {
  token: string;
  expiresAt: number;
}
let pdTokenCache: PipedreamTokenCache | null = null;

function pipedreamConfigured(): boolean {
  return !!(config.PIPEDREAM_CLIENT_ID && config.PIPEDREAM_CLIENT_SECRET && config.PIPEDREAM_PROJECT_ID);
}

async function getPdApiToken(): Promise<string> {
  if (pdTokenCache && Date.now() < pdTokenCache.expiresAt - 60_000) {
    return pdTokenCache.token;
  }
  if (!pipedreamConfigured()) {
    throw new Error('Pipedream is not configured (set PIPEDREAM_CLIENT_ID/SECRET/PROJECT_ID)');
  }
  const res = await fetch(`${PD_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: config.PIPEDREAM_CLIENT_ID,
      client_secret: config.PIPEDREAM_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Pipedream auth failed (${res.status}): ${await res.text()}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  pdTokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

async function pdApi<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getPdApiToken();
  const res = await fetch(`${PD_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'x-pd-environment': config.PIPEDREAM_ENVIRONMENT || 'production',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`Pipedream ${method} ${path} (${res.status}): ${await res.text()}`);
  return res.json() as Promise<T>;
}

// Apps that are utilities (not real connectors) — filtered from catalog
const UTILITY_APP_SLUGS = new Set([
  'pipedream_utils', 'schedule', 'http', 'formatting', 'code',
  'filter', 'delay', 'batch', 'dedupe', 'pipedream_data_stores',
]);
// Apps that have native Kortix equivalents — filtered to avoid duplicates
const NATIVE_APP_SLUGS = new Set(['slack', 'slack_bot']);

function isConnectableApp(a: { authType?: string | null; slug: string }): boolean {
  if (UTILITY_APP_SLUGS.has(a.slug)) return false;
  if (NATIVE_APP_SLUGS.has(a.slug)) return false;
  return !!a.authType && a.authType !== 'none';
}

// ─── GET /v1/connectors/catalog — browse Pipedream app catalog ────────────
connectorsApp.get('/catalog', async (c) => {
  if (!pipedreamConfigured()) {
    return c.json({ error: 'Pipedream is not configured', apps: [], hasMore: false }, 503);
  }
  const q = c.req.query('q') || '';
  const cursor = c.req.query('cursor') || '';
  const limit = parseInt(c.req.query('limit') || '48', 10);

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  params.set('limit', String(limit));
  if (cursor) params.set('after', cursor);
  if (!q) {
    params.set('sort_key', 'featured_weight');
    params.set('sort_direction', 'desc');
  }

  try {
    const data = await pdApi<{
      page_info: { total_count: number; count: number; end_cursor?: string };
      data: Array<{
        name_slug: string;
        name: string;
        description?: string;
        img_src?: string;
        auth_type?: string;
        categories: string[];
      }>;
    }>('GET', `/connect/${config.PIPEDREAM_PROJECT_ID}/apps?${params.toString()}`);

    const apps = (data.data || [])
      .map((a) => ({
        slug: a.name_slug,
        name: a.name,
        description: a.description ?? null,
        imgSrc: a.img_src ?? null,
        authType: a.auth_type ?? null,
        categories: a.categories || [],
      }))
      .filter(isConnectableApp);

    return c.json({
      apps,
      nextCursor: data.page_info?.end_cursor,
      hasMore: !!data.page_info?.end_cursor,
      totalCount: data.page_info?.total_count ?? 0,
    });
  } catch (err: any) {
    return c.json({ error: err.message, apps: [], hasMore: false }, 502);
  }
});

// ─── GET /v1/connectors/catalog/:slug — get app details + actions ─────────
connectorsApp.get('/catalog/:slug', async (c) => {
  if (!pipedreamConfigured()) {
    return c.json({ error: 'Pipedream is not configured' }, 503);
  }
  const slug = c.req.param('slug');

  try {
    const data = await pdApi<{
      data: {
        name_slug: string;
        name: string;
        description?: string;
        img_src?: string;
        auth_type?: string;
        categories: string[];
      };
    }>('GET', `/connect/${config.PIPEDREAM_PROJECT_ID}/apps/${slug}`);

    return c.json({ app: data.data });
  } catch (err: any) {
    return c.json({ error: err.message }, 502);
  }
});

// ─── GET /v1/connectors/catalog/:slug/actions — list app actions/tools ────
connectorsApp.get('/catalog/:slug/actions', async (c) => {
  if (!pipedreamConfigured()) {
    return c.json({ error: 'Pipedream is not configured', actions: [] }, 503);
  }
  const slug = c.req.param('slug');
  const limit = parseInt(c.req.query('limit') || '100', 10);

  try {
    const data = await pdApi<{
      data: Array<{
        key: string;
        name: string;
        description?: string;
        configurable_props?: Array<{
          name: string;
          type: string;
          optional?: boolean;
          description?: string;
        }>;
      }>;
    }>('GET', `/connect/${config.PIPEDREAM_PROJECT_ID}/actions?app=${slug}&limit=${limit}`);

    const actions = (data.data || []).map((a) => ({
      key: a.key,
      name: a.name,
      description: a.description,
      params: (a.configurable_props || [])
        .filter((p) => p.type !== 'app')
        .map((p) => ({
          name: p.name,
          type: p.type,
          required: !p.optional,
          description: p.description,
        })),
    }));

    return c.json({ actions });
  } catch (err: any) {
    return c.json({ error: err.message, actions: [] }, 502);
  }
});

// ─── POST /v1/connectors/pipedream/connect — start OAuth flow ─────────────
connectorsApp.post('/pipedream/connect', async (c) => {
  if (!pipedreamConfigured()) {
    return c.json({ error: 'Pipedream is not configured' }, 503);
  }
  const userId = c.get('userId') as string;
  let accountId = c.get('accountId') as string;
  if (!accountId && userId) {
    accountId = await resolveAccountId(userId);
  }
  if (!accountId) return c.json({ error: 'Account ID required' }, 400);

  const body = await c.req.json().catch(() => ({}));
  const appSlug = body.appSlug;

  // external_user_id ties the Pipedream connection to this user's account
  const extUserId = `acct:${accountId}`;

  const baseUrl = config.FRONTEND_URL || config.KORTIX_URL || 'http://localhost:3000';
  let origin = baseUrl;
  try { origin = new URL(baseUrl).origin; } catch { /* keep */ }

  const tokenBody: Record<string, unknown> = {
    external_user_id: extUserId,
    allowed_origins: [origin],
    success_redirect_uri: `${origin}/connectors?connected=true`,
    error_redirect_uri: `${origin}/connectors?error=true`,
  };
  if (appSlug) tokenBody.app_slug = appSlug;

  try {
    const data = await pdApi<{ token: string; expires_at: string; connect_link_url?: string }>(
      'POST',
      `/connect/${config.PIPEDREAM_PROJECT_ID}/tokens`,
      tokenBody,
    );

    let connectUrl = data.connect_link_url;
    if (connectUrl && appSlug && !/[?&]app=/.test(connectUrl)) {
      connectUrl += `${connectUrl.includes('?') ? '&' : '?'}app=${encodeURIComponent(appSlug)}`;
    }

    return c.json({
      token: data.token,
      connectUrl,
      expiresAt: data.expires_at,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 502);
  }
});

// ─── GET /v1/connectors/pipedream/accounts — list connected accounts ──────
connectorsApp.get('/pipedream/accounts', async (c) => {
  if (!pipedreamConfigured()) {
    return c.json({ error: 'Pipedream is not configured', accounts: [] }, 503);
  }
  const userId = c.get('userId') as string;
  let accountId = c.get('accountId') as string;
  if (!accountId && userId) {
    accountId = await resolveAccountId(userId);
  }
  if (!accountId) return c.json({ accounts: [] });

  const extUserId = `acct:${accountId}`;

  try {
    const data = await pdApi<{
      data: Array<{ id: string; app: { name_slug: string; name: string } }>;
    }>('GET', `/connect/${config.PIPEDREAM_PROJECT_ID}/accounts?external_user_id=${encodeURIComponent(extUserId)}&include_credentials=0`);

    const accounts = (data.data || []).map((a) => ({
      id: a.id,
      app: a.app.name_slug,
      appName: a.app.name,
    }));

    return c.json({ accounts });
  } catch (err: any) {
    return c.json({ error: err.message, accounts: [] }, 502);
  }
});

// ─── GET /v1/connectors/pipedream/status — check if Pipedream is configured ─
connectorsApp.get('/pipedream/status', async (c) => {
  return c.json({
    configured: pipedreamConfigured(),
  });
});

// ─── POST /v1/connectors/pipedream/finalize — save connected account to DB ─
// Called by the frontend after the Pipedream OAuth popup closes successfully.
// It checks Pipedream for newly connected accounts and creates connector
// records in our DB so the agent can use them.
connectorsApp.post('/pipedream/finalize', async (c) => {
  if (!pipedreamConfigured()) {
    return c.json({ error: 'Pipedream is not configured' }, 503);
  }
  const userId = c.get('userId') as string;
  let accountId = c.get('accountId') as string;
  if (!accountId && userId) {
    accountId = await resolveAccountId(userId);
  }
  if (!accountId) return c.json({ error: 'Account ID required' }, 400);

  const body = await c.req.json().catch(() => ({}));
  const appSlug = body.appSlug as string | undefined;

  const extUserId = `acct:${accountId}`;

  try {
    // Fetch ALL connected accounts for this user from Pipedream
    const data = await pdApi<{
      data: Array<{
        id: string;
        app: { name_slug: string; name: string };
      }>;
    }>('GET', `/connect/${config.PIPEDREAM_PROJECT_ID}/accounts?external_user_id=${encodeURIComponent(extUserId)}&include_credentials=0`);

    const pdAccounts = data.data || [];
    // Filter by appSlug if provided
    const filtered = appSlug
      ? pdAccounts.filter((a) => a.app.name_slug === appSlug)
      : pdAccounts;

    const created: string[] = [];
    const existing: string[] = [];

    for (const acct of filtered) {
      const slug = acct.app.name_slug;
      const name = acct.app.name;
      const pdAccountId = acct.id;

      // Check if a connector for this app + account already exists
      const [existingConn] = await db
        .select()
        .from(executorConnectors)
        .where(
          and(
            eq(executorConnectors.accountId, accountId),
            isNull(executorConnectors.projectId),
            eq(executorConnectors.slug, slug),
          ),
        )
        .limit(1);

      if (existingConn) {
        existing.push(slug);
        continue;
      }

      // Create a connector record in our DB
      try {
        await db.insert(executorConnectors).values({
          accountId,
          projectId: null,
          slug,
          name,
          providerType: 'pipedream',
          config: {
            pipedreamAppSlug: slug,
            pipedreamAccountId: pdAccountId,
            pipedreamExtUserId: extUserId,
          },
          enabled: true,
          shareScope: 'project',
          credentialMode: 'shared',
          status: 'active',
        }).returning();
        created.push(slug);
      } catch (err: any) {
        if (err?.code === '23505') {
          // Already exists (race condition) — skip
          existing.push(slug);
        } else {
          console.warn(`[connectors/finalize] failed to create connector for ${slug}:`, err);
        }
      }
    }

    // Auto-sync actions for newly created connectors
    for (const slug of created) {
      try {
        const [conn] = await db
          .select()
          .from(executorConnectors)
          .where(
            and(
              eq(executorConnectors.accountId, accountId),
              isNull(executorConnectors.projectId),
              eq(executorConnectors.slug, slug),
            ),
          )
          .limit(1);

        if (conn) {
          const cfg = (conn.config ?? {}) as Record<string, any>;
          const appSlug = cfg.pipedreamAppSlug as string;
          if (appSlug) {
            const rawActions = await pipedreamCatalog(appSlug);
            const normalized = normalizePipedream(rawActions, appSlug);
            if (normalized.length > 0) {
              await db.insert(executorConnectorActions).values(
                normalized.map((a) => ({
                  connectorId: conn.connectorId,
                  path: a.path,
                  name: a.name,
                  description: a.description ?? null,
                  inputSchema: a.inputSchema ?? null,
                  risk: a.risk ?? 'low',
                })),
              );
              console.log(`[connectors/finalize] auto-synced ${normalized.length} actions for ${slug}`);
            }
          }
        }
      } catch (syncErr: any) {
        console.warn(`[connectors/finalize] auto-sync failed for ${slug}:`, syncErr.message);
      }
    }

    return c.json({
      ok: true,
      created,
      existing,
      total: filtered.length,
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 502);
  }
});

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

// ─── POST /v1/connectors/sync-actions — sync Pipedream actions for all connectors ─
// Fetches the action catalog from Pipedream for each connected Pipedream connector
// and stores them in executor_connector_actions. This makes the actions available
// to the vaelorx-executor MCP (discover/describe/call tools).
// Works for ALL Pipedream connectors (Gmail, GitHub, Slack, etc.)
connectorsApp.post('/sync-actions', async (c) => {
  const userId = c.get('userId') as string;
  let accountId = c.get('accountId') as string;
  if (!accountId && userId) {
    accountId = await resolveAccountId(userId);
  }
  if (!accountId) return c.json({ error: 'Account ID required' }, 400);

  // Get all account-scoped Pipedream connectors
  const connectors = await db
    .select()
    .from(executorConnectors)
    .where(
      and(
        eq(executorConnectors.accountId, accountId),
        isNull(executorConnectors.projectId),
        eq(executorConnectors.providerType, 'pipedream'),
        eq(executorConnectors.enabled, true),
      ),
    );

  const results: Array<{ slug: string; synced: number; error?: string }> = [];

  for (const conn of connectors) {
    try {
      const cfg = (conn.config ?? {}) as Record<string, any>;
      const appSlug = cfg.pipedreamAppSlug as string;
      if (!appSlug) {
        results.push({ slug: conn.slug, synced: 0, error: 'no pipedreamAppSlug in config' });
        continue;
      }

      // Fetch actions from Pipedream
      const rawActions = await pipedreamCatalog(appSlug);
      const normalized = normalizePipedream(rawActions, appSlug);

      // Delete old actions
      await db
        .delete(executorConnectorActions)
        .where(eq(executorConnectorActions.connectorId, conn.connectorId));

      // Insert new actions
      if (normalized.length > 0) {
        await db.insert(executorConnectorActions).values(
          normalized.map((a) => ({
            connectorId: conn.connectorId,
            path: a.path,
            name: a.name,
            description: a.description ?? null,
            inputSchema: a.inputSchema ?? null,
            risk: a.risk ?? 'low',
          })),
        );
      }

      results.push({ slug: conn.slug, synced: normalized.length });
      console.log(`[connectors/sync-actions] synced ${normalized.length} actions for ${conn.slug}`);
    } catch (err: any) {
      results.push({ slug: conn.slug, synced: 0, error: err.message });
      console.warn(`[connectors/sync-actions] failed for ${conn.slug}:`, err.message);
    }
  }

  return c.json({ ok: true, results });
});
