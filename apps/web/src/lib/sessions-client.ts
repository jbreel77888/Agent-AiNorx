/**
 * Sessions API client — for simple-mode session management.
 *
 * Mirrors the patterns in projects-client.ts but targets /sessions
 * for standalone (no-GitHub) sessions.
 */

import { backendApi } from '@/lib/api-client';
import { getSupabaseAccessTokenWithRetry } from '@/lib/auth-token';

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

export interface SessionStartResult {
  stage: 'provisioning' | 'starting' | 'ready' | 'failed' | 'stopped';
  retriable: boolean;
  sandbox: {
    sandbox_id: string;
    session_id: string;
    external_id: string;
    status: string;
    provider: string;
  } | null;
  opencode_session_id: string | null;
  reason?: string | null;
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

/** Delete a session and its workspace. */
export async function deleteSession(sessionId: string): Promise<void> {
  const headers = await authHeaders();
  await backendApi.delete(`/sessions/${sessionId}`, { headers });
}

/** Start/resume a session — equivalent to POST /v1/projects/:id/sessions/:sid/start */
export async function startSession(sessionId: string): Promise<SessionStartResult | null> {
  const headers = await authHeaders();
  const res = await backendApi.post(`/sessions/${sessionId}/start`, {}, { headers, showErrors: false });
  if (!res.success || !res.data) return null;
  return res.data;
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
  const res = await backendApi.get(`/sessions/${sessionId}/files/content`, {
    headers,
    params: { path },
    responseType: 'text',
  });
  return res.data;
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
  await backendApi.delete(`/sessions/${sessionId}/files`, {
    headers,
    params: { path },
  });
}
