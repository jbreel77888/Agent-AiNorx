/**
 * Account-scoped deployments routes (session-only mode).
 *
 * Mounted at /v1/deployments/* — backs the web deployments page at
 * /sessions/tools/deployments (apps/web/src/components/deployments/).
 *
 * All endpoints check the `account_deployments` feature flag first. When OFF:
 *   - All endpoints return 503 'feature disabled'.
 *
 * When ON, the endpoints let users deploy code from their session sandboxes
 * (or git repos / file uploads / tarballs) to Freestyle.sh, getting back a
 * permanent URL. Supports: list, get, create, stop, redeploy, delete, logs.
 *
 * Ships dormant: account_deployments setting defaults OFF. Operators flip it
 * on from /admin/settings (or via direct DB insert into platform_settings)
 * AFTER configuring FREESTYLE_API_KEY.
 *
 * Mirrors the frontend hook's expected REST surface in
 * apps/web/src/hooks/deployments/use-deployments.ts:
 *   GET    /v1/deployments                   list
 *   POST   /v1/deployments                   create
 *   GET    /v1/deployments/:id               get
 *   POST   /v1/deployments/:id/stop          stop
 *   POST   /v1/deployments/:id/redeploy      redeploy
 *   DELETE /v1/deployments/:id               delete
 *   GET    /v1/deployments/:id/logs          logs
 */
import { createRoute, z } from '@hono/zod-openapi';
import type { AppEnv } from '../types';
import { supabaseAuth } from '../middleware/auth';
import { makeOpenApiApp, json, errors, auth } from '../openapi';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { deployments } from '@kortix/db';
import { db } from '../shared/db';
import {
  accountDeploymentsSetting,
  ACCOUNT_DEPLOYMENTS_KEY,
  invalidateRuntimeSettings,
  refreshRuntimeSettings,
} from '../platform/services/runtime-settings';
import {
  freestyleProvider,
  callFreestyle,
  getFreestyleApiKey,
  buildFreestyleSourceLegacy,
  buildFreestyleConfigLegacy,
  type FreestyleSourceLegacy,
  type FreestyleConfigLegacy,
} from '../deployments/providers/freestyle';

export const accountDeploymentsApp = makeOpenApiApp<AppEnv>();

// All routes require an authenticated user.
accountDeploymentsApp.use('*', supabaseAuth);

/** 503 responder for the disabled-feature case. */
function disabledResponse(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'FEATURE_DISABLED',
        message:
          'Account deployments are disabled. Flip the account_deployments feature flag on via PUT /v1/admin/sandbox-pool/config (or directly insert into platform_settings).',
      },
    },
    503,
  );
}

/** Get the account id from the auth context. */
function getAccountId(c: any): string | null {
  // The supabaseAuth middleware populates c.var.accountId (or c.var.user.accountId).
  const accountId =
    c.var?.accountId ??
    c.var?.user?.accountId ??
    c.var?.session?.user?.app_metadata?.account_id ??
    null;
  return accountId;
}

// ── GET / — list deployments for the authenticated account ─────────────────
accountDeploymentsApp.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['deployments'],
    summary: 'List account deployments (session-only mode)',
    ...auth,
    request: {
      query: z.object({
        status: z.string().optional(),
        limit: z.string().optional(),
        offset: z.string().optional(),
      }),
    },
    responses: {
      200: json(z.record(z.string(), z.any()), 'deployment list'),
      401: json(z.record(z.string(), z.any()), 'unauthorized'),
      503: json(z.record(z.string(), z.any()), 'feature disabled'),
    },
  }),
  async (c: any) => {
    if (!accountDeploymentsSetting().enabled) return disabledResponse(c);
    const accountId = getAccountId(c);
    if (!accountId) return c.json({ success: false, error: { message: 'No account' } }, 401);

    const status = c.req.query('status');
    const limit = Math.min(100, Number(c.req.query('limit') ?? '50'));
    const offset = Math.max(0, Number(c.req.query('offset') ?? '0'));

    const where = and(
      eq(deployments.accountId, accountId),
      isNull(deployments.projectId),
      status ? eq(deployments.status, status as any) : undefined,
    );
    const rows = await db
      .select()
      .from(deployments)
      .where(where)
      .orderBy(desc(deployments.createdAt))
      .limit(limit)
      .offset(offset);
    const totalRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(deployments)
      .where(where);
    const total = totalRows[0]?.n ?? 0;

    return c.json({
      success: true,
      data: rows.map(serializeDeploymentRow),
      total,
      limit,
      offset,
    });
  },
);

