/**
 * Account-scoped registry routes — install/uninstall/list/update marketplace items.
 *
 * Uses account_registry_items table (per-account, NOT the global platform_skills).
 * In session-only mode there is no project/git repo, so installs are DB-backed.
 *
 * The daemon fetches installed skills at boot via GET /v1/accounts/me/registry/installed
 * (the /me/ variant resolves accountId from the auth token — used by the daemon
 * which only has a sandbox-scoped token, not a user session).
 *
 * Routes (mounted at /v1/accounts):
 *   GET    /:accountId/registry             — list installed items
 *   POST   /:accountId/registry/install     — install a marketplace item
 *   DELETE /:accountId/registry/:name       — uninstall an item
 *   GET    /:accountId/registry/updates     — check for updates
 *   POST   /:accountId/registry/update      — update a specific item
 *   GET    /me/registry/installed           — returns files for daemon (auth-token resolved)
 */
import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { accountRegistryItems } from '@kortix/db';
import { db } from '../shared/db';
import { supabaseAuth } from '../middleware/auth';
import { buildInstall, resolveItemFiles, catalogIdForName } from './install-service';

export const registryApp = new Hono<{ Variables: { userId: string; accountId: string } }>();

registryApp.use('*', supabaseAuth);

// ─── Helper: resolve accountId from auth context ────────────────────────────

async function resolveAccountId(c: any): Promise<string | null> {
  // Try c.var.accountId first (set by supabaseAuth middleware)
  const fromVar = c.var?.accountId ?? c.get('accountId');
  if (fromVar) return fromVar;

  // Fall back to resolving from userId via the accounts table
  const userId = c.var?.userId ?? c.get('userId');
  if (!userId) return null;
  const { resolveAccountId: resolve } = await import('../shared/resolve-account');
  return resolve(userId);
}

// ─── GET /me/registry/installed — daemon endpoint (returns file contents) ────
// This is the endpoint the daemon calls at boot to fetch all installed skills
// for the account. Returns raw file contents so the daemon can write them
// directly to .vaelorx/opencode/skills/.

registryApp.get('/me/registry/installed', async (c) => {
  const accountId = await resolveAccountId(c);
  if (!accountId) return c.json({ error: 'Account not found' }, 400);

  const items = await db
    .select()
    .from(accountRegistryItems)
    .where(
      and(
        eq(accountRegistryItems.accountId, accountId),
        eq(accountRegistryItems.isActive, true),
      ),
    );

  return c.json({
    items: items.map((item) => ({
      name: item.name,
      type: item.type,
      content: item.skillContent,
      version: item.version,
      updatedAt: item.updatedAt,
    })),
  });
});

// ─── GET /:accountId/registry — list installed items ────────────────────────

registryApp.get('/:accountId/registry', async (c) => {
  const accountId = c.req.param('accountId');
  const items = await db
    .select()
    .from(accountRegistryItems)
    .where(
      and(
        eq(accountRegistryItems.accountId, accountId),
        eq(accountRegistryItems.isActive, true),
      ),
    );

  return c.json({
    items: items.map((item) => ({
      name: item.name,
      type: item.type,
      title: item.name,
      description: (item.metadata as { description?: string } | null)?.description ?? null,
      sourceAddress: item.sourceAddress,
      version: item.version,
      installedAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
  });
});

// ─── POST /:accountId/registry/install — install a marketplace item ──────────

registryApp.post('/:accountId/registry/install', async (c) => {
  const accountId = c.req.param('accountId');
  const body = await c.req.json().catch(() => ({}));
  const { id } = body;

  if (!id) return c.json({ error: 'id is required' }, 400);

  try {
    // Build the install plan (pure function — resolves catalog item files)
    const result = await buildInstall({
      id,
      configDir: '.vaelorx/opencode',
      existingLockRaw: null,
      legacyLockRaw: null,
      now: Date.now(),
    });

    // Store each file as an account_registry_item
    const installed: string[] = [];
    for (const file of result.files) {
      const itemName = file.path.split('/').pop()?.replace(/\.md$/, '') || file.path;
      const contentHash = simpleHash(file.content);

      // Upsert: if (accountId, name) exists, update content; else insert
      const [existing] = await db
        .select()
        .from(accountRegistryItems)
        .where(
          and(
            eq(accountRegistryItems.accountId, accountId),
            eq(accountRegistryItems.name, itemName),
          ),
        )
        .limit(1);

      if (existing) {
        await db
          .update(accountRegistryItems)
          .set({
            skillContent: file.content,
            contentHash,
            sourceAddress: id,
            version: existing.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(accountRegistryItems.itemId, existing.itemId));
      } else {
        await db.insert(accountRegistryItems).values({
          accountId,
          name: itemName,
          type: 'skill',
          sourceAddress: id,
          contentHash,
          skillContent: file.content,
          metadata: { source: id },
          isActive: true,
          version: 1,
        });
      }
      installed.push(itemName);
    }

    // Best-effort: push to active sandboxes for this account via live-update
    try {
      const { pushRegistryUpdateToAccount } = await import('../admin/live-update');
      await pushRegistryUpdateToAccount(accountId, installed).catch(() => {});
    } catch { /* live-update is optional */ }

    return c.json({
      ok: true,
      installed,
      file_count: result.files.length,
    });
  } catch (err) {
    console.error('[registry] install failed:', err);
    return c.json({
      error: err instanceof Error ? err.message : 'Install failed',
    }, 500);
  }
});

// ─── DELETE /:accountId/registry/:name — uninstall ───────────────────────────

registryApp.delete('/:accountId/registry/:name', async (c) => {
  const accountId = c.req.param('accountId');
  const name = c.req.param('name');

  await db
    .update(accountRegistryItems)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(
        eq(accountRegistryItems.accountId, accountId),
        eq(accountRegistryItems.name, name),
      ),
    );

  return c.json({ ok: true, uninstalled: name });
});

// ─── GET /:accountId/registry/updates — check for updates ────────────────────

registryApp.get('/:accountId/registry/updates', async (c) => {
  const accountId = c.req.param('accountId');
  // For now, return empty — update detection requires comparing installed
  // content hashes with catalog hashes. This is a stub for future enhancement.
  return c.json({ updates: [] });
});

// ─── POST /:accountId/registry/update — update a specific item ───────────────

registryApp.post('/:accountId/registry/update', async (c) => {
  const accountId = c.req.param('accountId');
  const body = await c.req.json().catch(() => ({}));
  const { name } = body;

  if (!name) return c.json({ error: 'name is required' }, 400);

  try {
    const files = await resolveItemFiles(name, '.vaelorx/opencode');
    const contentHash = simpleHash(files.map((f) => f.content).join(''));

    const [existing] = await db
      .select()
      .from(accountRegistryItems)
      .where(
        and(
          eq(accountRegistryItems.accountId, accountId),
          eq(accountRegistryItems.name, name),
        ),
      )
      .limit(1);

    if (!existing) {
      return c.json({ error: 'Item not found' }, 404);
    }

    for (const file of files) {
      await db
        .update(accountRegistryItems)
        .set({
          skillContent: file.content,
          contentHash,
          version: existing.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(accountRegistryItems.itemId, existing.itemId));
    }

    return c.json({ ok: true, updated: name });
  } catch (err) {
    return c.json({
      error: err instanceof Error ? err.message : 'Update failed',
    }, 500);
  }
});

// ─── Helper: simple hash for content versioning ──────────────────────────────

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}
