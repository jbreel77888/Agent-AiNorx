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
  sessionSandboxes,
} from '@kortix/db';
import { eq, desc, asc, and } from 'drizzle-orm';

export const platformAdminApp = new Hono();

// All routes require auth + admin
platformAdminApp.use('*', supabaseAuth, requireAdmin);

// Mask API key for display — shows only last 4 characters
function maskApiKey(key: string): string {
  if (!key || key.length <= 4) return '••••';
  return '••••••••' + key.slice(-4);
}

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

// POST /models/:id/toggle — toggle model active state
platformAdminApp.post('/models/:id/toggle', async (c) => {
  const id = c.req.param('id');
  const [current] = await db.select().from(platformModels).where(eq(platformModels.modelId, id)).limit(1);
  if (!current) return c.json({ error: 'Model not found' }, 404);

  const [row] = await db.update(platformModels)
    .set({ isActive: !current.isActive, updatedAt: new Date() })
    .where(eq(platformModels.modelId, id))
    .returning();

  return c.json({ model: row });
});

// GET /models/by-provider/:providerKey — list models for a specific provider
platformAdminApp.get('/models/by-provider/:providerKey', async (c) => {
  const providerKey = c.req.param('providerKey');
  const rows = await db.select().from(platformModels)
    .where(eq(platformModels.provider, providerKey))
    .orderBy(asc(platformModels.displayName));
  return c.json({ models: rows });
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

// GET /providers — list all connected providers with masked API keys
platformAdminApp.get('/providers', async (c) => {
  const rows = await db.select().from(platformProviders).orderBy(asc(platformProviders.providerKey));
  // Mask API keys for security — only show last 4 chars
  const masked = rows.map((row) => ({
    ...row,
    apiKeyEnc: row.apiKeyEnc ? maskApiKey(row.apiKeyEnc) : null,
  }));
  return c.json({ providers: masked });
});

// GET /providers/:id — get a single provider with FULL API key (for editing)
platformAdminApp.get('/providers/:id', async (c) => {
  const id = c.req.param('id');
  const [row] = await db.select().from(platformProviders).where(eq(platformProviders.providerId, id)).limit(1);
  if (!row) return c.json({ error: 'Provider not found' }, 404);
  // Return full API key here so the admin can edit it
  return c.json({ provider: row });
});

platformAdminApp.post('/providers', async (c) => {
  const body = await c.req.json();
  const { providerKey, displayName, apiKeyEnc, baseUrl, metadata } = body;

  if (!providerKey || !displayName) {
    return c.json({ error: 'providerKey and displayName are required' }, 400);
  }

  // If baseUrl not provided, look it up from the catalog
  const catalogEntry = PROVIDER_CATALOG[providerKey];
  const finalBaseUrl = baseUrl || catalogEntry?.baseUrl || '';

  const [row] = await db.insert(platformProviders).values({
    providerKey,
    displayName,
    apiKeyEnc,
    baseUrl: finalBaseUrl,
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
  return c.json({ provider: { ...row, apiKeyEnc: row.apiKeyEnc ? maskApiKey(row.apiKeyEnc) : null } });
});

// POST /providers/:id/toggle — toggle provider active state
platformAdminApp.post('/providers/:id/toggle', async (c) => {
  const id = c.req.param('id');
  const [current] = await db.select().from(platformProviders).where(eq(platformProviders.providerId, id)).limit(1);
  if (!current) return c.json({ error: 'Provider not found' }, 404);

  const [row] = await db.update(platformProviders)
    .set({ isActive: !current.isActive, updatedAt: new Date() })
    .where(eq(platformProviders.providerId, id))
    .returning();

  return c.json({ provider: { ...row, apiKeyEnc: row.apiKeyEnc ? maskApiKey(row.apiKeyEnc) : null } });
});

// POST /providers/:id/refresh-models — re-fetch models from provider and upsert
platformAdminApp.post('/providers/:id/refresh-models', async (c) => {
  const id = c.req.param('id');
  const [provider] = await db.select().from(platformProviders).where(eq(platformProviders.providerId, id)).limit(1);
  if (!provider) return c.json({ error: 'Provider not found' }, 404);
  if (!provider.apiKeyEnc) return c.json({ error: 'Provider has no API key' }, 400);

  const catalogEntry = PROVIDER_CATALOG[provider.providerKey];
  const baseUrl = provider.baseUrl || catalogEntry?.baseUrl || '';
  if (!baseUrl) return c.json({ error: 'No base URL configured for this provider' }, 400);

  try {
    // Fetch models from provider
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${provider.apiKeyEnc}`,
    };
    // Anthropic uses a different header
    if (provider.providerKey === 'anthropic') {
      headers['x-api-key'] = provider.apiKeyEnc;
      headers['anthropic-version'] = '2023-06-01';
      delete headers['Authorization'];
    }

    const res = await fetch(`${baseUrl}/models`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return c.json({ error: `Provider returned ${res.status}: ${text.slice(0, 200)}` }, 502);
    }

    const data = await res.json();
    // Normalize to {id, name}[]
    let models: Array<{ id: string; name: string }> = [];
    if (Array.isArray(data?.data)) {
      models = data.data.map((m: any) => ({ id: m.id || m.model, name: m.id || m.model }));
    } else if (Array.isArray(data?.models)) {
      models = data.models.map((m: any) => ({ id: m.id || m.model, name: m.id || m.model }));
    } else if (Array.isArray(data)) {
      models = data.map((m: any) => ({ id: typeof m === 'string' ? m : (m.id || m.model), name: typeof m === 'string' ? m : (m.id || m.model) }));
    }

    // Upsert models into platform_models
    let imported = 0;
    let updated = 0;
    for (const model of models) {
      const [existing] = await db.select().from(platformModels)
        .where(eq(platformModels.modelKey, model.id))
        .limit(1);

      if (existing) {
        // Update upstream ID + provider if changed
        if (existing.upstreamModelId !== model.id || existing.provider !== provider.providerKey) {
          await db.update(platformModels)
            .set({ upstreamModelId: model.id, provider: provider.providerKey, updatedAt: new Date() })
            .where(eq(platformModels.modelId, existing.modelId));
          updated++;
        }
      } else {
        await db.insert(platformModels).values({
          modelKey: model.id,
          displayName: model.name,
          provider: provider.providerKey,
          upstreamModelId: model.id,
          isActive: true,
          isDefault: false,
          sortOrder: 0,
        });
        imported++;
      }
    }

    return c.json({ ok: true, total: models.length, imported, updated, skipped: models.length - imported - updated });
  } catch (err: any) {
    return c.json({ error: `Failed to refresh models: ${err.message}` }, 500);
  }
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
// Pushes the latest agents + skills from DB to ALL active sandboxes.
// Also bumps scaffold_version so new sessions get the latest files.

platformAdminApp.post('/publish', async (c) => {
  try {
    const { publishScaffoldUpdate } = await import('./live-update');
    const result = await publishScaffoldUpdate();

    return c.json({
      ok: true,
      version: result.version,
      published: {
        sandboxesTotal: result.totalSandboxes,
        sandboxesUpdated: result.updated,
        sandboxesFailed: result.failed,
        errors: result.errors,
      },
    });
  } catch (err) {
    console.error('[admin/publish] Error:', err);
    return c.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    }, 500);
  }
});

// ─── Publish status ──────────────────────────────────────────────────────────

platformAdminApp.get('/publish/status', async (c) => {
  const { getScaffoldVersion } = await import('./live-update');
  const version = await getScaffoldVersion();

  const [agents, skills, activeSandboxes] = await Promise.all([
    db.select().from(platformAgents).where(eq(platformAgents.isActive, true)),
    db.select().from(platformSkills).where(eq(platformSkills.isActive, true)),
    db.select({ externalId: sessionSandboxes.externalId })
      .from(sessionSandboxes)
      .where(and(
        eq(sessionSandboxes.provider, 'tensorlake'),
        eq(sessionSandboxes.status, 'active'),
      )),
  ]);

  return c.json({
    version,
    activeAgents: agents.length,
    activeSkills: skills.length,
    activeSandboxes: activeSandboxes.filter((s: any) => s.externalId).length,
  });
});

// ─── Provider Test + Fetch Models ────────────────────────────────────────────
// Tests connection to a provider by calling its /models endpoint,
// returns the list of available models.

// Pre-configured provider catalog — base URLs, env var names, docs, and categories.
// Users only need to enter their API key; everything else is pre-configured.
const PROVIDER_CATALOG: Record<string, {
  displayName: string;
  baseUrl: string;
  docs: string;
  envVar: string;
  category: 'major' | 'fast-inference' | 'specialized' | 'aggregator' | 'cloud' | 'chinese' | 'other';
}> = {
  // ── Major providers ──
  'anthropic':      { displayName: 'Anthropic',           baseUrl: 'https://api.anthropic.com/v1',                              docs: 'https://console.anthropic.com/settings/keys',          envVar: 'ANTHROPIC_API_KEY',      category: 'major' },
  'openai':         { displayName: 'OpenAI',              baseUrl: 'https://api.openai.com/v1',                                 docs: 'https://platform.openai.com/api-keys',                  envVar: 'OPENAI_API_KEY',         category: 'major' },
  'google':         { displayName: 'Google AI',           baseUrl: 'https://generativelanguage.googleapis.com/v1beta',          docs: 'https://aistudio.google.com/apikey',                    envVar: 'GOOGLE_AI_API_KEY',      category: 'major' },
  'openrouter':     { displayName: 'OpenRouter',          baseUrl: 'https://openrouter.ai/api/v1',                              docs: 'https://openrouter.ai/keys',                            envVar: 'OPENROUTER_API_KEY',     category: 'aggregator' },
  // ── Fast inference ──
  'groq':           { displayName: 'Groq',                baseUrl: 'https://api.groq.com/openai/v1',                            docs: 'https://console.groq.com/keys',                         envVar: 'GROQ_API_KEY',           category: 'fast-inference' },
  'cerebras':       { displayName: 'Cerebras',            baseUrl: 'https://api.cerebras.ai/v1',                                docs: 'https://cloud.cerebras.ai',                             envVar: 'CEREBRAS_API_KEY',       category: 'fast-inference' },
  'deepinfra':      { displayName: 'Deep Infra',          baseUrl: 'https://api.deepinfra.com/v1',                              docs: 'https://deepinfra.com/dash/api_keys',                   envVar: 'DEEPINFRA_API_KEY',      category: 'fast-inference' },
  'sambanova':      { displayName: 'SambaNova',           baseUrl: 'https://api.sambanova.ai/v1',                               docs: 'https://cloud.sambanova.ai/apis',                       envVar: 'SAMBANOVA_API_KEY',      category: 'fast-inference' },
  'novita':         { displayName: 'Novita AI',           baseUrl: 'https://api.novita.ai/v3/openai',                           docs: 'https://novita.ai',                                     envVar: 'NOVITA_API_KEY',         category: 'fast-inference' },
  'lepton':         { displayName: 'Lepton AI',           baseUrl: 'https://api.lepton.ai/v1',                                  docs: 'https://www.lepton.ai',                                 envVar: 'LEPTON_API_KEY',         category: 'fast-inference' },
  // ── Specialized ──
  'mistral':        { displayName: 'Mistral AI',          baseUrl: 'https://api.mistral.ai/v1',                                 docs: 'https://console.mistral.ai/api-keys',                   envVar: 'MISTRAL_API_KEY',        category: 'specialized' },
  'deepseek':       { displayName: 'DeepSeek',            baseUrl: 'https://api.deepseek.com/v1',                               docs: 'https://platform.deepseek.com/api_keys',                envVar: 'DEEPSEEK_API_KEY',       category: 'specialized' },
  'togetherai':     { displayName: 'Together AI',         baseUrl: 'https://api.together.xyz/v1',                               docs: 'https://api.together.ai/settings/api-keys',             envVar: 'TOGETHERAI_API_KEY',     category: 'aggregator' },
  'fireworks-ai':   { displayName: 'Fireworks AI',        baseUrl: 'https://api.fireworks.ai/inference/v1',                     docs: 'https://fireworks.ai/account/api-keys',                 envVar: 'FIREWORKS_API_KEY',      category: 'aggregator' },
  'perplexity':     { displayName: 'Perplexity',          baseUrl: 'https://api.perplexity.ai',                                 docs: 'https://docs.perplexity.ai',                            envVar: 'PERPLEXITY_API_KEY',     category: 'specialized' },
  'xai':            { displayName: 'xAI (Grok)',          baseUrl: 'https://api.x.ai/v1',                                       docs: 'https://console.x.ai',                                  envVar: 'XAI_API_KEY',           category: 'specialized' },
  'cohere':         { displayName: 'Cohere',              baseUrl: 'https://api.cohere.ai/v1',                                  docs: 'https://dashboard.cohere.com/api-keys',                 envVar: 'COHERE_API_KEY',         category: 'specialized' },
  'ai21':           { displayName: 'AI21 Labs',           baseUrl: 'https://api.ai21.ai/v1',                                    docs: 'https://studio.ai21.com',                               envVar: 'AI21_API_KEY',           category: 'specialized' },
  'anyscale':       { displayName: 'Anyscale',            baseUrl: 'https://api.endpoints.anyscale.com/v1',                     docs: 'https://console.anyscale.com',                          envVar: 'ANYSCALE_API_KEY',       category: 'specialized' },
  'palmai':         { displayName: 'Palmy',               baseUrl: 'https://api.pal.ai/v1',                                     docs: 'https://pal.ai',                                        envVar: 'PALM_API_KEY',           category: 'specialized' },
  // ── Aggregators & Gateways ──
  'opencode':       { displayName: 'OpenCode Zen',        baseUrl: 'https://opencode.ai/zen/v1',                                docs: 'https://opencode.ai',                                   envVar: 'OPENCODE_API_KEY',       category: 'aggregator' },
  'huggingface':    { displayName: 'Hugging Face',        baseUrl: 'https://router.huggingface.co/v1',                          docs: 'https://huggingface.co/settings/tokens',                envVar: 'HF_API_KEY',             category: 'aggregator' },
  'nvidia':         { displayName: 'Nvidia',              baseUrl: 'https://integrate.api.nvidia.com/v1',                       docs: 'https://build.nvidia.com',                              envVar: 'NVIDIA_API_KEY',         category: 'aggregator' },
  'nebius':         { displayName: 'Nebius',              baseUrl: 'https://api.studio.nebius.ai/v1',                           docs: 'https://studio.nebius.ai',                              envVar: 'NEBIUS_API_KEY',         category: 'aggregator' },
  'replicate':      { displayName: 'Replicate',           baseUrl: 'https://api.replicate.com/v1',                              docs: 'https://replicate.com/account/api-tokens',              envVar: 'REPLICATE_API_TOKEN',    category: 'aggregator' },
  'modal':          { displayName: 'Modal',               baseUrl: 'https://modal.com/v1',                                      docs: 'https://modal.com',                                     envVar: 'MODAL_API_KEY',          category: 'aggregator' },
  'baseten':        { displayName: 'Baseten',             baseUrl: 'https://inference.baseten.co/v1',                           docs: 'https://baseten.co',                                    envVar: 'BASETEN_API_KEY',        category: 'aggregator' },
  'runway':         { displayName: 'Runway',              baseUrl: 'https://api.runwayml.com/v1',                               docs: 'https://runwayml.com',                                  envVar: 'RUNWAY_API_KEY',         category: 'aggregator' },
  // ── Cloud providers ──
  'azure':          { displayName: 'Azure OpenAI',        baseUrl: '',                                                           docs: 'https://portal.azure.com',                              envVar: 'AZURE_OPENAI_API_KEY',   category: 'cloud' },
  'amazon-bedrock': { displayName: 'Amazon Bedrock',      baseUrl: '',                                                           docs: 'https://console.aws.amazon.com/bedrock',                envVar: 'AWS_BEDROCK_API_KEY',    category: 'cloud' },
  'vertex-ai':      { displayName: 'Google Vertex AI',    baseUrl: '',                                                           docs: 'https://console.cloud.google.com/vertex-ai',            envVar: 'VERTEX_AI_API_KEY',      category: 'cloud' },
  // ── Chinese providers ──
  'moonshotai':     { displayName: 'Moonshot AI',         baseUrl: 'https://api.moonshot.ai/v1',                                docs: 'https://platform.moonshot.cn/console/api-keys',         envVar: 'MOONSHOT_API_KEY',       category: 'chinese' },
  'zhipuai':        { displayName: 'Zhipu AI (GLM)',      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',                      docs: 'https://open.bigmodel.cn/usercenter/apikeys',           envVar: 'ZHIPUAI_API_KEY',        category: 'chinese' },
  'alibaba':        { displayName: 'Alibaba (DashScope)', baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',    docs: 'https://dashscope.console.aliyun.com/apiKey',           envVar: 'DASHSCOPE_API_KEY',      category: 'chinese' },
  'siliconflow':    { displayName: 'SiliconFlow',         baseUrl: 'https://api.siliconflow.com/v1',                            docs: 'https://siliconflow.cn',                                envVar: 'SILICONFLOW_API_KEY',    category: 'chinese' },
  'minimax':        { displayName: 'MiniMax',             baseUrl: 'https://api.minimax.io/anthropic/v1',                       docs: 'https://platform.minimax.io',                           envVar: 'MINIMAX_API_KEY',        category: 'chinese' },
  'baichuan':       { displayName: 'Baichuan AI',         baseUrl: 'https://api.baichuan-ai.com/v1',                            docs: 'https://platform.baichuan-ai.com',                      envVar: 'BAICHUAN_API_KEY',       category: 'chinese' },
  'stepfun':        { displayName: 'StepFun',             baseUrl: 'https://api.stepfun.com/v1',                                docs: 'https://platform.stepfun.com',                          envVar: 'STEPFUN_API_KEY',        category: 'chinese' },
  'yi':             { displayName: 'Yi (01.AI)',          baseUrl: 'https://api.lingyiwanwu.com/v1',                            docs: 'https://platform.lingyiwanwu.com',                      envVar: 'YI_API_KEY',             category: 'chinese' },
  'qwen':           { displayName: 'Qwen (Alibaba)',      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',    docs: 'https://dashscope.console.aliyun.com',                  envVar: 'QWEN_API_KEY',           category: 'chinese' },
  'doubao':         { displayName: 'Doubao (ByteDance)',  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',                  docs: 'https://www.volcengine.com/product/doubao',             envVar: 'DOUBAO_API_KEY',         category: 'chinese' },
  'spark':          { displayName: 'Spark (iFlyTek)',     baseUrl: 'https://spark-api-open.xf-yun.com/v1',                      docs: 'https://xinghuo.xfyun.cn',                              envVar: 'SPARK_API_KEY',          category: 'chinese' },
  // ── Other / Community ──
  'v0':             { displayName: 'v0 (Vercel)',         baseUrl: 'https://api.v0.dev/v1',                                     docs: 'https://v0.dev',                                        envVar: 'V0_API_KEY',             category: 'other' },
  'vercel':         { displayName: 'Vercel AI Gateway',   baseUrl: 'https://sdk.vercel.ai/api/v1',                              docs: 'https://vercel.com/ai-gateway',                         envVar: 'VERCEL_AI_API_KEY',      category: 'other' },
  'github-models':  { displayName: 'GitHub Models',       baseUrl: 'https://models.github.ai/inference',                        docs: 'https://github.com/marketplace/models',                 envVar: 'GITHUB_TOKEN',           category: 'other' },
  'poe':            { displayName: 'Poe',                 baseUrl: 'https://api.poe.com/v1',                                    docs: 'https://poe.com',                                       envVar: 'POE_API_KEY',            category: 'other' },
  'ollama-cloud':   { displayName: 'Ollama Cloud',        baseUrl: 'https://ollama.com/v1',                                     docs: 'https://ollama.com',                                    envVar: 'OLLAMA_API_KEY',         category: 'other' },
  'requesty':       { displayName: 'Requesty',            baseUrl: 'https://router.requesty.ai/v1',                             docs: 'https://requesty.ai',                                   envVar: 'REQUESTY_API_KEY',       category: 'other' },
  'scaleway':       { displayName: 'Scaleway',            baseUrl: 'https://api.scaleway.ai/v1',                                docs: 'https://console.scaleway.com',                          envVar: 'SCALEWAY_API_KEY',       category: 'other' },
  'llama-api':      { displayName: 'Llama API',           baseUrl: 'https://api.llama-api.com/v1',                              docs: 'https://llama-api.com',                                 envVar: 'LLAMA_API_KEY',          category: 'other' },
  'dash:api':       { displayName: 'Dash API',            baseUrl: 'https://api.dash.ai/v1',                                    docs: 'https://dash.ai',                                       envVar: 'DASH_API_KEY',           category: 'other' },
  'hyperbolic':     { displayName: 'Hyperbolic',          baseUrl: 'https://api.hyperbolic.xyz/v1',                             docs: 'https://hyperbolic.xyz',                                envVar: 'HYPERBOLIC_API_KEY',     category: 'other' },
  'chutes':         { displayName: 'Chutes AI',           baseUrl: 'https://api.chutes.ai/v1',                                  docs: 'https://chutes.ai',                                     envVar: 'CHUTES_API_KEY',         category: 'other' },
  'krutrim':        { displayName: 'Krutrim',             baseUrl: 'https://cloud.krutrim.ai/v1',                               docs: 'https://krutrim.com',                                   envVar: 'KRUTRIM_API_KEY',        category: 'other' },
  'inception':      { displayName: 'Inception',           baseUrl: 'https://api.inceptionlabs.ai/v1',                           docs: 'https://inceptionlabs.ai',                              envVar: 'INCEPTION_API_KEY',      category: 'other' },
  'friendli':       { displayName: 'FriendliAI',          baseUrl: 'https://api.friendli.ai/v1',                                docs: 'https://friendli.ai',                                   envVar: 'FRIENDLI_API_KEY',       category: 'other' },
};

platformAdminApp.get('/provider-catalog', async (c) => {
  return c.json({ providers: PROVIDER_CATALOG });
});

platformAdminApp.post('/providers/test', async (c) => {
  const body = await c.req.json();
  const { providerKey, apiKey, baseUrl: customBaseUrl } = body;

  if (!apiKey || !providerKey) {
    return c.json({ error: 'providerKey and apiKey are required' }, 400);
  }

  const catalogEntry = PROVIDER_CATALOG[providerKey];
  if (!catalogEntry) {
    return c.json({ error: `Unknown provider: ${providerKey}` }, 400);
  }

  const baseUrl = customBaseUrl || catalogEntry.baseUrl;

  // Azure and Bedrock require special setup — can't test with just an API key
  if (!baseUrl) {
    return c.json({
      ok: false,
      error: `${catalogEntry.displayName} requires manual configuration. Set the base URL and credentials in your environment variables.`,
    });
  }

  const modelsUrl = `${baseUrl}/models`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    const res = await fetch(modelsUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...(providerKey === 'anthropic' ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } : {}),
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Unknown error');
      return c.json({
        ok: false,
        status: res.status,
        error: `Provider returned ${res.status}: ${errorText.slice(0, 200)}`,
      });
    }

    const data = await res.json();
    // Different providers return different shapes — normalize to { id, name }
    let models: Array<{ id: string; name: string }> = [];
    if (Array.isArray(data.data)) {
      // OpenAI-compatible: { data: [{ id, ... }] }
      models = data.data.map((m: any) => ({ id: m.id, name: m.id }));
    } else if (Array.isArray(data.models)) {
      // Some providers: { models: [{ id, ... }] }
      models = data.models.map((m: any) => ({ id: m.id || m.name, name: m.id || m.name }));
    } else if (Array.isArray(data)) {
      // Direct array
      models = data.map((m: any) => ({ id: typeof m === 'string' ? m : m.id, name: typeof m === 'string' ? m : m.id }));
    }

    return c.json({
      ok: true,
      provider: providerKey,
      modelsCount: models.length,
      models: models.slice(0, 200), // Cap at 200 to avoid huge payloads
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({
      ok: false,
      error: `Connection failed: ${msg}`,
    });
  }
});

// Auto-import models from a tested provider into platform_models
platformAdminApp.post('/providers/import-models', async (c) => {
  const body = await c.req.json();
  const { models, providerKey } = body;

  if (!Array.isArray(models) || !providerKey) {
    return c.json({ error: 'models (array) and providerKey are required' }, 400);
  }

  const catalogEntry = PROVIDER_CATALOG[providerKey];
  if (!catalogEntry) {
    return c.json({ error: `Unknown provider: ${providerKey}` }, 400);
  }

  let imported = 0;
  let skipped = 0;

  for (const model of models) {
    try {
      // Check if model already exists
      const [existing] = await db.select().from(platformModels)
        .where(eq(platformModels.modelKey, model.id))
        .limit(1);

      if (existing) {
        skipped++;
        continue;
      }

      await db.insert(platformModels).values({
        modelKey: model.id,
        displayName: model.id,
        provider: providerKey,
        upstreamModelId: model.id,
        isActive: true,
        isDefault: false,
        sortOrder: 0,
      });
      imported++;
    } catch (err) {
      console.warn(`[admin] failed to import model ${model.id}:`, err);
      skipped++;
    }
  }

  return c.json({ ok: true, imported, skipped, total: models.length });
});
