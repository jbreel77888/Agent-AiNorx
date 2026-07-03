/**
 * Session routes — simple-mode session management + file API.
 *
 * When KORTIX_SESSION_MODE=simple, these endpoints replace the Git-based
 * project/session operations. Sessions are standalone, no GitHub needed.
 *
 * Routes:
 *   POST   /v1/sessions                    — create a new standalone session
 *   GET    /v1/sessions                    — list user's sessions
 *   GET    /v1/sessions/:sessionId         — get session details
 *   DELETE /v1/sessions/:sessionId         — delete session + workspace
 *   POST   /v1/sessions/:sessionId/start   — start/resume session
 *   GET    /v1/sessions/:sessionId/files   — list files
 *   GET    /v1/sessions/:sessionId/files/content — read file
 *   POST   /v1/sessions/:sessionId/files   — write file
 *   PUT    /v1/sessions/:sessionId/files/raw — upload binary
 *   DELETE /v1/sessions/:sessionId/files   — delete file
 *   POST   /v1/sessions/:sessionId/workspace — create workspace
 *   DELETE /v1/sessions/:sessionId/workspace — delete workspace
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { config } from '../config';
import { supabaseAuth } from '../middleware/auth';
import { db } from '../shared/db';
import { projectSessions, sessionSandboxes } from '@kortix/db';
import { eq, desc } from 'drizzle-orm';
import { resolveAccountId } from '../shared/resolve-account';
import * as workspaceStore from './workspace-store';
import { getProvider } from '../platform/providers';
import type { SandboxProviderName } from '../config';
import { ensureOpencodeSessionPin } from '../projects/opencode-mapping';

export const sessionFilesApp = new Hono();

// Auth middleware — all routes require authentication
sessionFilesApp.use('*', supabaseAuth);

// ─── Ownership helper ──────────────────────────────────────────────────────────
// Verifies that the session belongs to the calling account.
// Returns 404 if not found, 403 if owned by another account.
// Security: every /:sessionId handler MUST call this before doing any work.
async function assertSessionOwnership(c: any, sessionId: string, accountId: string) {
  const [row] = await db
    .select({ accountId: projectSessions.accountId })
    .from(projectSessions)
    .where(eq(projectSessions.sessionId, sessionId))
    .limit(1);
  if (!row) {
    return c.json({ error: 'Session not found' }, 404);
  }
  if (row.accountId !== accountId) {
    return c.json({ error: 'Forbidden: session does not belong to your account' }, 403);
  }
  return null; // ownership verified
}

// Convenience: resolve accountId from JWT (most handlers need this)
async function resolveAccountIdFromContext(c: any): Promise<string | null> {
  const userId = c.get('userId') as string;
  let accountId = c.get('accountId') as string;
  if (!accountId && userId) {
    accountId = await resolveAccountId(userId);
  }
  return accountId || null;
}

// ─── Create standalone session (simple mode) ─────────────────────────────────

sessionFilesApp.post('/', async (c) => {
  const userId = c.get('userId') as string;
  // For JWT auth, accountId isn't set by middleware — resolve it from the user's account membership
  let accountId = c.get('accountId') as string;
  if (!accountId && userId) {
    accountId = await resolveAccountId(userId);
  }

  if (!accountId) {
    return c.json({ error: 'Account ID required — no account membership found' }, 400);
  }

  const body = await c.req.json().catch(() => ({})) as {
    name?: string;
    initial_prompt?: string;
    opencode_model?: string;
    session_id?: string; // client-provided UUID for optimistic creation
  };

  // Use client-provided UUID if present (optimistic creation pattern)
  const sessionId = body.session_id || crypto.randomUUID();
  const now = new Date();

  // Insert session row — projectId is null in simple mode
  await db.insert(projectSessions).values({
    sessionId,
    accountId,
    projectId: null,  // no project in simple mode
    status: 'provisioning',
    visibility: 'private',
    branchName: null,  // no git branch in simple mode
    sandboxId: sessionId,
    metadata: {
      name: body.name || 'New Session',
      source: 'ui',
      session_mode: 'simple',
      initial_prompt: body.initial_prompt || null,
      opencode_model: body.opencode_model || null,
    },
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing();

  // Create workspace for file storage
  await workspaceStore.createWorkspace(sessionId, accountId);

  // Trigger sandbox provisioning in the background (fire-and-forget, like project mode)
  // We call provisionSessionSandbox with a minimal gitProject (empty repo URL)
  // — the daemon will skip git clone because KORTIX_SESSION_MODE=simple is in env
  void (async () => {
    try {
      const { provisionSessionSandbox } = await import('../platform/services/session-sandbox');
      const { buildSessionRuntimeEnv } = await import('../projects/lib/session-runtime-env');
      const { sandboxFrontendBaseUrl } = await import('../platform/sandbox-frontend-url');

      const kortixOrigin = config.KORTIX_URL?.replace(/\/+$/, '') || 'http://localhost:8008';
      const runtimeEnv = buildSessionRuntimeEnv({
        sessionId,
        agentName: 'default',
        apiUrl: `${kortixOrigin}/v1`,
        frontendUrl: sandboxFrontendBaseUrl(),
        initialPrompt: body.initial_prompt || null,
        opencodeModel: body.opencode_model || null,
        sessionMode: 'simple',
      });

      await provisionSessionSandbox({
        sandboxId: sessionId,
        accountId,
        // Use a nil UUID for projectId — the column is UUID type and FK is dropped
        projectId: '00000000-0000-0000-0000-000000000000' as any,
        userId,
        agentName: 'default',
        provider: (config.ALLOWED_SANDBOX_PROVIDERS as readonly string[])[0] as any,
        metadata: {
          session_id: sessionId,
          session_mode: 'simple',
          name: body.name || 'New Session',
        },
        extraEnvVars: {
          ...runtimeEnv,
          KORTIX_PROJECT_AUTO_CLONE: '0', // don't auto-clone — daemon will mkdir /workspace
        },
        gitProject: {
          projectId: '00000000-0000-0000-0000-000000000000',
          repoUrl: '', // empty — daemon skips clone in simple mode
          defaultBranch: 'main',
          manifestPath: 'vaelorx.toml',
          gitAuthToken: null,
        },
        baseRef: 'main',
      });

      console.log(`[sessions] Sandbox provisioned for ${sessionId}`);
    } catch (err) {
      console.error(`[sessions] Sandbox provisioning failed for ${sessionId}:`, err);
      // Mark session as failed
      await db
        .update(projectSessions)
        .set({
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          updatedAt: new Date(),
        })
        .where(eq(projectSessions.sessionId, sessionId));
    }
  })();

  return c.json({
    session_id: sessionId,
    status: 'provisioning',
    name: body.name || 'New Session',
    session_mode: 'simple',
  }, 201);
});

// ─── List user's sessions ────────────────────────────────────────────────────
// Excludes deleted/archived sessions — they should NOT reappear in the sidebar.
const EXCLUDED_STATUSES = ['deleted', 'archived'] as const;

sessionFilesApp.get('/', async (c) => {
  const userId = c.get('userId') as string;
  let accountId = c.get('accountId') as string;
  if (!accountId && userId) {
    accountId = await resolveAccountId(userId);
  }
  if (!accountId) return c.json({ sessions: [] });

  const sessions = await db
    .select({
      sessionId: projectSessions.sessionId,
      status: projectSessions.status,
      metadata: projectSessions.metadata,
      createdAt: projectSessions.createdAt,
      updatedAt: projectSessions.updatedAt,
    })
    .from(projectSessions)
    .where(
      eq(projectSessions.accountId, accountId),
      // Filter out deleted/archived — they should not appear in the sidebar
    )
    .orderBy(desc(projectSessions.updatedAt))
    .limit(50);

  // Client-side filter (drizzle neq on text column is finicky across schemas;
  // a JS filter is safer and only operates on 50 rows)
  const visible = sessions.filter(s => !EXCLUDED_STATUSES.includes(s.status as any));

  return c.json({
    sessions: visible.map(s => ({
      session_id: s.sessionId,
      status: s.status,
      name: (s.metadata as any)?.name || 'Untitled',
      created_at: s.createdAt,
      updated_at: s.updatedAt,
    })),
  });
});

// ─── Bulk delete sessions ─────────────────────────────────────────────────────
// POST /v1/sessions/bulk-delete  body: { session_ids: string[] }
// Returns { ok: true, deleted: string[], failed: { id, error }[] }
// Processes sessions sequentially (Tensorlake trial plan = 1 concurrent sandbox)
// so we don't trigger 429s from racing provider.remove() calls.
sessionFilesApp.post('/bulk-delete', async (c) => {
  const userId = c.get('userId') as string;
  let accountId = c.get('accountId') as string;
  if (!accountId && userId) {
    accountId = await resolveAccountId(userId);
  }
  if (!accountId) return c.json({ error: 'Account ID required' }, 400);

  const body = await c.req.json().catch(() => ({})) as { session_ids?: string[] };
  const ids = Array.isArray(body.session_ids) ? body.session_ids : [];
  if (ids.length === 0) return c.json({ ok: true, deleted: [], failed: [] });

  // Cap to avoid abuse
  if (ids.length > 100) {
    return c.json({ error: 'Too many sessions in one request (max 100)' }, 400);
  }

  // SECURITY: Only allow deleting sessions owned by the calling account.
  // Without this, a user could terminate other accounts' sandboxes by
  // guessing session IDs.
  const ownedRows = await db
    .select({ sessionId: projectSessions.sessionId })
    .from(projectSessions)
    .where(eq(projectSessions.accountId, accountId));
  const ownedIds = new Set(ownedRows.map((r) => r.sessionId));
  const safeIds = ids.filter((id) => ownedIds.has(id));
  // Rejected IDs are silently dropped — do not disclose which IDs exist
  // but belong to other accounts (that would be an info leak).

  const deleted: string[] = [];
  const failed: { id: string; error: string }[] = [];

  // Sequential to avoid hitting Tensorlake's rate limit
  for (const sessionId of safeIds) {
    try {
      // Look up sandbox for this session
      const [sandbox] = await db
        .select()
        .from(sessionSandboxes)
        .where(eq(sessionSandboxes.sandboxId, sessionId))
        .limit(1);

      // Terminate sandbox at provider (best-effort)
      if (sandbox?.externalId && sandbox.provider) {
        try {
          const provider = getProvider(sandbox.provider as SandboxProviderName);
          await provider.remove(sandbox.externalId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[sessions:bulk-delete] sandbox ${sandbox.externalId}: ${msg}`);
          // Don't fail the whole operation — the sandbox may already be gone
        }
      }

      // Delete workspace (R2 + DB files)
      try {
        await workspaceStore.deleteWorkspace(sessionId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[sessions:bulk-delete] workspace ${sessionId}: ${msg}`);
      }

      // Mark session as deleted
      await db
        .update(projectSessions)
        .set({ status: 'deleted', updatedAt: new Date() })
        .where(eq(projectSessions.sessionId, sessionId));

      // Mark sandbox as archived
      await db
        .update(sessionSandboxes)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(eq(sessionSandboxes.sandboxId, sessionId));

      deleted.push(sessionId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sessions:bulk-delete] session ${sessionId}:`, err);
      failed.push({ id: sessionId, error: msg });
    }
  }

  return c.json({ ok: true, deleted, failed });
});

// ─── Get session details ─────────────────────────────────────────────────────

sessionFilesApp.get('/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');
  const accountId = await resolveAccountIdFromContext(c);
  if (!accountId) return c.json({ error: 'Account ID required' }, 400);

  const ownershipError = await assertSessionOwnership(c, sessionId, accountId);
  if (ownershipError) return ownershipError;

  const [session] = await db
    .select()
    .from(projectSessions)
    .where(eq(projectSessions.sessionId, sessionId))
    .limit(1);

  if (!session) return c.json({ error: 'Session not found' }, 404);

  // Get sandbox info if exists
  const [sandbox] = await db
    .select({
      externalId: sessionSandboxes.externalId,
      status: sessionSandboxes.status,
      provider: sessionSandboxes.provider,
    })
    .from(sessionSandboxes)
    .where(eq(sessionSandboxes.sandboxId, sessionId))
    .limit(1);

  return c.json({
    session_id: session.sessionId,
    status: session.status,
    name: (session.metadata as any)?.name || 'Untitled',
    session_mode: (session.metadata as any)?.session_mode || 'project',
    sandbox: sandbox ? {
      external_id: sandbox.externalId,
      status: sandbox.status,
      provider: sandbox.provider,
    } : null,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  });
});

// ─── Delete session ──────────────────────────────────────────────────────────

sessionFilesApp.delete('/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');
  const accountId = await resolveAccountIdFromContext(c);
  if (!accountId) return c.json({ error: 'Account ID required' }, 400);

  const ownershipError = await assertSessionOwnership(c, sessionId, accountId);
  if (ownershipError) return ownershipError;

  // Look up the sandbox BEFORE updating DB rows so we can terminate it.
  const [sandbox] = await db
    .select()
    .from(sessionSandboxes)
    .where(eq(sessionSandboxes.sandboxId, sessionId))
    .limit(1);

  // Actually terminate the sandbox at the provider (best-effort).
  // This was previously missing — sandboxes accumulated in Tensorlake until
  // the trial plan's 1-concurrent-sandbox quota was hit.
  if (sandbox?.externalId && sandbox.provider) {
    try {
      const provider = getProvider(sandbox.provider as SandboxProviderName);
      await provider.remove(sandbox.externalId);
      console.log(`[sessions] Terminated sandbox ${sandbox.externalId} for session ${sessionId}`);
    } catch (err) {
      // Don't fail the delete if the sandbox is already gone (404) — just log.
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[sessions] Failed to terminate sandbox ${sandbox.externalId}: ${msg}`);
    }
  }

  // Delete workspace (R2 + DB files)
  await workspaceStore.deleteWorkspace(sessionId);

  // Mark session as deleted
  await db
    .update(projectSessions)
    .set({ status: 'deleted', updatedAt: new Date() })
    .where(eq(projectSessions.sessionId, sessionId));

  // Mark sandbox as archived
  await db
    .update(sessionSandboxes)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(eq(sessionSandboxes.sandboxId, sessionId));

  return c.json({ ok: true });
});

// ─── Start/resume session (simple mode equivalent of POST /v1/projects/:id/sessions/:sid/start) ──

sessionFilesApp.post('/:sessionId/start', async (c) => {
  const sessionId = c.req.param('sessionId');
  const userId = c.get('userId') as string;
  const accountId = await resolveAccountIdFromContext(c);
  if (!accountId) return c.json({ error: 'Account ID required' }, 400);

  const ownershipError = await assertSessionOwnership(c, sessionId, accountId);
  if (ownershipError) return ownershipError;

  // Look up the session
  const [session] = await db
    .select()
    .from(projectSessions)
    .where(eq(projectSessions.sessionId, sessionId))
    .limit(1);

  if (!session) return c.json({ error: 'Session not found' }, 404);

  // Look up the sandbox
  const [sandbox] = await db
    .select()
    .from(sessionSandboxes)
    .where(eq(sessionSandboxes.sandboxId, sessionId))
    .limit(1);

  // No sandbox yet — still provisioning (fire-and-forget provisioning kicked
  // off by POST /sessions runs in the background; client keeps polling).
  if (!sandbox || !sandbox.externalId) {
    return c.json({
      stage: 'provisioning',
      retriable: true,
      sandbox: null,
      opencode_session_id: null,
    });
  }

  // Sandbox error — terminal.
  if (sandbox.status === 'error') {
    return c.json({
      stage: 'failed',
      retriable: false,
      sandbox: {
        sandbox_id: sandbox.sandboxId,
        session_id: sessionId,
        external_id: sandbox.externalId,
        status: sandbox.status,
        provider: sandbox.provider,
      },
      opencode_session_id: null,
      reason: 'sandbox_error',
    });
  }

  // Confirm the box is actually running at the provider. The DB row may lag —
  // the provider can idle-auto-stop a box while the row still reads 'active'.
  // Mirrors the project-mode openSession flow.
  let providerStatus: 'running' | 'stopped' | 'removed' | 'unknown' = 'unknown';
  try {
    const provider = getProvider(sandbox.provider as SandboxProviderName);
    const status = await provider.getStatus(sandbox.externalId);
    providerStatus = status as any;
  } catch (err) {
    console.warn(`[sessions/start] getStatus failed for ${sandbox.externalId}:`, err);
  }

  if (providerStatus === 'removed') {
    // Sandbox was terminated out-of-band. Mark error and let the UI show failed.
    await db
      .update(sessionSandboxes)
      .set({ status: 'error', updatedAt: new Date() })
      .where(eq(sessionSandboxes.sandboxId, sessionId));
    return c.json({
      stage: 'failed',
      retriable: false,
      sandbox: {
        sandbox_id: sandbox.sandboxId,
        session_id: sessionId,
        external_id: sandbox.externalId,
        status: 'error',
        provider: sandbox.provider,
      },
      opencode_session_id: null,
      reason: 'runtime_removed',
    });
  }

  if (providerStatus !== 'running') {
    // Idle auto-stop: kick the start in the background; the client keeps polling.
    if (providerStatus === 'stopped') {
      try {
        const provider = getProvider(sandbox.provider as SandboxProviderName);
        void provider.start(sandbox.externalId).catch((err) => {
          console.warn(`[sessions/start] failed to wake sandbox ${sandbox.externalId}:`, err);
        });
      } catch (err) {
        console.warn(`[sessions/start] failed to start provider:`, err);
      }
    }
    return c.json({
      stage: 'starting',
      retriable: true,
      sandbox: null,
      opencode_session_id: null,
      reason: providerStatus === 'stopped' ? 'runtime_waking' : 'runtime_status_unknown',
    });
  }

  // Box is provider-running. Resolve OpenCode readiness + the canonical pin
  // server-side. The pin is what the frontend needs to mount SessionChat.
  // Use a sentinel projectId (nil UUID) for the simple-mode session — the
  // ensureOpencodeSessionPin function uses it only for the DB update WHERE
  // clause, and in simple mode project_id is NULL so we match on sessionId
  // alone via a separate update below if the pin needs to be persisted.
  const currentPin = session.opencodeSessionId ?? null;
  let ensured;
  try {
    ensured = await ensureOpencodeSessionPin({
      projectId: '00000000-0000-0000-0000-000000000000',
      sessionId,
      accountId: session.accountId,
      externalId: sandbox.externalId,
      userId,
      currentPin,
    });
  } catch (err) {
    console.warn(`[sessions/start] ensureOpencodeSessionPin failed:`, err);
    ensured = { pin: currentPin, changed: false, reason: 'unreachable' } as any;
  }

  // If the pin changed and ensureOpencodeSessionPin couldn't persist it (because
  // it tried to match on projectId=NULL via the FK), persist it directly here.
  if (ensured.pin && ensured.pin !== currentPin) {
    await db
      .update(projectSessions)
      .set({ opencodeSessionId: ensured.pin, updatedAt: new Date() })
      .where(eq(projectSessions.sessionId, sessionId))
      .catch((err) => console.warn(`[sessions/start] failed to persist pin:`, err));
  }

  const booting = ensured.reason === 'not_ready' || ensured.reason === 'unreachable';
  return c.json({
    stage: booting ? 'starting' : 'ready',
    retriable: booting,
    sandbox: {
      sandbox_id: sandbox.sandboxId,
      session_id: sessionId,
      external_id: sandbox.externalId,
      status: 'active',
      provider: sandbox.provider,
    },
    opencode_session_id: ensured.pin,
    reason: ensured.reason,
  });
});

// ─── Sandbox health (bypasses Tensorlake proxy via SDK) ──────────────────────
// The frontend's useSandboxConnection polls this to check if the daemon is ready.
// We use the SDK to run curl inside the sandbox (localhost:8000) instead of
// going through the Tensorlake proxy (which returns 502).

sessionFilesApp.get('/:sessionId/health', async (c) => {
  const sessionId = c.req.param('sessionId');
  const accountId = await resolveAccountIdFromContext(c);
  if (!accountId) return c.json({ error: 'Account ID required' }, 400);

  const ownershipError = await assertSessionOwnership(c, sessionId, accountId);
  if (ownershipError) return ownershipError;

  const [sandbox] = await db
    .select()
    .from(sessionSandboxes)
    .where(eq(sessionSandboxes.sandboxId, sessionId))
    .limit(1);

  if (!sandbox || !sandbox.externalId) {
    return c.json({ status: 'provisioning', runtimeReady: false }, 200);
  }

  try {
    const { Sandbox } = await import('../shared/tensorlake');
    const sb = await Sandbox.connect({ sandboxId: sandbox.externalId });
    const result = await sb.run('bash', {
      args: ['-c', 'curl -s http://localhost:8000/kortix/health'],
      timeout: 5,
    });
    const healthJson = String((result as any).stdout ?? '').trim();
    const health = JSON.parse(healthJson);
    return c.json(health, 200);
  } catch (err) {
    return c.json({
      status: 'error',
      runtimeReady: false,
      error: err instanceof Error ? err.message : String(err),
    }, 200);
  }
});

// ─── SDK bridge: proxy ANY request to the daemon via SDK ─────────────────────
// The Tensorlake HTTP proxy (https://8000-<id>.sandbox.tensorlake.ai) is broken
// (returns 502 for all requests). This endpoint bridges the frontend to the
// daemon by executing curl INSIDE the sandbox via the SDK's native gRPC transport.
//
// Frontend calls: POST /v1/sessions/:sessionId/proxy
// Body: { method, path, headers?, body? }
// Returns: { status, headers, body }

sessionFilesApp.post('/:sessionId/proxy', async (c) => {
  const sessionId = c.req.param('sessionId');
  const accountId = await resolveAccountIdFromContext(c);
  if (!accountId) return c.json({ error: 'Account ID required' }, 400);

  const ownershipError = await assertSessionOwnership(c, sessionId, accountId);
  if (ownershipError) return ownershipError;

  const [sandbox] = await db
    .select()
    .from(sessionSandboxes)
    .where(eq(sessionSandboxes.sandboxId, sessionId))
    .limit(1);

  if (!sandbox || !sandbox.externalId) {
    return c.json({ status: 503, body: 'Sandbox not ready' }, 503);
  }

  const reqBody = await c.req.json().catch(() => ({})) as {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
  };

  if (!reqBody.path) {
    return c.json({ error: 'path is required' }, 400);
  }

  const method = (reqBody.method || 'GET').toUpperCase();
  const daemonPath = reqBody.path.startsWith('/') ? reqBody.path : `/${reqBody.path}`;
  const url = `http://localhost:8000${daemonPath}`;

  try {
    const { Sandbox } = await import('../shared/tensorlake');
    const sb = await Sandbox.connect({ sandboxId: sandbox.externalId });

    // Build the curl command
    const curlParts = ['curl', '-s', '-w', '\n%{http_code}'];
    
    // Add method
    if (method !== 'GET') {
      curlParts.push('-X', method);
    }

    // Add headers (skip Authorization — the daemon's /kortix/* endpoints don't need it,
    // and /session requires X-Kortix-User-Context which is complex to sign here.
    // The daemon's /kortix/health already provides the opencode_session_id.)
    if (reqBody.headers) {
      for (const [key, value] of Object.entries(reqBody.headers)) {
        if (key.toLowerCase() === 'content-length') continue;
        curlParts.push('-H', `${key}: ${value}`);
      }
    }

    // Add body
    if (reqBody.body && method !== 'GET') {
      // Write body to a temp file to avoid shell escaping issues
      const bodyFile = `/tmp/proxy_body_${Date.now()}.json`;
      const writeResult = await sb.run('bash', {
        args: ['-c', `cat > ${bodyFile}`],
        stdin: reqBody.body,
        timeout: 5,
      });
      curlParts.push('-d', `@${bodyFile}`);
    }

    curlParts.push(url);

    const result = await sb.run('bash', {
      args: ['-c', curlParts.map(p => `'${p.replace(/'/g, "'\\''")}'`).join(' ')],
      timeout: 15,
    });

    const output = String((result as any).stdout ?? '');
    // The last line is the HTTP status code (from -w '\n%{http_code}')
    const lines = output.split('\n');
    const statusCode = parseInt(lines[lines.length - 1] || '0', 10) || 502;
    const responseBody = lines.slice(0, -1).join('\n');

    // Try to parse as JSON, otherwise return as text
    let parsed: unknown = responseBody;
    try {
      parsed = JSON.parse(responseBody);
    } catch {
      // keep as string
    }

    return c.json({ status: statusCode, body: parsed }, 200);
  } catch (err) {
    console.error(`[sessions/proxy] failed:`, err);
    return c.json({
      status: 502,
      body: err instanceof Error ? err.message : String(err),
    }, 200);
  }
});

// ─── Rename session ──────────────────────────────────────────────────────────

sessionFilesApp.patch('/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');
  const userId = c.get('userId') as string;
  let accountId = c.get('accountId') as string;
  if (!accountId && userId) {
    accountId = await resolveAccountId(userId);
  }
  if (!accountId) return c.json({ error: 'Account ID required' }, 400);

  const body = await c.req.json().catch(() => ({})) as { name?: string };

  if (!body.name || !body.name.trim()) {
    return c.json({ error: 'name is required' }, 400);
  }

  // Verify ownership + fetch current metadata so we merge instead of replace.
  // (Previous code did `metadata: { name: body.name }` which destroyed
  //  session_mode, initial_prompt, opencode_model, source, etc.)
  const [existing] = await db
    .select({
      accountId: projectSessions.accountId,
      metadata: projectSessions.metadata,
    })
    .from(projectSessions)
    .where(eq(projectSessions.sessionId, sessionId))
    .limit(1);

  if (!existing) return c.json({ error: 'Session not found' }, 404);
  if (existing.accountId !== accountId) {
    return c.json({ error: 'Forbidden: session does not belong to your account' }, 403);
  }

  const currentMeta = (existing.metadata as Record<string, unknown>) ?? {};
  const newName = body.name.trim();

  await db
    .update(projectSessions)
    .set({
      metadata: {
        ...currentMeta,
        name: newName,
        custom_name: newName,
      },
      updatedAt: new Date(),
    })
    .where(eq(projectSessions.sessionId, sessionId));

  return c.json({ ok: true, name: newName });
});

// ─── Restart session ─────────────────────────────────────────────────────────

sessionFilesApp.post('/:sessionId/restart', async (c) => {
  const sessionId = c.req.param('sessionId');
  const accountId = await resolveAccountIdFromContext(c);
  if (!accountId) return c.json({ error: 'Account ID required' }, 400);

  const ownershipError = await assertSessionOwnership(c, sessionId, accountId);
  if (ownershipError) return ownershipError;

  const [sandbox] = await db
    .select()
    .from(sessionSandboxes)
    .where(eq(sessionSandboxes.sandboxId, sessionId))
    .limit(1);

  if (!sandbox || !sandbox.externalId) {
    return c.json({ error: 'Sandbox not found' }, 404);
  }

  try {
    const { getProvider } = await import('../platform/providers');
    const provider = getProvider(sandbox.provider as any);
    // Stop then start
    await provider.stop(sandbox.externalId).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));
    await provider.start(sandbox.externalId);

    // Reset session status
    await db
      .update(projectSessions)
      .set({ status: 'running', updatedAt: new Date() })
      .where(eq(projectSessions.sessionId, sessionId));

    return c.json({ ok: true, status: 'restarting' });
  } catch (err) {
    return c.json({
      error: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});

// ─── List files ───────────────────────────────────────────────────────────────

sessionFilesApp.get('/:sessionId/files', async (c) => {
  const sessionId = c.req.param('sessionId');
  const accountId = await resolveAccountIdFromContext(c);
  if (!accountId) return c.json({ error: 'Account ID required' }, 400);
  const ownershipError = await assertSessionOwnership(c, sessionId, accountId);
  if (ownershipError) return ownershipError;
  const files = await workspaceStore.listFiles(sessionId);
  return c.json({ files });
});

// ─── Read file content ────────────────────────────────────────────────────────

sessionFilesApp.get('/:sessionId/files/content', async (c) => {
  const sessionId = c.req.param('sessionId');
  const accountId = await resolveAccountIdFromContext(c);
  if (!accountId) return c.json({ error: 'Account ID required' }, 400);
  const ownershipError = await assertSessionOwnership(c, sessionId, accountId);
  if (ownershipError) return ownershipError;
  const path = c.req.query('path');
  if (!path) return c.json({ error: 'path query parameter required' }, 400);

  const file = await workspaceStore.readFile(sessionId, path);
  if (!file) return c.json({ error: 'File not found' }, 404);

  if (file.isBinary) {
    return new Response(file.content as Buffer, {
      headers: {
        'Content-Type': file.mimeType ?? 'application/octet-stream',
        'Content-Length': String(file.sizeBytes),
      },
    });
  }

  return c.text(file.content as string);
});

// ─── Write/create file ───────────────────────────────────────────────────────

sessionFilesApp.post('/:sessionId/files', async (c) => {
  const sessionId = c.req.param('sessionId');
  const accountId = await resolveAccountIdFromContext(c);
  if (!accountId) return c.json({ error: 'Account ID required' }, 400);
  const ownershipError = await assertSessionOwnership(c, sessionId, accountId);
  if (ownershipError) return ownershipError;
  const body = await c.req.json().catch(() => null);

  if (!body || !body.path) {
    return c.json({ error: 'path is required in the request body' }, 400);
  }

  const { path, content, mimeType } = body as {
    path: string;
    content: string;
    mimeType?: string;
  };

  await workspaceStore.writeFile(sessionId, path, content, mimeType);
  return c.json({ ok: true, path });
});

// ─── Write file via raw body (for binary uploads) ─────────────────────────────

sessionFilesApp.put('/:sessionId/files/raw', async (c) => {
  const sessionId = c.req.param('sessionId');
  const accountId = await resolveAccountIdFromContext(c);
  if (!accountId) return c.json({ error: 'Account ID required' }, 400);
  const ownershipError = await assertSessionOwnership(c, sessionId, accountId);
  if (ownershipError) return ownershipError;
  const path = c.req.query('path');
  if (!path) return c.json({ error: 'path query parameter required' }, 400);

  const mimeType = c.req.header('Content-Type') ?? 'application/octet-stream';
  const body = await c.req.arrayBuffer();
  const buffer = Buffer.from(body);

  await workspaceStore.writeFile(sessionId, path, buffer, mimeType);
  return c.json({ ok: true, path, size: buffer.length });
});

// ─── Delete file ──────────────────────────────────────────────────────────────

sessionFilesApp.delete('/:sessionId/files', async (c) => {
  const sessionId = c.req.param('sessionId');
  const accountId = await resolveAccountIdFromContext(c);
  if (!accountId) return c.json({ error: 'Account ID required' }, 400);
  const ownershipError = await assertSessionOwnership(c, sessionId, accountId);
  if (ownershipError) return ownershipError;
  const path = c.req.query('path');
  if (!path) return c.json({ error: 'path query parameter required' }, 400);

  await workspaceStore.removeFile(sessionId, path);
  return c.json({ ok: true });
});

// ─── Create workspace (called when a new session is created) ──────────────────

sessionFilesApp.post('/:sessionId/workspace', async (c) => {
  const sessionId = c.req.param('sessionId');
  const accountId = await resolveAccountIdFromContext(c);
  if (!accountId) return c.json({ error: 'Account ID required' }, 400);
  const ownershipError = await assertSessionOwnership(c, sessionId, accountId);
  if (ownershipError) return ownershipError;

  await workspaceStore.createWorkspace(sessionId, accountId!);
  return c.json({ ok: true });
});

// ─── Delete workspace (called when a session is deleted) ─────────────────────

sessionFilesApp.delete('/:sessionId/workspace', async (c) => {
  const sessionId = c.req.param('sessionId');
  const accountId = await resolveAccountIdFromContext(c);
  if (!accountId) return c.json({ error: 'Account ID required' }, 400);
  const ownershipError = await assertSessionOwnership(c, sessionId, accountId);
  if (ownershipError) return ownershipError;
  await workspaceStore.deleteWorkspace(sessionId);
  return c.json({ ok: true });
});
