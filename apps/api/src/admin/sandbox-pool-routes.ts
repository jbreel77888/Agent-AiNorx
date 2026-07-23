/**
 * Admin sandbox-pool routes (session-only mode).
 *
 * Mounted at /v1/admin/sandbox-pool/* — backs the web admin page at
 * /admin/sandbox-pool (apps/web/src/components/pages/admin/sandbox-pool).
 *
 * All endpoints check the `account_warm_pool` feature flag first. When OFF:
 *   - GET endpoints return { status: 'disabled', enabled: false } so the UI
 *     can show a "feature disabled" banner.
 *   - Mutation endpoints return 503 'feature disabled'.
 *
 * When ON, the endpoints drive the account-scoped warm pool subsystem
 * (warm-pool-account.ts). The UI surfaces stats, list, replenish, cleanup,
 * force-create, restart-service.
 *
 * Ships dormant: account_warm_pool setting defaults OFF. Operators flip it
 * on from /admin/settings (or via direct DB insert into platform_settings).
 */
import { createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../types';
import { supabaseAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/require-admin';
import { makeOpenApiApp, json, errors, auth } from '../openapi';

import {
  accountWarmPoolSetting,
  ACCOUNT_WARM_POOL_KEY,
  invalidateRuntimeSettings,
  refreshRuntimeSettings,
} from '../platform/services/runtime-settings';
import {
  accountWarmPoolArmed,
  getAccountPoolStats,
  listAccountPoolSandboxes,
  refillAccountPool,
  reconcileAccountWarmPool,
  reapAccountSpares,
} from '../platform/services/warm-pool-account';

export const sandboxPoolAdminApp = makeOpenApiApp<AppEnv>();

// Every admin route requires a logged-in platform admin.
sandboxPoolAdminApp.use('*', supabaseAuth, requireAdmin);

// ── GET /health — pool health summary ──────────────────────────────────────
sandboxPoolAdminApp.openapi(
  createRoute({
    method: 'get',
    path: '/health',
    tags: ['admin', 'sandbox-pool'],
    summary: 'Account warm pool health (session-only mode)',
    ...auth,
    responses: {
      200: json(z.record(z.string(), z.any()), 'pool health'),
      ...errors(401, 403),
    },
  }),
  async (c: any) => {
    const setting = accountWarmPoolSetting();
    if (!setting.enabled) {
      return c.json({
        status: 'disabled',
        service_running: false,
        pool_enabled: false,
        pool_size: 0,
        min_size: 0,
        replenish_threshold: 0,
        issues: ['account_warm_pool feature flag is OFF'],
      });
    }
    const stats = await getAccountPoolStats();
    const issues: string[] = [];
    if (stats.booting > 0) issues.push(`${stats.booting} sandbox(es) still booting`);
    if (stats.reap > 0) issues.push(`${stats.reap} sandbox(es) marked for reap`);
    return c.json({
      status: issues.length === 0 ? 'healthy' : 'warning',
      service_running: true,
      pool_enabled: true,
      pool_size: stats.total_spares,
      min_size: 0,
      replenish_threshold: Math.max(0, setting.size - 1),
      issues,
    });
  },
);

// ── GET /stats — detailed pool stats ───────────────────────────────────────
sandboxPoolAdminApp.openapi(
  createRoute({
    method: 'get',
    path: '/stats',
    tags: ['admin', 'sandbox-pool'],
    summary: 'Account warm pool stats',
    ...auth,
    responses: {
      200: json(z.record(z.string(), z.any()), 'pool stats'),
      ...errors(401, 403),
    },
  }),
  async (c: any) => {
    const setting = accountWarmPoolSetting();
    if (!setting.enabled) {
      return c.json({
        enabled: false,
        pool_size: 0,
        total_created: 0,
        total_claimed: 0,
        total_expired: 0,
        avg_claim_time_ms: 0,
        pool_hit_rate: 0,
        last_replenish_at: null,
        last_cleanup_at: null,
        config: {
          enabled: false,
          min_size: 0,
          max_size: 25,
          replenish_threshold: 0,
          check_interval: 60,
          max_age: 6 * 60 * 60,
        },
      });
    }
    const stats = await getAccountPoolStats();
    return c.json({
      enabled: true,
      pool_size: stats.total_spares,
      total_created: stats.total_spares, // cumulative not tracked yet
      total_claimed: 0, // cumulative not tracked yet
      total_expired: 0, // cumulative not tracked yet
      avg_claim_time_ms: 0, // not tracked yet
      pool_hit_rate: 0, // not tracked yet
      last_replenish_at: stats.last_reconcile_at,
      last_cleanup_at: stats.last_reconcile_at,
      config: {
        enabled: true,
        min_size: 0,
        max_size: 25,
        replenish_threshold: Math.max(0, setting.size - 1),
        check_interval: 60,
        max_age: 6 * 60 * 60,
      },
    });
  },
);

// ── GET /list — list pooled sandboxes ──────────────────────────────────────
sandboxPoolAdminApp.openapi(
  createRoute({
    method: 'get',
    path: '/list',
    tags: ['admin', 'sandbox-pool'],
    summary: 'List pooled sandboxes',
    ...auth,
    request: {
      query: z.object({
        limit: z.string().optional(),
      }),
    },
    responses: {
      200: json(z.record(z.string(), z.any()), 'sandbox list'),
      ...errors(401, 403),
    },
  }),
  async (c: any) => {
    const limit = Math.min(100, Number(c.req.query('limit') || '50'));
    if (!accountWarmPoolArmed()) {
      return c.json({ count: 0, sandboxes: [] });
    }
    const sandboxes = await listAccountPoolSandboxes(limit);
    return c.json({
      count: sandboxes.length,
      sandboxes: sandboxes.map((s) => ({
        id: s.sandboxId,
        external_id: s.externalId,
        provider: s.provider,
        status: s.status,
        server_type: null,
        location: null,
        pooled_at: s.poolState,
        created_at: s.createdAt,
      })),
    });
  },
);

// ── POST /replenish — kick a refill for all present accounts ───────────────
sandboxPoolAdminApp.openapi(
  createRoute({
    method: 'post',
    path: '/replenish',
    tags: ['admin', 'sandbox-pool'],
    summary: 'Replenish the pool (kick reconcile now)',
    ...auth,
    responses: {
      200: json(z.record(z.string(), z.any()), 'ok'),
      503: json(z.record(z.string(), z.any()), 'feature disabled'),
      ...errors(401, 403),
    },
  }),
  async (c: any) => {
    if (!accountWarmPoolArmed()) {
      return c.json(
        { success: false, error: 'account_warm_pool feature is disabled' },
        503,
      );
    }
    await reconcileAccountWarmPool().catch(() => {});
    const stats = await getAccountPoolStats();
    return c.json({
      success: true,
      sandboxes_created: stats.booting,
      pool_size_before: stats.parked,
      pool_size_after: stats.total_spares,
    });
  },
);

// ── POST /force-create — spawn N spares for a specific account ─────────────
sandboxPoolAdminApp.openapi(
  createRoute({
    method: 'post',
    path: '/force-create',
    tags: ['admin', 'sandbox-pool'],
    summary: 'Force-create N spares for an account',
    ...auth,
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              count: z.number().int().min(1).max(10).default(1),
              account_id: z.string().uuid().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: json(z.record(z.string(), z.any()), 'ok'),
      503: json(z.record(z.string(), z.any()), 'feature disabled'),
      ...errors(401, 403),
    },
  }),
  async (c: any) => {
    if (!accountWarmPoolArmed()) {
      return c.json(
        { success: false, error: 'account_warm_pool feature is disabled' },
        503,
      );
    }
    // Force-create requires an explicit account_id (no implicit default).
    const body = await c.req.json().catch(() => ({}));
    const accountId = body?.account_id;
    if (!accountId) {
      return c.json(
        { success: false, error: 'account_id is required for force-create' },
        400,
      );
    }
    const count = Math.max(1, Math.min(10, Number(body?.count ?? 1)));
    // Spawn count spares sequentially (avoid provider thundering herd).
    let created = 0;
    const failedErrors: string[] = [];
    for (let i = 0; i < count; i++) {
      try {
        await refillAccountPool(accountId);
        created++;
      } catch (err) {
        failedErrors.push(err instanceof Error ? err.message : String(err));
      }
    }
    const stats = await getAccountPoolStats();
    return c.json({
      success: true,
      requested: count,
      created_count: created,
      created_ids: [],
      failed_count: failedErrors.length,
      failed_errors: failedErrors,
      pool_size_before: stats.total_spares - created,
      pool_size_after: stats.total_spares,
    });
  },
);

// ── POST /cleanup — reap all stale/reap-marked spares ──────────────────────
sandboxPoolAdminApp.openapi(
  createRoute({
    method: 'post',
    path: '/cleanup',
    tags: ['admin', 'sandbox-pool'],
    summary: 'Cleanup stale pooled sandboxes',
    ...auth,
    responses: {
      200: json(z.record(z.string(), z.any()), 'ok'),
      503: json(z.record(z.string(), z.any()), 'feature disabled'),
      ...errors(401, 403),
    },
  }),
  async (c: any) => {
    if (!accountWarmPoolArmed()) {
      return c.json(
        { success: false, error: 'account_warm_pool feature is disabled' },
        503,
      );
    }
    // reconcile reaps stale rows.
    const before = (await getAccountPoolStats()).total_spares;
    await reconcileAccountWarmPool().catch(() => {});
    const after = (await getAccountPoolStats()).total_spares;
    return c.json({
      success: true,
      cleaned_count: Math.max(0, before - after),
      pool_size_before: before,
      pool_size_after: after,
    });
  },
);

// ── POST /restart-service — no-op (no separate service in account mode) ────
sandboxPoolAdminApp.openapi(
  createRoute({
    method: 'post',
    path: '/restart-service',
    tags: ['admin', 'sandbox-pool'],
    summary: 'Restart the warm pool service (no-op in account mode)',
    ...auth,
    responses: {
      200: json(z.record(z.string(), z.any()), 'ok'),
      503: json(z.record(z.string(), z.any()), 'feature disabled'),
      ...errors(401, 403),
    },
  }),
  async (c: any) => {
    if (!accountWarmPoolArmed()) {
      return c.json(
        { success: false, error: 'account_warm_pool feature is disabled' },
        503,
      );
    }
    // In session-only mode the warm pool is just in-process functions, not a
    // separate service. Refresh settings + kick reconcile as the equivalent
    // of "restart".
    await refreshRuntimeSettings();
    await reconcileAccountWarmPool().catch(() => {});
    return c.json({
      success: true,
      was_running: true,
      is_running: true,
      message: 'Settings refreshed + reconcile kicked (no separate service in account mode)',
    });
  },
);

// ── POST /remove — reap all spares for an account ──────────────────────────
sandboxPoolAdminApp.openapi(
  createRoute({
    method: 'post',
    path: '/remove',
    tags: ['admin', 'sandbox-pool'],
    summary: 'Reap all spares for an account',
    ...auth,
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              account_id: z.string().uuid(),
            }),
          },
        },
      },
    },
    responses: {
      200: json(z.record(z.string(), z.any()), 'ok'),
      503: json(z.record(z.string(), z.any()), 'feature disabled'),
      ...errors(401, 403),
    },
  }),
  async (c: any) => {
    if (!accountWarmPoolArmed()) {
      return c.json(
        { success: false, error: 'account_warm_pool feature is disabled' },
        503,
      );
    }
    const body = await c.req.json().catch(() => ({}));
    const accountId = body?.account_id;
    if (!accountId) {
      return c.json(
        { success: false, error: 'account_id is required' },
        400,
      );
    }
    await reapAccountSpares(accountId).catch(() => {});
    return c.json({
      success: true,
      removed_count: 0, // not tracked precisely
      removed_ids: [],
      failed_count: 0,
      failed: [],
    });
  },
);

