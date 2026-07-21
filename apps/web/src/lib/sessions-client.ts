/**
 * Sessions API client — for simple-mode session management.
 *
 * Mirrors the patterns in projects-client.ts but targets /sessions
 * for standalone (no-GitHub) sessions.
 */

import { backendApi } from '@/lib/api-client';
import { getSupabaseAccessTokenWithRetry } from '@/lib/auth-token';
import type { SessionStartResult, SessionStartStage } from '@/lib/session-types';

// Re-export the shared types so consumers can import from this module.
export type { SessionStartResult, SessionStartStage };

export interface SimpleSession {
  session_id: string;
  status: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface SimpleSessionDetail extends SimpleSession {
  session_mode: string;
  sandbox: {
    external_id: string | null;
    status: string;
    provider: string;
  } | null;
}

export interface SessionFile {
  path: string;
  sizeBytes: number;
  isBinary: boolean;
  mimeType: string | null;
  updatedAt: string;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getSupabaseAccessTokenWithRetry();
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

/** List the current user's simple-mode sessions. */
export async function listSessions(): Promise<SimpleSession[]> {
  const headers = await authHeaders();
  const res = await backendApi.get('/sessions', { headers });
  return res.data.sessions ?? [];
}

/** Get details for a specific session. */
export async function getSession(sessionId: string): Promise<SimpleSessionDetail> {
  const headers = await authHeaders();
  const res = await backendApi.get(`/sessions/${sessionId}`, { headers });
  return res.data;
}

/** Create a new standalone session. */
export async function createSession(opts: {
  name?: string;
  initial_prompt?: string;
  opencode_model?: string;
  session_id?: string; // client-provided UUID for optimistic creation
}): Promise<{ session_id: string; status: string; name: string }> {
  const headers = await authHeaders();
  const res = await backendApi.post('/sessions', {
    name: opts.name,
    initial_prompt: opts.initial_prompt,
    opencode_model: opts.opencode_model,
    session_id: opts.session_id,
  }, { headers });
  return res.data;
}

/** Delete a session and its workspace.
 *  Throws on failure — caller's mutation onError will fire.
 *  Returns the server's response payload (typically `{ ok: true }`).
 */
export async function deleteSession(sessionId: string): Promise<{ ok: boolean }> {
  const headers = await authHeaders();
  const res = await backendApi.delete(`/sessions/${sessionId}`, {
    headers,
    showErrors: false,
  });
  if (!res.success) {
    const status = (res.error as any)?.status ?? (res.error as any)?.statusCode;
    const msg = (res.error as any)?.message || `Failed to delete session (HTTP ${status || '?'})`;
    throw new Error(msg);
  }
  return res.data ?? { ok: true };
}

/** Bulk-delete sessions server-side (single HTTP call, sequential sandbox termination).
 *  Returns `{ deleted: string[], failed: { id, error }[] }`.
 */
export async function bulkDeleteSessions(sessionIds: string[]): Promise<{
  ok: boolean;
  deleted: string[];
  failed: { id: string; error: string }[];
}> {
  const headers = await authHeaders();
  const res = await backendApi.post(`/sessions/bulk-delete`, {
    session_ids: sessionIds,
  }, { headers, showErrors: false });
  if (!res.success) {
    const status = (res.error as any)?.status ?? (res.error as any)?.statusCode;
    const msg = (res.error as any)?.message || `Failed to bulk delete (HTTP ${status || '?'})`;
    throw new Error(msg);
  }
  return res.data ?? { ok: true, deleted: [], failed: [] };
}

/** Start/resume a session — equivalent to POST /v1/projects/:id/sessions/:sid/start
 *
 * Returns:
 *   - SessionStartResult on success
 *   - { not_found: true } when the session was deleted (HTTP 404) — caller MUST
 *     redirect to /sessions instead of polling forever
 *   - null on transient errors (network blip, 5xx) — caller should retry
 */
export async function startSession(
  sessionId: string,
): Promise<SessionStartResult | { not_found: true } | null> {
  const headers = await authHeaders();
  const res = await backendApi.post(`/sessions/${sessionId}/start`, {}, {
    headers,
    showErrors: false,
  });
  if (!res.success) {
    // 404 = session deleted. Surface as a structured `not_found` so the caller
    // can redirect to /sessions instead of polling forever.
    const status = (res.error as any)?.status ?? (res.error as any)?.statusCode;
    if (status === 404) return { not_found: true };
    return null;
  }
  return res.data ?? null;
}

/** Stable React Query key for session start polling. */
export function sessionStartKey(sessionId: string) {
  return ['session-start', sessionId] as const;
}

/** List files in a session workspace. */
export async function listSessionFiles(sessionId: string): Promise<SessionFile[]> {
  const headers = await authHeaders();
  const res = await backendApi.get(`/sessions/${sessionId}/files`, { headers });
  return res.data.files ?? [];
}

/** Read a file's content. */
export async function readSessionFile(sessionId: string, path: string): Promise<string> {
  const headers = await authHeaders();
  // Build query string manually — backendApi (fetch-based) doesn't support
  // `params` or `responseType` options (those are axios-style). The previous
  // `params: { path }` was silently ignored, so the path was never sent.
  const query = new URLSearchParams({ path }).toString();
  const res = await backendApi.get(`/sessions/${sessionId}/files/content?${query}`, {
    headers,
  });
  // The endpoint returns text content. backendApi wraps the fetch response,
  // so `res.data` may be a string (when Content-Type is text/plain) or an
  // object (when JSON). Coerce to string for text responses.
  return typeof res.data === 'string' ? res.data : (res.data as any)?.content ?? String(res.data ?? '');
}

/** Write a file. */
export async function writeSessionFile(
  sessionId: string,
  path: string,
  content: string,
  mimeType?: string,
): Promise<void> {
  const headers = await authHeaders();
  await backendApi.post(`/sessions/${sessionId}/files`, {
    path,
    content,
    mimeType,
  }, { headers });
}

/** Delete a file. */
export async function deleteSessionFile(sessionId: string, path: string): Promise<void> {
  const headers = await authHeaders();
  // Build query string manually — same reason as readSessionFile above.
  const query = new URLSearchParams({ path }).toString();
  await backendApi.delete(`/sessions/${sessionId}/files?${query}`, {
    headers,
  });
}

/** Rename a session. */
export async function renameSession(sessionId: string, name: string): Promise<void> {
  const headers = await authHeaders();
  await backendApi.patch(`/sessions/${sessionId}`, { name }, { headers });
}

/** Restart a session (stop + start the sandbox). */
export async function restartSession(sessionId: string): Promise<void> {
  const headers = await authHeaders();
  await backendApi.post(`/sessions/${sessionId}/restart`, {}, { headers });
}

// ─── Session Public Shares ─────────────────────────────────────────────────
// Uses the session-scoped /v1/sessions/:id/shares endpoints (no projectId needed).

export interface SessionShareInput {
  preview_id?: string;
  preview?: { label: string; url: string; port: number; path?: string };
  file?: { label: string; path: string };
  mode?: 'view' | 'interactive';
  label?: string;
  expires_at?: string;
}

export interface SessionShare {
  id: string;
  session_id: string;
  public_path: string;
  token: string;
  mode: string;
  label?: string;
  expires_at?: string;
  created_at: string;
}

export async function createSessionShare(
  sessionId: string,
  input: SessionShareInput,
): Promise<{ share: SessionShare }> {
  const headers = await authHeaders();
  return unwrap(
    await backendApi.post<{ share: SessionShare }>(`/sessions/${sessionId}/shares`, input, { headers }),
  );
}

export async function listSessionShares(sessionId: string): Promise<{ shares: SessionShare[] }> {
  const headers = await authHeaders();
  return unwrap(
    await backendApi.get<{ shares: SessionShare[] }>(`/sessions/${sessionId}/shares`, { headers }),
  );
}

function unwrap<T>(res: { success: boolean; data?: T; error?: { message?: string } }): T {
  if (!res.success) {
    throw new Error(res.error?.message || 'Request failed');
  }
  return res.data as T;
}
