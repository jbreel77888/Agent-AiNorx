/**
 * Admin LLM Provider & Model Management API.
 *
 * Mounted at /v1/admin/llm, gated by supabaseAuth + requireAdmin.
 * Provides CRUD for platform_llm_providers and platform_llm_models tables.
 */
import { createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../types';
import { supabaseAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/require-admin';
import { makeOpenApiApp, json, errors, auth } from '../openapi';

export const adminLlmApp = makeOpenApiApp<AppEnv>();
adminLlmApp.use('*', supabaseAuth, requireAdmin);

// ── List Platform LLM Providers ────────────────────────────────────────────
adminLlmApp.openapi(
  createRoute({
    method: 'get',
    path: '/providers',
    tags: ['admin-llm'],
    summary: 'List platform LLM providers',
    ...auth,
    responses: {
      200: json(z.array(z.record(z.string(), z.any())), 'Providers list'),
      500: json(z.record(z.string(), z.any()), 'Server error'),
      ...errors(401, 403),
    },
  }),
  async (c: any) => {
    try {
      const { db } = await import('../shared/db');
      const { sql } = await import('drizzle-orm');
      const result: any = await db.execute(sql`
        SELECT provider_id, name, provider_type, 
               CASE WHEN api_key_enc IS NOT NULL THEN '***masked***' ELSE NULL END as api_key_enc,
               base_url, is_active, created_at, updated_at 
               FROM kortix.platform_llm_providers ORDER BY created_at
      `);
      return c.json(result.rows || result);
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

// ── Add Platform LLM Provider ──────────────────────────────────────────────
adminLlmApp.openapi(
  createRoute({
    method: 'post',
    path: '/providers',
    tags: ['admin-llm'],
    summary: 'Add a platform LLM provider',
    ...auth,
    request: {
      body: json(z.object({
        name: z.string().min(1),
        providerType: z.string().min(1),
        apiKeyEnc: z.string().min(1),
        baseUrl: z.string().optional(),
      }), 'Provider data'),
    },
    responses: {
      200: json(z.record(z.string(), z.any()), 'Created provider'),
      500: json(z.record(z.string(), z.any()), 'Server error'),
      ...errors(401, 403),
    },
  }),
  async (c: any) => {
    try {
      const { db } = await import('../shared/db');
      const { sql } = await import('drizzle-orm');
      const body = await c.req.json();

      const result: any = await db.execute(sql`
        INSERT INTO kortix.platform_llm_providers (name, provider_type, api_key_enc, base_url)
        VALUES (${body.name}, ${body.providerType}, ${body.apiKeyEnc}, ${body.baseUrl || null}) 
        RETURNING *
      `);
      const row = (result.rows || result)[0];
      return c.json({ ...row, api_key_enc: '***masked***' });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

// ── Update Platform LLM Provider ───────────────────────────────────────────
adminLlmApp.openapi(
  createRoute({
    method: 'patch',
    path: '/providers/{id}',
    tags: ['admin-llm'],
    summary: 'Update a platform LLM provider',
    ...auth,
    request: {
      params: z.object({ id: z.string().uuid() }),
      body: json(z.object({
        name: z.string().optional(),
        providerType: z.string().optional(),
        apiKeyEnc: z.string().optional(),
        baseUrl: z.string().optional().nullable(),
        isActive: z.boolean().optional(),
      }), 'Provider updates'),
    },
    responses: {
      200: json(z.record(z.string(), z.any()), 'Updated provider'),
      404: json(z.record(z.string(), z.any()), 'Not found'),
      500: json(z.record(z.string(), z.any()), 'Server error'),
      ...errors(401, 403),
    },
  }),
  async (c: any) => {
    try {
      const { db } = await import('../shared/db');
      const { sql } = await import('drizzle-orm');
      const id = c.req.param('id');
      const body = await c.req.json();

      // Build SET clause dynamically
      const setClauses: string[] = [];
      const values: any[] = [];
      
      if (body.name !== undefined) setClauses.push(`name = '${body.name.replace(/'/g, "''")}'`);
      if (body.providerType !== undefined) setClauses.push(`provider_type = '${body.providerType.replace(/'/g, "''")}'`);
      if (body.apiKeyEnc !== undefined) setClauses.push(`api_key_enc = '${body.apiKeyEnc.replace(/'/g, "''")}'`);
      if (body.baseUrl !== undefined) setClauses.push(body.baseUrl === null ? `base_url = NULL` : `base_url = '${body.baseUrl.replace(/'/g, "''")}'`);
      if (body.isActive !== undefined) setClauses.push(`is_active = ${body.isActive}`);
      setClauses.push(`updated_at = NOW()`);

      const result: any = await db.execute(sql.raw(
        `UPDATE kortix.platform_llm_providers SET ${setClauses.join(', ')} WHERE provider_id = '${id}' RETURNING *`
      ));
      const row = (result.rows || result)[0];
      if (!row) return c.json({ error: 'Provider not found' }, 404);
      return c.json({ ...row, api_key_enc: '***masked***' });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

// ── Delete Platform LLM Provider ───────────────────────────────────────────
adminLlmApp.openapi(
  createRoute({
    method: 'delete',
    path: '/providers/{id}',
    tags: ['admin-llm'],
    summary: 'Delete a platform LLM provider',
    ...auth,
    request: {
      params: z.object({ id: z.string().uuid() }),
    },
    responses: {
      200: json(z.record(z.string(), z.any()), 'Deleted'),
      404: json(z.record(z.string(), z.any()), 'Not found'),
      500: json(z.record(z.string(), z.any()), 'Server error'),
      ...errors(401, 403),
    },
  }),
  async (c: any) => {
    try {
      const { db } = await import('../shared/db');
      const { sql } = await import('drizzle-orm');
      const id = c.req.param('id');

      const result: any = await db.execute(sql`
        DELETE FROM kortix.platform_llm_providers WHERE provider_id = ${id} RETURNING provider_id
      `);
      const row = (result.rows || result)[0];
      if (!row) return c.json({ error: 'Provider not found' }, 404);
      return c.json({ success: true, providerId: id });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

// ── Test Provider Connection ───────────────────────────────────────────────
adminLlmApp.openapi(
  createRoute({
    method: 'get',
    path: '/providers/{id}/test',
    tags: ['admin-llm'],
    summary: 'Test connectivity to a platform LLM provider',
    ...auth,
    request: {
      params: z.object({ id: z.string().uuid() }),
    },
    responses: {
      200: json(z.record(z.string(), z.any()), 'Test result'),
      500: json(z.record(z.string(), z.any()), 'Server error'),
      ...errors(401, 403),
    },
  }),
  async (c: any) => {
    try {
      const { db } = await import('../shared/db');
      const { sql } = await import('drizzle-orm');
      const id = c.req.param('id');

      const result: any = await db.execute(sql`
        SELECT * FROM kortix.platform_llm_providers WHERE provider_id = ${id}
      `);
      const provider = (result.rows || result)[0];
      if (!provider) return c.json({ error: 'Provider not found' }, 404);

      const baseUrl = provider.base_url || 'https://openrouter.ai/api/v1';
      const response = await fetch(`${baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${provider.api_key_enc}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      return c.json({
        connected: response.ok,
        status: response.status,
        statusText: response.statusText,
        providerName: provider.name,
        providerType: provider.provider_type,
      });
    } catch (error: any) {
      return c.json({ connected: false, error: error.message });
    }
  },
);

// ── List Platform LLM Models ───────────────────────────────────────────────
adminLlmApp.openapi(
  createRoute({
    method: 'get',
    path: '/models',
    tags: ['admin-llm'],
    summary: 'List platform LLM models',
    ...auth,
    responses: {
      200: json(z.array(z.record(z.string(), z.any())), 'Models list'),
      500: json(z.record(z.string(), z.any()), 'Server error'),
      ...errors(401, 403),
    },
  }),
  async (c: any) => {
    try {
      const { db } = await import('../shared/db');
      const { sql } = await import('drizzle-orm');

      const result: any = await db.execute(sql`
        SELECT m.model_id, m.provider_id, m.display_name, m.display_description, 
               m.display_icon, m.backend_model_id, m.sort_order, m.is_active, 
               m.available_in_plans, m.created_at, m.updated_at,
               p.name as provider_name, p.provider_type
               FROM kortix.platform_llm_models m
               JOIN kortix.platform_llm_providers p ON m.provider_id = p.provider_id
               ORDER BY m.sort_order
      `);
      return c.json(result.rows || result);
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

// ── Add Platform LLM Model ─────────────────────────────────────────────────
adminLlmApp.openapi(
  createRoute({
    method: 'post',
    path: '/models',
    tags: ['admin-llm'],
    summary: 'Add a platform LLM model',
    ...auth,
    request: {
      body: json(z.object({
        providerId: z.string().uuid(),
        displayName: z.string().min(1),
        displayDescription: z.string().optional(),
        displayIcon: z.string().optional(),
        backendModelId: z.string().min(1),
        sortOrder: z.number().optional(),
        isActive: z.boolean().optional(),
        availableInPlans: z.array(z.string()).optional(),
      }), 'Model data'),
    },
    responses: {
      200: json(z.record(z.string(), z.any()), 'Created model'),
      500: json(z.record(z.string(), z.any()), 'Server error'),
      ...errors(401, 403),
    },
  }),
  async (c: any) => {
    try {
      const { db } = await import('../shared/db');
      const { sql } = await import('drizzle-orm');
      const body = await c.req.json();

      const result: any = await db.execute(sql`
        INSERT INTO kortix.platform_llm_models 
        (provider_id, display_name, display_description, display_icon, backend_model_id, sort_order, is_active, available_in_plans)
        VALUES (${body.providerId}, ${body.displayName}, ${body.displayDescription || null}, ${body.displayIcon || null}, 
                ${body.backendModelId}, ${body.sortOrder ?? 0}, ${body.isActive ?? true}, 
                ${JSON.stringify(body.availableInPlans || ['free', 'basic', 'pro', 'enterprise'])})
        RETURNING *
      `);
      return c.json((result.rows || result)[0]);
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

// ── Update Platform LLM Model ──────────────────────────────────────────────
adminLlmApp.openapi(
  createRoute({
    method: 'patch',
    path: '/models/{id}',
    tags: ['admin-llm'],
    summary: 'Update a platform LLM model',
    ...auth,
    request: {
      params: z.object({ id: z.string().uuid() }),
      body: json(z.object({
        providerId: z.string().uuid().optional(),
        displayName: z.string().optional(),
        displayDescription: z.string().optional().nullable(),
        displayIcon: z.string().optional().nullable(),
        backendModelId: z.string().optional(),
        sortOrder: z.number().optional(),
        isActive: z.boolean().optional(),
        availableInPlans: z.array(z.string()).optional(),
      }), 'Model updates'),
    },
    responses: {
      200: json(z.record(z.string(), z.any()), 'Updated model'),
      404: json(z.record(z.string(), z.any()), 'Not found'),
      500: json(z.record(z.string(), z.any()), 'Server error'),
      ...errors(401, 403),
    },
  }),
  async (c: any) => {
    try {
      const { db } = await import('../shared/db');
      const { sql } = await import('drizzle-orm');
      const id = c.req.param('id');
      const body = await c.req.json();

      const setClauses: string[] = [];
      
      if (body.providerId !== undefined) setClauses.push(`provider_id = '${body.providerId}'`);
      if (body.displayName !== undefined) setClauses.push(`display_name = '${body.displayName.replace(/'/g, "''")}'`);
      if (body.displayDescription !== undefined) setClauses.push(body.displayDescription === null ? `display_description = NULL` : `display_description = '${body.displayDescription.replace(/'/g, "''")}'`);
      if (body.displayIcon !== undefined) setClauses.push(body.displayIcon === null ? `display_icon = NULL` : `display_icon = '${body.displayIcon.replace(/'/g, "''")}'`);
      if (body.backendModelId !== undefined) setClauses.push(`backend_model_id = '${body.backendModelId.replace(/'/g, "''")}'`);
      if (body.sortOrder !== undefined) setClauses.push(`sort_order = ${body.sortOrder}`);
      if (body.isActive !== undefined) setClauses.push(`is_active = ${body.isActive}`);
      if (body.availableInPlans !== undefined) setClauses.push(`available_in_plans = '${JSON.stringify(body.availableInPlans)}'`);
      setClauses.push(`updated_at = NOW()`);

      const result: any = await db.execute(sql.raw(
        `UPDATE kortix.platform_llm_models SET ${setClauses.join(', ')} WHERE model_id = '${id}' RETURNING *`
      ));
      const row = (result.rows || result)[0];
      if (!row) return c.json({ error: 'Model not found' }, 404);
      return c.json(row);
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

// ── Delete Platform LLM Model ──────────────────────────────────────────────
adminLlmApp.openapi(
  createRoute({
    method: 'delete',
    path: '/models/{id}',
    tags: ['admin-llm'],
    summary: 'Delete a platform LLM model',
    ...auth,
    request: {
      params: z.object({ id: z.string().uuid() }),
    },
    responses: {
      200: json(z.record(z.string(), z.any()), 'Deleted'),
      404: json(z.record(z.string(), z.any()), 'Not found'),
      500: json(z.record(z.string(), z.any()), 'Server error'),
      ...errors(401, 403),
    },
  }),
  async (c: any) => {
    try {
      const { db } = await import('../shared/db');
      const { sql } = await import('drizzle-orm');
      const id = c.req.param('id');

      const result: any = await db.execute(sql`
        DELETE FROM kortix.platform_llm_models WHERE model_id = ${id} RETURNING model_id
      `);
      const row = (result.rows || result)[0];
      if (!row) return c.json({ error: 'Model not found' }, 404);
      return c.json({ success: true, modelId: id });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

// ── Reorder Models ─────────────────────────────────────────────────────────
adminLlmApp.openapi(
  createRoute({
    method: 'patch',
    path: '/models/{id}/sort',
    tags: ['admin-llm'],
    summary: 'Change the sort order of a model',
    ...auth,
    request: {
      params: z.object({ id: z.string().uuid() }),
      body: json(z.object({ sortOrder: z.number() }), 'New sort order'),
    },
    responses: {
      200: json(z.record(z.string(), z.any()), 'Updated'),
      404: json(z.record(z.string(), z.any()), 'Not found'),
      500: json(z.record(z.string(), z.any()), 'Server error'),
      ...errors(401, 403),
    },
  }),
  async (c: any) => {
    try {
      const { db } = await import('../shared/db');
      const { sql } = await import('drizzle-orm');
      const id = c.req.param('id');
      const body = await c.req.json();

      const result: any = await db.execute(sql`
        UPDATE kortix.platform_llm_models SET sort_order = ${body.sortOrder}, updated_at = NOW() WHERE model_id = ${id} RETURNING *
      `);
      const row = (result.rows || result)[0];
      if (!row) return c.json({ error: 'Model not found' }, 404);
      return c.json(row);
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

// ── Available Models from Provider ─────────────────────────────────────────
adminLlmApp.openapi(
  createRoute({
    method: 'get',
    path: '/models/available',
    tags: ['admin-llm'],
    summary: 'List available models from all active providers',
    ...auth,
    request: {
      query: z.object({ providerId: z.string().uuid().optional() }),
    },
    responses: {
      200: json(z.record(z.string(), z.any()), 'Available models'),
      500: json(z.record(z.string(), z.any()), 'Server error'),
      ...errors(401, 403),
    },
  }),
  async (c: any) => {
    try {
      const { db } = await import('../shared/db');
      const { sql } = await import('drizzle-orm');
      const providerId = c.req.query('providerId');

      let providersResult: any;
      if (providerId) {
        providersResult = await db.execute(sql`
          SELECT * FROM kortix.platform_llm_providers WHERE provider_id = ${providerId} AND is_active = true
        `);
      } else {
        providersResult = await db.execute(sql`
          SELECT * FROM kortix.platform_llm_providers WHERE is_active = true
        `);
      }
      const providers = providersResult.rows || providersResult;

      const results: any[] = [];
      for (const provider of providers) {
        try {
          const baseUrl = provider.base_url || 'https://openrouter.ai/api/v1';
          const response = await fetch(`${baseUrl}/models`, {
            headers: {
              'Authorization': `Bearer ${provider.api_key_enc}`,
              'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(15000),
          });
          if (response.ok) {
            const data: any = await response.json();
            const models = (data.data || []).map((m: any) => ({
              id: m.id, name: m.name || m.id, provider: provider.name, providerId: provider.provider_id,
            }));
            results.push(...models);
          }
        } catch { /* skip */ }
      }

      return c.json({ models: results, count: results.length });
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);

// ── Public: Get Platform Models for Current User ───────────────────────────
adminLlmApp.openapi(
  createRoute({
    method: 'get',
    path: '/platform-models',
    tags: ['llm'],
    summary: 'Get platform models available for the current user',
    ...auth,
    request: {
      query: z.object({ plan: z.string().default('free') }),
    },
    responses: {
      200: json(z.array(z.record(z.string(), z.any())), 'Platform models'),
      500: json(z.record(z.string(), z.any()), 'Server error'),
      ...errors(401),
    },
  }),
  async (c: any) => {
    try {
      const { db } = await import('../shared/db');
      const { sql } = await import('drizzle-orm');
      const plan = c.req.query('plan') || 'free';

      const result: any = await db.execute(sql`
        SELECT m.model_id, m.display_name, m.display_description, m.display_icon,
               m.backend_model_id, m.sort_order, m.available_in_plans,
               p.name as provider_name, p.provider_type, p.base_url as provider_base_url
               FROM kortix.platform_llm_models m
               JOIN kortix.platform_llm_providers p ON m.provider_id = p.provider_id
               WHERE m.is_active = true AND p.is_active = true
               ORDER BY m.sort_order
      `);
      const rows = result.rows || result;

      const filtered = rows.filter((r: any) => {
        const plans = r.available_in_plans || [];
        return plans.includes(plan) || plans.includes('free');
      });

      const response = filtered.map((r: any) => ({
        modelId: r.model_id,
        displayName: r.display_name,
        displayDescription: r.display_description,
        displayIcon: r.display_icon,
        backendModelId: r.backend_model_id,
        sortOrder: r.sort_order,
        providerName: r.provider_name,
        providerType: r.provider_type,
        isPlatformModel: true,
        billingMode: 'platform-included',
        cost: 0,
      }));

      return c.json(response);
    } catch (error: any) {
      return c.json({ error: error.message }, 500);
    }
  },
);