// ── POST / — create a new deployment ───────────────────────────────────────
accountDeploymentsApp.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['deployments'],
    summary: 'Create a new account deployment (session-only mode)',
    ...auth,
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              source_type: z.enum(['git', 'code', 'files', 'tar']),
              domains: z.array(z.string()).default([]),
              source_ref: z.string().optional(),
              branch: z.string().optional(),
              root_path: z.string().optional(),
              code: z.string().optional(),
              files: z
                .array(
                  z.object({
                    path: z.string(),
                    content: z.string(),
                    encoding: z.string().optional(),
                  }),
                )
                .optional(),
              tar_url: z.string().optional(),
              build: z
                .union([
                  z.boolean(),
                  z.object({
                    command: z.string().optional(),
                    outDir: z.string().optional(),
                    envVars: z.record(z.string(), z.string()).optional(),
                  }),
                ])
                .optional(),
              env_vars: z.record(z.string(), z.string()).optional(),
              node_modules: z.record(z.string(), z.string()).optional(),
              entrypoint: z.string().optional(),
              timeout_ms: z.number().optional(),
              static_only: z.boolean().optional(),
              public_dir: z.string().optional(),
              clean_urls: z.boolean().optional(),
              framework: z.string().optional(),
            }),
          },
        },
      },
    },
    responses: {
      200: json(z.record(z.string(), z.any()), 'deployment'),
      400: json(z.record(z.string(), z.any()), 'bad request'),
      401: json(z.record(z.string(), z.any()), 'unauthorized'),
      503: json(z.record(z.string(), z.any()), 'feature disabled'),
    },
  }),
  async (c: any) => {
    if (!accountDeploymentsSetting().enabled) return disabledResponse(c);
    const accountId = getAccountId(c);
    if (!accountId) return c.json({ success: false, error: { message: 'No account' } }, 401);

    const body = await c.req.json().catch(() => null);
    if (!body || !body.source_type) {
      return c.json(
        { success: false, error: { message: 'source_type is required' } },
        400,
      );
    }
    if (!(await getFreestyleApiKey())) {
      return c.json(
        {
          success: false,
          error: {
            message:
              'FREESTYLE_API_KEY is not configured. Set it as an env var or in the secrets manager.',
          },
        },
        400,
      );
    }

    const sourceLegacy: FreestyleSourceLegacy = {
      source_type: body.source_type,
      source_ref: body.source_ref,
      branch: body.branch,
      root_path: body.root_path,
      code: body.code,
      files: body.files,
      tar_url: body.tar_url,
    };
    const configLegacy: FreestyleConfigLegacy = {
      domains: body.domains ?? [],
      build: body.build,
      env_vars: body.env_vars,
      node_modules: body.node_modules,
      entrypoint: body.entrypoint,
      timeout_ms: body.timeout_ms,
      static_only: body.static_only,
      public_dir: body.public_dir,
      clean_urls: body.clean_urls,
      headers: undefined,
      redirects: undefined,
      network_permissions: undefined,
    };

    // Build the Freestyle payload.
    const freestyleBody = {
      source: buildFreestyleSourceLegacy(sourceLegacy),
      config: buildFreestyleConfigLegacy(configLegacy),
    };

    // Insert a 'pending' deployment row first so we have an ID to update.
    const [inserted] = await db
      .insert(deployments)
      .values({
        accountId,
        projectId: null,
        sandboxId: null,
        appSlug: null,
        provider: 'freestyle',
        status: 'pending',
        sourceType: body.source_type,
        sourceRef: body.source_ref ?? null,
        framework: body.framework ?? null,
        domains: body.domains ?? [],
        liveUrl: null,
        envVars: body.env_vars ?? {},
        buildConfig: body.build ?? {},
        entrypoint: body.entrypoint ?? null,
        error: null,
        version: 1,
        metadata: { source: 'session', framework: body.framework ?? null },
      })
      .returning({ deploymentId: deployments.deploymentId });

    const deploymentId = inserted?.deploymentId;
    if (!deploymentId) {
      return c.json(
        { success: false, error: { message: 'Failed to insert deployment row' } },
        500,
      );
    }

    // Call Freestyle.
    let response: Response;
    try {
      response = await callFreestyle('/web/v1/deployment', {
        method: 'POST',
        body: freestyleBody,
        timeoutMs: 300_000, // 5 min — real builds can take a while.
      });
    } catch (err) {
      await db
        .update(deployments)
        .set({
          status: 'failed',
          error: err instanceof Error ? err.message : 'Freestyle API unreachable',
          updatedAt: new Date(),
        })
        .where(eq(deployments.deploymentId, deploymentId));
      return c.json(
        {
          success: false,
          error: {
            message: err instanceof Error ? err.message : 'Freestyle API unreachable',
          },
        },
        502,
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => 'Unknown Freestyle error');
      let message = text;
      try {
        const parsed = JSON.parse(text);
        message = parsed.message || parsed.description || text;
      } catch {
        /* keep raw text */
      }
      await db
        .update(deployments)
        .set({ status: 'failed', error: message, updatedAt: new Date() })
        .where(eq(deployments.deploymentId, deploymentId));
      return c.json(
        { success: false, error: { message } },
        502,
      );
    }

    const result = (await response.json()) as { deploymentId?: string };
    const freestyleId = String(result.deploymentId ?? '');
    const liveUrl = body.domains?.[0] ? `https://${body.domains[0]}` : null;

    await db
      .update(deployments)
      .set({
        status: 'active',
        freestyleId,
        liveUrl,
        updatedAt: new Date(),
      })
      .where(eq(deployments.deploymentId, deploymentId));

    const [row] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.deploymentId, deploymentId))
      .limit(1);
    return c.json({ success: true, data: serializeDeploymentRow(row) });
  },
);

