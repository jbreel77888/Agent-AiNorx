/**
 * Sessions API client — for simple-mode session management.
 *
 * This mirrors the patterns in projects-client.ts but targets the
 * /v1/sessions endpoints for standalone (no-GitHub) sessions.
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
  const res = await backendApi.get('/v1/sessions', { headers });
  return res.data.sessions ?? [];
}

/** Get details for a specific session. */
export async function getSession(sessionId: string): Promise<SimpleSessionDetail> {
  const headers = await authHeaders();
  const res = await backendApi.get(`/v1/sessions/${sessionId}`, { headers });
  return res.data;
}

/** Create a new standalone session. */
export async function createSession(opts: {
  name?: string;
  initial_prompt?: string;
  opencode_model?: string;
}): Promise<{ session_id: string; status: string; name: string }> {
  const headers = await authHeaders();
  const res = await backendApi.post('/v1/sessions', {
    name: opts.name,
    initial_prompt: opts.initial_prompt,
    opencode_model: opts.opencode_model,
  }, { headers });
  return res.data;
}

/** Delete a session and its workspace. */
export async function deleteSession(sessionId: string): Promise<void> {
  const headers = await authHeaders();
  await backendApi.delete(`/v1/sessions/${sessionId}`, { headers });
}

/** List files in a session workspace. */
export async function listSessionFiles(sessionId: string): Promise<SessionFile[]> {
  const headers = await authHeaders();
  const res = await backendApi.get(`/v1/sessions/${sessionId}/files`, { headers });
  return res.data.files ?? [];
}

/** Read a file's content. */
export async function readSessionFile(sessionId: string, path: string): Promise<string> {
  const headers = await authHeaders();
  const res = await backendApi.get(`/v1/sessions/${sessionId}/files/content`, {
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
  await backendApi.post(`/v1/sessions/${sessionId}/files`, {
    path,
    content,
    mimeType,
  }, { headers });
}

/** Delete a file. */
export async function deleteSessionFile(sessionId: string, path: string): Promise<void> {
  const headers = await authHeaders();
  await backendApi.delete(`/v1/sessions/${sessionId}/files`, {
    headers,
    params: { path },
  });
}
