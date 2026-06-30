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
import { eq, desc, and, or } from 'drizzle-orm';
import * as workspaceStore from './workspace-store';

export const sessionFilesApp = new Hono();

// Auth middleware — all routes require authentication
sessionFilesApp.use('*', supabaseAuth);

// ─── Create standalone session (simple mode) ─────────────────────────────────

sessionFilesApp.post('/', async (c) => {
  const userId = c.get('userId') as string;
  const accountId = c.get('accountId') as string;

  if (!accountId) {
    return c.json({ error: 'Account ID required' }, 400);
  }

  const body = await c.req.json().catch(() => ({})) as {
    name?: string;
    initial_prompt?: string;
    opencode_model?: string;
  };

  const sessionId = crypto.randomUUID();
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

  // TODO: Phase 2 continued — trigger sandbox provisioning here
  // For now, just return the session — sandbox will be provisioned
  // when we wire up the simple-mode provisioning in session-sandbox.ts

  return c.json({
    session_id: sessionId,
    status: 'provisioning',
    name: body.name || 'New Session',
    session_mode: 'simple',
  }, 201);
});

// ─── List user's sessions ────────────────────────────────────────────────────

sessionFilesApp.get('/', async (c) => {
  const accountId = c.get('accountId') as string;
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
    .where(and(
      eq(projectSessions.accountId, accountId),
      or(
        eq(projectSessions.metadata as any, { session_mode: 'simple' }),
        // Filter by metadata containing session_mode: simple
      ),
    ))
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