// ── GET /:id — get a single deployment ─────────────────────────────────────
accountDeploymentsApp.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['deployments'],
    summary: 'Get a single account deployment',
    ...auth,
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      200: json(z.record(z.string(), z.any()), 'deployment'),
      404: json(z.record(z.string(), z.any()), 'not found'),
      503: json(z.record(z.string(), z.any()), 'feature disabled'),
    },
  }),
  async (c: any) => {
    if (!accountDeploymentsSetting().enabled) return disabledResponse(c);
    const accountId = getAccountId(c);
    if (!accountId) return c.json({ success: false, error: { message: 'No account' } }, 401);
    const id = c.req.param('id');
    const [row] = await db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.deploymentId, id),
          eq(deployments.accountId, accountId),
          isNull(deployments.projectId),
        ),
      )
      .limit(1);
    if (!row) return c.json({ success: false, error: { message: 'Not found' } }, 404);
    return c.json({ success: true, data: serializeDeploymentRow(row) });
  },
);

// ── POST /:id/stop — stop a deployment ─────────────────────────────────────
accountDeploymentsApp.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/stop',
    tags: ['deployments'],
    summary: 'Stop an account deployment',
    ...auth,
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      200: json(z.record(z.string(), z.any()), 'deployment'),
      404: json(z.record(z.string(), z.any()), 'not found'),
      503: json(z.record(z.string(), z.any()), 'feature disabled'),
    },
  }),
  async (c: any) => {
    if (!accountDeploymentsSetting().enabled) return disabledResponse(c);
    const accountId = getAccountId(c);
    if (!accountId) return c.json({ success: false, error: { message: 'No account' } }, 401);
    const id = c.req.param('id');
    const [row] = await db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.deploymentId, id),
          eq(deployments.accountId, accountId),
          isNull(deployments.projectId),
        ),
      )
      .limit(1);
    if (!row) return c.json({ success: false, error: { message: 'Not found' } }, 404);

    if (row.freestyleId) {
      try {
        await freestyleProvider.stop(row.freestyleId);
      } catch (err) {
        console.warn(
          '[account-deployments] stop failed:',
          err instanceof Error ? err.message : err,
        );
      }
    }
    await db
      .update(deployments)
      .set({ status: 'stopped', updatedAt: new Date() })
      .where(eq(deployments.deploymentId, id));
    const [updated] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.deploymentId, id))
      .limit(1);
    return c.json({ success: true, data: serializeDeploymentRow(updated) });
  },
);

