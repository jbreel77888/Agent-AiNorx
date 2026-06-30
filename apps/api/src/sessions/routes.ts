/**
 * Session file routes — REST API for simple-mode session file management.
 *
 * When KORTIX_SESSION_MODE=simple, these endpoints replace the Git-based
 * file operations. They use R2 (Cloudflare) + PostgreSQL for persistence.
 *
 * All routes are under /v1/sessions/:sessionId/files
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { config } from '../config';
import { supabaseAuth } from '../middleware/auth';
import * as workspaceStore from './workspace-store';

export const sessionFilesApp = new Hono();

// Auth middleware — all routes require authentication
sessionFilesApp.use('*', supabaseAuth);

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
