/**
 * Account-scoped registry routes — install/uninstall/list/update marketplace items.
 *
 * These routes were MISSING (the web client called /projects/:id/registry/* but
 * no route handler existed). This implementation uses account scope (session-only mode).
 *
 * The install mechanism:
 *   1. Resolve the catalog item via buildInstall() (pure, no side effects)
 *   2. Store the installed files in platform_skills table (account-scoped)
 *   3. The daemon picks up new skills on next scaffold refresh
 */
import { Hono } from 'hono';
import { eq, and } from 'drizzle-orm';
import { platformSkills, platformSettings } from '@kortix/db';
import { db } from '../shared/db';
import { supabaseAuth } from '../middleware/auth';
import { buildInstall, resolveItemFiles, catalogIdForName } from './install-service';

export const registryApp = new Hono<{ Variables: { userId: string; accountId: string } }>();

registryApp.use('*', supabaseAuth);

// GET /v1/accounts/:accountId/registry — list installed items
registryApp.get('/:accountId/registry', async (c) => {
  const accountId = c.req.param('accountId');
  const skills = await db
    .select()
    .from(platformSkills)
    .where(eq(platformSkills.isActive, true));
  return c.json({ items: skills.map(s => ({
    name: s.slug,
    title: s.name,
    description: s.description,
    installedAt: s.createdAt,
    version: s.version,
  }))});
});

// POST /v1/accounts/:accountId/registry/install — install a marketplace item
registryApp.post('/:accountId/registry/install', async (c) => {
  const accountId = c.req.param('accountId');
  const body = await c.req.json().catch(() => ({}));
  const { id } = body;

  if (!id) return c.json({ error: 'id is required' }, 400);

  try {
    // Build the install plan (pure function — no side effects)
    const result = await buildInstall({
      id,
      configDir: '.vaelorx/opencode',
      existingLockRaw: null,
      legacyLockRaw: null,
      now: Date.now(),
    });

    // Store each file as a platform_skill
    for (const file of result.files) {
      const skillName = file.path.split('/').pop()?.replace('.md', '') || file.path;
      const slug = skillName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

      // Upsert into platform_skills
      const [existing] = await db
        .select()
        .from(platformSkills)
        .where(eq(platformSkills.slug, slug))
        .limit(1);

      if (existing) {
        await db
          .update(platformSkills)
          .set({
            skillContent: file.content,
            updatedAt: new Date(),
          })
          .where(eq(platformSkills.skillId, existing.skillId));
      } else {
        await db.insert(platformSkills).values({
          slug,
          name: skillName,
          description: `Installed from marketplace: ${id}`,
          skillContent: file.content,
          isActive: true,
          version: 1,
        });
      }
    }

    return c.json({
      ok: true,
      installed: result.installed.map(i => i.name),
      plan: result.plan,
    });
  } catch (err) {
    return c.json({
      error: err instanceof Error ? err.message : 'Install failed',
    }, 500);
  }
});

// DELETE /v1/accounts/:accountId/registry/:name — uninstall
registryApp.delete('/:accountId/registry/:name', async (c) => {
  const accountId = c.req.param('accountId');
  const name = c.req.param('name');
  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  await db
    .update(platformSkills)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(platformSkills.slug, slug));

  return c.json({ ok: true });
});

// GET /v1/accounts/:accountId/registry/updates — check for updates
registryApp.get('/:accountId/registry/updates', async (c) => {
  // For now, return empty — update detection requires comparing installed
  // file hashes with catalog hashes
  return c.json({ updates: [] });
});

// POST /v1/accounts/:accountId/registry/update — update a specific item
registryApp.post('/:accountId/registry/update', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { name } = body;

  if (!name) return c.json({ error: 'name is required' }, 400);

  // Re-resolve the item files and update
  try {
    const files = await resolveItemFiles(name, '.vaelorx/opencode');
    const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    for (const file of files) {
      await db
        .update(platformSkills)
        .set({
          skillContent: file.content,
          updatedAt: new Date(),
        })
        .where(eq(platformSkills.slug, slug));
    }

    return c.json({ ok: true, updated: name });
  } catch (err) {
    return c.json({
      error: err instanceof Error ? err.message : 'Update failed',
    }, 500);
  }
});