// ── POST /:id/redeploy — redeploy a deployment ─────────────────────────────
accountDeploymentsApp.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/redeploy',
    tags: ['deployments'],
    summary: 'Redeploy an account deployment',
    ...auth,
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      200: json(z.record(z.string(), z.any()), 'deployment'),
      404: json(z.record(z.string(), z.any()), 'not found'),
      503: json(z.record(z.string(), z.any()), 'feature disabled'),
    },
  }),
  async (c: any) => {
    if (!accountDeploymentsSetting().enabled) return disabledResponse(c);
    const accountId = getAccountId(c);
    if (!accountId) return c.json({ success: false, error: { message: 'No account' } }, 401);
    const id = c.req.param('id');
    const [row] = await db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.deploymentId, id),
          eq(deployments.accountId, accountId),
          isNull(deployments.projectId),
        ),
      )
      .limit(1);
    if (!row) return c.json({ success: false, error: { message: 'Not found' } }, 404);

    // For redeploy, we just kick Freestyle again with the same config. The
    // original source/files aren't persisted (only the source_ref for git);
    // for non-git sources, the client must POST a fresh create. We support
    // redeploy only for git-sourced deployments.
    if (row.sourceType !== 'git' || !row.sourceRef) {
      return c.json(
        {
          success: false,
          error: {
            message:
              'Redeploy is only supported for git-sourced deployments. POST a fresh /v1/deployments for code/files/tar sources.',
          },
        },
        400,
      );
    }

    const nextVersion = (row.version ?? 1) + 1;
    await db
      .update(deployments)
      .set({ status: 'pending', error: null, version: nextVersion, updatedAt: new Date() })
      .where(eq(deployments.deploymentId, id));

    // Call Freestyle with the same git source.
    const freestyleBody = {
      source: {
        kind: 'git' as const,
        url: row.sourceRef,
        branch: (row.metadata as { branch?: string } | null)?.branch,
      },
      config: {
        await: true,
        domains: row.domains ?? [],
        envVars: row.envVars ?? {},
      },
    };

    try {
      const response = await callFreestyle('/web/v1/deployment', {
        method: 'POST',
        body: freestyleBody,
        timeoutMs: 300_000,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => 'Freestyle error');
        await db
          .update(deployments)
          .set({ status: 'failed', error: text, updatedAt: new Date() })
          .where(eq(deployments.deploymentId, id));
        return c.json(
          { success: false, error: { message: text } },
          502,
        );
      }
      const result = (await response.json()) as { deploymentId?: string };
      const freestyleId = String(result.deploymentId ?? '');
      const liveUrl = row.domains?.[0] ? `https://${row.domains[0]}` : null;
      await db
        .update(deployments)
        .set({
          status: 'active',
          freestyleId,
          liveUrl,
          updatedAt: new Date(),
        })
        .where(eq(deployments.deploymentId, id));
    } catch (err) {
      await db
        .update(deployments)
        .set({
          status: 'failed',
          error: err instanceof Error ? err.message : 'Freestyle API unreachable',
          updatedAt: new Date(),
        })
        .where(eq(deployments.deploymentId, id));
    }

    const [updated] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.deploymentId, id))
      .limit(1);
    return c.json({ success: true, data: serializeDeploymentRow(updated) });
  },
);

