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

export const sessionFilesApp = new Hono();

// Auth middleware — all routes require authentication
sessionFilesApp.use('*', supabaseAuth);

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
        projectId: 'sessions', // virtual project ID — provisionSessionSandbox needs one
        userId,
        agentName: 'default',
        provider: config.ALLOWED_SANDBOX_PROVIDERS.split(',')[0] as any,
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
          projectId: 'sessions',
          repoUrl: '', // empty — daemon skips clone in simple mode
          defaultBranch: 'main',
          manifestPath: 'kortix.toml',
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
    .where(eq(projectSessions.accountId, accountId))
    .orderBy(desc(projectSessions.updatedAt))
    .limit(50);

  return c.json({
    sessions: sessions.map(s => ({
      session_id: s.sessionId,
      status: s.status,
      name: (s.metadata as any)?.name || 'Untitled',
      created_at: s.createdAt,
      updated_at: s.updatedAt,
    })),
  });
});

// ─── Get session details ─────────────────────────────────────────────────────

sessionFilesApp.get('/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');

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

  // Delete workspace (R2 + DB files)
  await workspaceStore.deleteWorkspace(sessionId);

  // Mark session as deleted
  await db
    .update(projectSessions)
    .set({ status: 'deleted', updatedAt: new Date() })
    .where(eq(projectSessions.sessionId, sessionId));

  // Mark sandbox as archived if exists
  await db
    .update(sessionSandboxes)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(eq(sessionSandboxes.sandboxId, sessionId));

  return c.json({ ok: true });
});

// ─── Start/resume session (simple mode equivalent of POST /v1/projects/:id/sessions/:sid/start) ──

sessionFilesApp.post('/:sessionId/start', async (c) => {
  const sessionId = c.req.param('sessionId');
  const accountId = c.get('accountId') as string;

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

  if (!sandbox || !sandbox.externalId) {
    // No sandbox yet — still provisioning
    return c.json({
      stage: 'provisioning',
      retriable: true,
      sandbox: null,
      opencode_session_id: null,
    });
  }

  // Return the sandbox info so the frontend can connect
  return c.json({
    stage: sandbox.status === 'active' ? 'ready' : 'provisioning',
    retriable: sandbox.status !== 'error',
    sandbox: {
      sandbox_id: sandbox.sandboxId,
      session_id: sessionId,
      external_id: sandbox.externalId,
      status: sandbox.status,
    },
    opencode_session_id: (session.metadata as any)?.opencode_session_id ?? null,
  });
});

// ─── List files ───────────────────────────────────────────────────────────────

sessionFilesApp.get('/:sessionId/files', async (c) => {
  const sessionId = c.req.param('sessionId');
  const files = await workspaceStore.listFiles(sessionId);
  return c.json({ files });
});

// ─── Read file content ────────────────────────────────────────────────────────

sessionFilesApp.get('/:sessionId/files/content', async (c) => {
  const sessionId = c.req.param('sessionId');
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
  const path = c.req.query('path');
  if (!path) return c.json({ error: 'path query parameter required' }, 400);

  await workspaceStore.removeFile(sessionId, path);
  return c.json({ ok: true });
});

// ─── Create workspace (called when a new session is created) ──────────────────

sessionFilesApp.post('/:sessionId/workspace', async (c) => {
  const sessionId = c.req.param('sessionId');
  const accountId = c.get('accountId') as string;

  await workspaceStore.createWorkspace(sessionId, accountId);
  return c.json({ ok: true });
});

// ─── Delete workspace (called when a session is deleted) ─────────────────────

sessionFilesApp.delete('/:sessionId/workspace', async (c) => {
  const sessionId = c.req.param('sessionId');
  await workspaceStore.deleteWorkspace(sessionId);
  return c.json({ ok: true });
});
