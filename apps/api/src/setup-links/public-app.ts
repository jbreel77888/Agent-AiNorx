/**
 * Setup-link PUBLIC app — the unauthenticated half, mounted at /v1/setup-links.
 *
 * Handles BOTH token formats:
 *   • ksl_ (legacy project-scoped) — writes to project_secrets
 *   • ksa_ (new account-scoped) — writes to account_secrets
 *
 * The agent-minted link's bearer capability IS the (encrypted, short-lived,
 * value-only) token, so these routes deliberately require no login.
 */
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { projects, accounts } from '@kortix/db';
import { db } from '../shared/db';
import {
  isValidSecretName,
  writeSharedProjectSecret,
  encryptAccountSecret,
  propagateProjectSecretsToActiveSandboxes,
} from '../shared';
import { pipedreamConfigured, pipedreamConnectUrl } from '../executor/pipedream';
import { resolveSetupLink } from './token';

const setupLinksPublicApp = new Hono();

async function resolveScopeName(scope: 'project' | 'account', scopeId: string): Promise<string> {
  if (scope === 'project') {
    const [row] = await db
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.projectId, scopeId))
      .limit(1);
    return row?.name ?? 'this project';
  }
  // Account-scoped — show account name or a generic label
  const [row] = await db
    .select({ name: accounts.name })
    .from(accounts)
    .where(eq(accounts.accountId, scopeId))
    .limit(1)
    .catch(() => [{ name: null }]);
  return (row as any)?.name ?? 'your account';
}

// ─── Write helpers for both scopes ──────────────────────────────────────────

async function writeSecret(
  scope: 'project' | 'account',
  scopeId: string,
  name: string,
  value: string,
  scopeType: 'runtime' | 'connector',
  createdBy: string | null,
): Promise<void> {
  if (scope === 'project') {
    await writeSharedProjectSecret({
      projectId: scopeId,
      name,
      value,
      scope: scopeType,
      createdBy,
    });
  } else {
    // Account-scoped: write to account_secrets via raw SQL (no Drizzle schema yet)
    const encrypted = encryptAccountSecret(scopeId, value);
    await db.execute(
      // Upsert: insert or update the shared row (owner_user_id IS NULL)
      `INSERT INTO kortix.account_secrets (account_id, name, value_enc, scope, share_scope, created_by)
       VALUES (${scopeId}, ${name}, ${encrypted}, ${scopeType}, 'project', ${createdBy ?? null})
       ON CONFLICT (account_id, name) WHERE owner_user_id IS NULL
       DO UPDATE SET value_enc = ${encrypted}, updated_at = NOW()`,
    );
  }
}

async function propagateToActiveSandboxes(
  scope: 'project' | 'account',
  scopeId: string,
): Promise<void> {
  if (scope === 'project') {
    void propagateProjectSecretsToActiveSandboxes(scopeId);
  } else {
    // Account-scoped: propagate to all active sandboxes for this account
    // For now, this is a no-op — the sandbox will pick up new secrets on next env sync.
    // TODO: implement propagateAccountSecretsToActiveSandboxes
    console.log(`[setup-links] account-scoped secret saved for ${scopeId} — sandbox will pick up on next env sync`);
  }
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// GET /v1/setup-links/secret/:token — what fields does this link ask for?
setupLinksPublicApp.get('/secret/:token', async (c) => {
  const resolved = resolveSetupLink(c.req.param('token'));
  if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
  if (resolved.payload.kind !== 'secret') return c.json({ error: 'Wrong link type' }, 400);

  const scopeName = await resolveScopeName(resolved.scope, resolved.scopeId);
  return c.json({
    kind: 'secret',
    scope: resolved.scope,
    scope_name: scopeName,
    fields: resolved.payload.fields.map((f) => ({
      name: f.name,
      label: f.label ?? null,
      description: f.description ?? null,
    })),
    expires_at: new Date(resolved.payload.exp).toISOString(),
  });
});

// POST /v1/setup-links/secret/:token — { values: { NAME: value } }
setupLinksPublicApp.post('/secret/:token', async (c) => {
  const resolved = resolveSetupLink(c.req.param('token'));
  if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
  if (resolved.payload.kind !== 'secret') return c.json({ error: 'Wrong link type' }, 400);

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const values = (body?.values ?? {}) as Record<string, unknown>;
  const allowed = new Set(resolved.payload.fields.map((f) => f.name));

  const saved: string[] = [];
  for (const [rawName, rawValue] of Object.entries(values)) {
    const name = rawName.toUpperCase();
    if (!allowed.has(name) || !isValidSecretName(name)) continue;
    const value = typeof rawValue === 'string' ? rawValue : '';
    if (!value) continue;
    await writeSecret(
      resolved.scope,
      resolved.scopeId,
      name,
      value,
      resolved.payload.scope,
      resolved.payload.uid,
    );
    saved.push(name);
  }

  if (saved.length === 0) {
    return c.json({ error: 'No values provided for the requested keys' }, 400);
  }

  void propagateToActiveSandboxes(resolved.scope, resolved.scopeId);
  return c.json({ ok: true, saved });
});

// GET /v1/setup-links/connector/:token — which app does this link connect?
setupLinksPublicApp.get('/connector/:token', async (c) => {
  const resolved = resolveSetupLink(c.req.param('token'));
  if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
  if (resolved.payload.kind !== 'connector') return c.json({ error: 'Wrong link type' }, 400);

  const scopeName = await resolveScopeName(resolved.scope, resolved.scopeId);
  return c.json({
    kind: 'connector',
    scope: resolved.scope,
    scope_name: scopeName,
    slug: resolved.payload.slug,
    app: resolved.payload.app,
    expires_at: new Date(resolved.payload.exp).toISOString(),
  });
});

// POST /v1/setup-links/connector/:token/start — mint a FRESH Pipedream Quick
// Connect URL. The scopeId (projectId or accountId) is passed to Pipedream's
// external_user_id for credential routing.
setupLinksPublicApp.post('/connector/:token/start', async (c) => {
  const resolved = resolveSetupLink(c.req.param('token'));
  if (!resolved.ok) return c.json({ error: resolved.error }, resolved.status);
  if (resolved.payload.kind !== 'connector') return c.json({ error: 'Wrong link type' }, 400);
  if (!pipedreamConfigured()) return c.json({ error: 'Pipedream is not configured on this deployment' }, 501);
  if (!resolved.payload.app) return c.json({ error: 'This connector has no Pipedream app bound' }, 400);

  const effectiveUser = resolved.payload.mode === 'per_user' ? resolved.payload.uid : null;
  try {
    // pipedreamConnectUrl accepts a scopeId — works for both project and account
    // because Pipedream just uses it as an opaque external_user_id.
    const { connectUrl } = await pipedreamConnectUrl(
      resolved.scopeId,
      resolved.payload.slug,
      resolved.payload.app,
      effectiveUser,
    );
    if (!connectUrl) return c.json({ error: 'Pipedream did not return a connect URL' }, 502);
    return c.json({ connect_url: connectUrl });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Failed to start connect' }, 502);
  }
});

export { setupLinksPublicApp };