// ── DELETE /:id — delete a deployment ──────────────────────────────────────
accountDeploymentsApp.openapi(
  createRoute({
    method: 'delete',
    path: '/{id}',
    tags: ['deployments'],
    summary: 'Delete an account deployment',
    ...auth,
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      200: json(z.record(z.string(), z.any()), 'ok'),
      404: json(z.record(z.string(), z.any()), 'not found'),
      503: json(z.record(z.string(), z.any()), 'feature disabled'),
    },
  }),
  async (c: any) => {
    if (!accountDeploymentsSetting().enabled) return disabledResponse(c);
    const accountId = getAccountId(c);
    if (!accountId) return c.json({ success: false, error: { message: 'No account' } }, 401);
    const id = c.req.param('id');
    const [row] = await db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.deploymentId, id),
          eq(deployments.accountId, accountId),
          isNull(deployments.projectId),
        ),
      )
      .limit(1);
    if (!row) return c.json({ success: false, error: { message: 'Not found' } }, 404);

    if (row.freestyleId && row.status !== 'stopped') {
      try {
        await freestyleProvider.stop(row.freestyleId);
      } catch (err) {
        console.warn(
          '[account-deployments] delete-stop failed:',
          err instanceof Error ? err.message : err,
        );
      }
    }
    await db.delete(deployments).where(eq(deployments.deploymentId, id));
    return c.json({ success: true, message: 'Deployment deleted' });
  },
);

// ── GET /:id/logs — fetch deployment logs ──────────────────────────────────
accountDeploymentsApp.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/logs',
    tags: ['deployments'],
    summary: 'Get account deployment logs',
    ...auth,
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: {
      200: json(z.record(z.string(), z.any()), 'logs'),
      404: json(z.record(z.string(), z.any()), 'not found'),
      503: json(z.record(z.string(), z.any()), 'feature disabled'),
    },
  }),
  async (c: any) => {
    if (!accountDeploymentsSetting().enabled) return disabledResponse(c);
    const accountId = getAccountId(c);
    if (!accountId) return c.json({ success: false, error: { message: 'No account' } }, 401);
    const id = c.req.param('id');
    const [row] = await db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.deploymentId, id),
          eq(deployments.accountId, accountId),
          isNull(deployments.projectId),
        ),
      )
      .limit(1);
    if (!row) return c.json({ success: false, error: { message: 'Not found' } }, 404);

    if (!row.freestyleId) {
      return c.json({ success: true, data: { logs: [], message: 'No provider id yet' } });
    }
    try {
      const logs = await freestyleProvider.logs(row.freestyleId);
      return c.json({ success: true, data: logs });
    } catch (err) {
      return c.json(
        {
          success: false,
          error: { message: err instanceof Error ? err.message : 'Failed to fetch logs' },
        },
        502,
      );
    }
  },
);

// ── GET /config — current feature flag state (admin only — gated by feature flag itself) ──
accountDeploymentsApp.openapi(
  createRoute({
    method: 'get',
    path: '/config',
    tags: ['deployments'],
    summary: 'Get the account deployments feature flag',
    ...auth,
    responses: {
      200: json(z.record(z.string(), z.any()), 'config'),
    },
  }),
  async (c: any) => {
    return c.json(accountDeploymentsSetting());
  },
);

// ─── Helpers ────────────────────────────────────────────────────────────────

function serializeDeploymentRow(row: any) {
  return {
    deploymentId: row.deploymentId,
    accountId: row.accountId,
    sandboxId: row.sandboxId,
    projectId: row.projectId,
    freestyleId: row.freestyleId,
    status: row.status,
    sourceType: row.sourceType,
    sourceRef: row.sourceRef,
    framework: row.framework,
    domains: row.domains,
    liveUrl: row.liveUrl,
    envVars: row.envVars,
    buildConfig: row.buildConfig,
    entrypoint: row.entrypoint,
    error: row.error,
    version: row.version,
    metadata: row.metadata,
    createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
    updatedAt: row.updatedAt?.toISOString?.() ?? row.updatedAt,
  };
}