// ── GET /config — current feature flag state ───────────────────────────────
sandboxPoolAdminApp.openapi(
  createRoute({
    method: 'get',
    path: '/config',
    tags: ['admin', 'sandbox-pool'],
    summary: 'Get the account warm pool feature flag + size',
    ...auth,
    responses: {
      200: json(z.record(z.string(), z.any()), 'config'),
      ...errors(401, 403),
    },
  }),
  async (c: any) => {
    return c.json(accountWarmPoolSetting());
  },
);

// ── PUT /config — flip the feature flag + adjust size ──────────────────────
sandboxPoolAdminApp.openapi(
  createRoute({
    method: 'put',
    path: '/config',
    tags: ['admin', 'sandbox-pool'],
    summary: 'Set the account warm pool feature flag + size',
    ...auth,
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              enabled: z.boolean().optional(),
              size: z.number().int().min(0).max(25).optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: json(z.record(z.string(), z.any()), 'ok'),
      ...errors(401, 403),
    },
  }),
  async (c: any) => {
    const body = await c.req.json().catch(() => ({}));
    const current = accountWarmPoolSetting();
    const value = {
      enabled: typeof body?.enabled === 'boolean' ? body.enabled : current.enabled,
      size:
        Number.isInteger(body?.size) && body.size >= 0
          ? Math.min(body.size, 25)
          : current.size,
    };
    const { db } = await import('../shared/db');
    const { platformSettings } = await import('@kortix/db');
    await db
      .insert(platformSettings)
      .values({ key: ACCOUNT_WARM_POOL_KEY, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: platformSettings.key,
        set: { value, updatedAt: new Date() },
      });
    invalidateRuntimeSettings();
    await refreshRuntimeSettings();
    return c.json({ ok: true, ...value });
  },
);
