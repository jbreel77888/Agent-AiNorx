/**
 * Platform Control Admin API
 *
 * Mounted at /v1/admin/platform/*
 * Gated by supabaseAuth + requireAdmin (platform role 'admin' | 'super_admin').
 *
 * Manages: agents, skills, models, subscription plans, providers, and settings.
 * All changes are DB-backed — no redeploy needed.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { supabaseAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/require-admin';
import { db } from '../shared/db';
import {
  platformAgents,
  platformSkills,
  platformModels,
  platformSubscriptionPlans,
  platformProviders,
  platformSettings,
} from '@kortix/db';
import { eq, desc, asc } from 'drizzle-orm';

export const platformAdminApp = new Hono();

// All routes require auth + admin
platformAdminApp.use('*', supabaseAuth, requireAdmin);

// ─── Agents ──────────────────────────────────────────────────────────────────

platformAdminApp.get('/agents', async (c) => {
  const rows = await db.select().from(platformAgents).orderBy(asc(platformAgents.name));
  return c.json({ agents: rows });
});

platformAdminApp.post('/agents', async (c) => {
  const body = await c.req.json();
  const { name, description, systemPrompt, mode, permission, isDefault } = body;

  if (!name || !systemPrompt) {
    return c.json({ error: 'name and systemPrompt are required' }, 400);
  }

  // If setting as default, unset all other defaults
  if (isDefault) {
    await db.update(platformAgents).set({ isDefault: false });
  }

  const [row] = await db.insert(platformAgents).values({
    name,
    description,
    systemPrompt,
    mode: mode || 'primary',
    permission: permission || { '*': 'allow' },
    isDefault: isDefault || false,
    isActive: true,
  }).returning();

  return c.json({ agent: row }, 201);
});

platformAdminApp.patch('/agents/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.systemPrompt !== undefined) updates.systemPrompt = body.systemPrompt;
  if (body.mode !== undefined) updates.mode = body.mode;
  if (body.permission !== undefined) updates.permission = body.permission;
  if (body.isActive !== undefined) updates.isActive = body.isActive;
  if (body.isDefault !== undefined) {
    if (body.isDefault) {
      await db.update(platformAgents).set({ isDefault: false });
    }
    updates.isDefault = body.isDefault;
  }

  const [row] = await db.update(platformAgents)
    .set(updates)
    .where(eq(platformAgents.agentId, id))
    .returning();

  if (!row) return c.json({ error: 'Agent not found' }, 404);
  return c.json({ agent: row });
});

platformAdminApp.delete('/agents/:id', async (c) => {
  const id = c.req.param('id');
  await db.delete(platformAgents).where(eq(platformAgents.agentId, id));
  return c.json({ ok: true });
});

platformAdminApp.post('/agents/:id/default', async (c) => {
  const id = c.req.param('id');
  await db.update(platformAgents).set({ isDefault: false });
  const [row] = await db.update(platformAgents)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(eq(platformAgents.agentId, id))
    .returning();
  if (!row) return c.json({ error: 'Agent not found' }, 404);
  return c.json({ agent: row });
});

// ─── Skills ──────────────────────────────────────────────────────────────────

platformAdminApp.get('/skills', async (c) => {
  const rows = await db.select().from(platformSkills).orderBy(asc(platformSkills.slug));
  return c.json({ skills: rows });
});

platformAdminApp.post('/skills', async (c) => {
  const body = await c.req.json();
  const { slug, name, description, skillContent, scripts, referencesData } = body;

  if (!slug || !name || !skillContent) {
    return c.json({ error: 'slug, name, and skillContent are required' }, 400);
  }

  const [row] = await db.insert(platformSkills).values({
    slug,
    name,
    description,
    skillContent,
    scripts: scripts || {},
    referencesData: referencesData || [],
    isActive: true,
  }).returning();

  return c.json({ skill: row }, 201);
});

platformAdminApp.patch('/skills/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.slug !== undefined) updates.slug = body.slug;
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.skillContent !== undefined) updates.skillContent = body.skillContent;
  if (body.scripts !== undefined) updates.scripts = body.scripts;
  if (body.referencesData !== undefined) updates.referencesData = body.referencesData;
  if (body.isActive !== undefined) updates.isActive = body.isActive;

  const [row] = await db.update(platformSkills)
    .set(updates)
    .where(eq(platformSkills.skillId, id))
    .returning();

  if (!row) return c.json({ error: 'Skill not found' }, 404);
  return c.json({ skill: row });
});

platformAdminApp.delete('/skills/:id', async (c) => {
  const id = c.req.param('id');
  await db.delete(platformSkills).where(eq(platformSkills.skillId, id));
  return c.json({ ok: true });
});

// ─── Models ──────────────────────────────────────────────────────────────────

platformAdminApp.get('/models', async (c) => {
  const rows = await db.select().from(platformModels).orderBy(asc(platformModels.sortOrder));
  return c.json({ models: rows });
});

platformAdminApp.post('/models', async (c) => {
  const body = await c.req.json();
  const { modelKey, displayName, provider, upstreamModelId, isDefault, sortOrder, metadata } = body;

  if (!modelKey || !displayName || !provider) {
    return c.json({ error: 'modelKey, displayName, and provider are required' }, 400);
  }

  if (isDefault) {
    await db.update(platformModels).set({ isDefault: false });
  }

  const [row] = await db.insert(platformModels).values({
    modelKey,
    displayName,
    provider,
    upstreamModelId,
    isDefault: isDefault || false,
    isActive: true,
    sortOrder: sortOrder || 0,
    metadata: metadata || {},
  }).returning();

  return c.json({ model: row }, 201);
});

platformAdminApp.patch('/models/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.modelKey !== undefined) updates.modelKey = body.modelKey;
  if (body.displayName !== undefined) updates.displayName = body.displayName;
  if (body.provider !== undefined) updates.provider = body.provider;
  if (body.upstreamModelId !== undefined) updates.upstreamModelId = body.upstreamModelId;
  if (body.isActive !== undefined) updates.isActive = body.isActive;
  if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;
  if (body.metadata !== undefined) updates.metadata = body.metadata;
  if (body.isDefault !== undefined) {
    if (body.isDefault) {
      await db.update(platformModels).set({ isDefault: false });
    }
    updates.isDefault = body.isDefault;
  }

  const [row] = await db.update(platformModels)
    .set(updates)
    .where(eq(platformModels.modelId, id))
    .returning();

  if (!row) return c.json({ error: 'Model not found' }, 404);
  return c.json({ model: row });
});

platformAdminApp.delete('/models/:id', async (c) => {
  const id = c.req.param('id');
  await db.delete(platformModels).where(eq(platformModels.modelId, id));
  return c.json({ ok: true });
});

platformAdminApp.post('/models/:id/default', async (c) => {
  const id = c.req.param('id');
  await db.update(platformModels).set({ isDefault: false });
  const [row] = await db.update(platformModels)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(eq(platformModels.modelId, id))
    .returning();
  if (!row) return c.json({ error: 'Model not found' }, 404);

  // Also update platform_settings default_model
  await db.update(platformSettings)
    .set({ value: JSON.stringify(row.modelKey), updatedAt: new Date() })
    .where(eq(platformSettings.key, 'default_model'));

  return c.json({ model: row });
});

// ─── Subscription Plans ──────────────────────────────────────────────────────

platformAdminApp.get('/billing/plans', async (c) => {
  const rows = await db.select().from(platformSubscriptionPlans).orderBy(asc(platformSubscriptionPlans.sortOrder));
  return c.json({ plans: rows });
});

platformAdminApp.post('/billing/plans', async (c) => {
  const body = await c.req.json();
  const { slug, name, priceMonthlyUsd, description, features, sortOrder } = body;

  if (!slug || !name || priceMonthlyUsd === undefined) {
    return c.json({ error: 'slug, name, and priceMonthlyUsd are required' }, 400);
  }

  const [row] = await db.insert(platformSubscriptionPlans).values({
    slug,
    name,
    priceMonthlyUsd,
    description,
    features: features || {},
    isActive: true,
    sortOrder: sortOrder || 0,
  }).returning();

  return c.json({ plan: row }, 201);
});

platformAdminApp.patch('/billing/plans/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.slug !== undefined) updates.slug = body.slug;
  if (body.name !== undefined) updates.name = body.name;
  if (body.priceMonthlyUsd !== undefined) updates.priceMonthlyUsd = body.priceMonthlyUsd;
  if (body.description !== undefined) updates.description = body.description;
  if (body.features !== undefined) updates.features = body.features;
  if (body.isActive !== undefined) updates.isActive = body.isActive;
  if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;

  const [row] = await db.update(platformSubscriptionPlans)
    .set(updates)
    .where(eq(platformSubscriptionPlans.planId, id))
    .returning();

  if (!row) return c.json({ error: 'Plan not found' }, 404);
  return c.json({ plan: row });
});

platformAdminApp.delete('/billing/plans/:id', async (c) => {
  const id = c.req.param('id');
  await db.delete(platformSubscriptionPlans).where(eq(platformSubscriptionPlans.planId, id));
  return c.json({ ok: true });
});

// ─── Providers ───────────────────────────────────────────────────────────────

platformAdminApp.get('/providers', async (c) => {
  const rows = await db.select().from(platformProviders).orderBy(asc(platformProviders.providerKey));
  return c.json({ providers: rows });
});

platformAdminApp.post('/providers', async (c) => {
  const body = await c.req.json();
  const { providerKey, displayName, apiKeyEnc, baseUrl, metadata } = body;

  if (!providerKey || !displayName) {
    return c.json({ error: 'providerKey and displayName are required' }, 400);
  }

  const [row] = await db.insert(platformProviders).values({
    providerKey,
    displayName,
    apiKeyEnc,
    baseUrl,
    isActive: true,
    metadata: metadata || {},
  }).returning();

  return c.json({ provider: row }, 201);
});

platformAdminApp.patch('/providers/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const updates: Record<string, unknown> = { updatedAt: new Date() };

  if (body.providerKey !== undefined) updates.providerKey = body.providerKey;
  if (body.displayName !== undefined) updates.displayName = body.displayName;
  if (body.apiKeyEnc !== undefined) updates.apiKeyEnc = body.apiKeyEnc;
  if (body.baseUrl !== undefined) updates.baseUrl = body.baseUrl;
  if (body.isActive !== undefined) updates.isActive = body.isActive;
  if (body.metadata !== undefined) updates.metadata = body.metadata;

  const [row] = await db.update(platformProviders)
    .set(updates)
    .where(eq(platformProviders.providerId, id))
    .returning();

  if (!row) return c.json({ error: 'Provider not found' }, 404);
  return c.json({ provider: row });
});

platformAdminApp.delete('/providers/:id', async (c) => {
  const id = c.req.param('id');
  await db.delete(platformProviders).where(eq(platformProviders.providerId, id));
  return c.json({ ok: true });
});

// ─── Settings ────────────────────────────────────────────────────────────────

platformAdminApp.get('/settings', async (c) => {
  const rows = await db.select().from(platformSettings).orderBy(asc(platformSettings.key));
  return c.json({ settings: rows });
});

platformAdminApp.patch('/settings', async (c) => {
  const body = await c.req.json();
  const updates = body.settings as Array<{ key: string; value: unknown }>;

  if (!Array.isArray(updates)) {
    return c.json({ error: 'settings must be an array of {key, value}' }, 400);
  }

  for (const { key, value } of updates) {
    await db.update(platformSettings)
      .set({ value: JSON.stringify(value), updatedAt: new Date() })
      .where(eq(platformSettings.key, key));
  }

  const rows = await db.select().from(platformSettings).orderBy(asc(platformSettings.key));
  return c.json({ settings: rows });
});

// ─── Publish (force update) ──────────────────────────────────────────────────
// Triggers a scaffold rebuild + live update of all active sandboxes.
// For now, this just bumps the scaffold version — the full publish mechanism
// (scaffold builder + live update) will be implemented in 4.3.

platformAdminApp.post('/publish', async (c) => {
  const version = Date.now().toString();

  await db.update(platformSettings)
    .set({ value: JSON.stringify(version), updatedAt: new Date() })
    .where(eq(platformSettings.key, 'scaffold_version'));

  // Log what was published
  const [agents, skills, models] = await Promise.all([
    db.select().from(platformAgents).where(eq(platformAgents.isActive, true)),
    db.select().from(platformSkills).where(eq(platformSkills.isActive, true)),
    db.select().from(platformModels).where(eq(platformModels.isActive, true)),
  ]);

  return c.json({
    ok: true,
    version,
    published: {
      agents: agents.length,
      skills: skills.length,
      models: models.length,
    },
  });
});
