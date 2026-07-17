/**
 * Sessions API client — project-optional session management.
 *
 * This is the NEW top-level session client that calls /v1/sessions/*
 * instead of /v1/projects/{id}/sessions/*. In simple mode, sessions
 * don't require a project_id.
 *
 * Mirrors apps/web/src/lib/sessions-client.ts but uses the mobile's
 * apiFetch pattern from projects-client.ts.
 */

import { API_URL } from '@/api/config';
import { getAuthToken } from '@/api/config';
import type {
  Session,
  CreateSessionInput,
  SessionStartResult,
  SessionFile,
  SessionSharing,
} from './types';

// ── Fetch helper (same pattern as projects-client.ts) ─────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAuthToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = text ? { message: text.slice(0, 200) } : null;
    }
    const err = new Error(
      `Session API error ${res.status}: ${typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>).message || JSON.stringify(body)
        : text.slice(0, 200)
      }`
    );
    (err as any).status = res.status;
    (err as any).body = body;
    throw err;
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Session CRUD ──────────────────────────────────────────────────────────────

/**
 * List the current user's sessions (simple mode — no project required).
 * Returns sessions sorted by updated_at descending.
 */
export function listSessions(): Promise<Session[]> {
  return apiFetch<{ sessions: Session[] }>(`/sessions`).then((r) => r.sessions ?? []);
}

/**
 * Get details for a specific session.
 */
export function getSession(sessionId: string): Promise<Session> {
  return apiFetch<Session>(`/sessions/${encodeURIComponent(sessionId)}`);
}

/**
 * Create a new standalone session (no project required).
 * The API will provision a sandbox in the background.
 */
export function createSession(input: CreateSessionInput = {}): Promise<{
  session_id: string;
  status: string;
  name: string;
}> {
  return apiFetch(`/sessions`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Start/resume a session — provisions/resumes the sandbox and resolves
 * the OpenCode session pin server-side. Poll until stage='ready'.
 *
 * Returns:
 *   - SessionStartResult on success
 *   - { not_found: true } when the session was deleted (HTTP 404)
 *   - null on transient errors (network blip, 5xx)
 */
export async function startSession(
  sessionId: string,
): Promise<SessionStartResult | { not_found: true } | null> {
  try {
    return await apiFetch<SessionStartResult>(
      `/sessions/${encodeURIComponent(sessionId)}/start`,
      { method: 'POST', body: JSON.stringify({}) }
    );
  } catch (err: any) {
    if (err?.status === 404) return { not_found: true };
    return null;
  }
}

/**
 * Restart a session (stop + start the sandbox).
 * Used to recover a sandbox whose runtime failed to boot.
 */
export function restartSession(sessionId: string): Promise<{ ok: boolean; status: string }> {
  return apiFetch(
    `/sessions/${encodeURIComponent(sessionId)}/restart`,
    { method: 'POST', body: JSON.stringify({}) }
  );
}

/**
 * Rename a session. Empty string clears the custom name.
 */
export function renameSession(
  sessionId: string,
  name: string,
): Promise<Session> {
  return apiFetch<Session>(
    `/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'PATCH', body: JSON.stringify({ name }) }
  );
}

/**
 * Permanently delete a session — tears down the sandbox VM.
 */
export function deleteSession(sessionId: string): Promise<{ ok: boolean }> {
  return apiFetch(
    `/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' }
  );
}

/**
 * Bulk delete sessions.
 */
export function bulkDeleteSessions(sessionIds: string[]): Promise<{
  ok: boolean;
  deleted: string[];
  failed: { id: string; error: string }[];
}> {
  return apiFetch(`/sessions/bulk-delete`, {
    method: 'POST',
    body: JSON.stringify({ session_ids: sessionIds }),
  });
}

/**
 * Set session sharing (private | members).
 */
export function setSessionSharing(
  sessionId: string,
  sharing: SessionSharing,
): Promise<Session> {
  return apiFetch<Session>(
    `/sessions/${encodeURIComponent(sessionId)}/shares`,
    { method: 'POST', body: JSON.stringify(sharing) }
  );
}

// ── Session Files ─────────────────────────────────────────────────────────────

/**
 * List files in a session workspace.
 */
export function listSessionFiles(sessionId: string): Promise<SessionFile[]> {
  return apiFetch<{ files: SessionFile[] }>(
    `/sessions/${encodeURIComponent(sessionId)}/files`
  ).then((r) => r.files ?? []);
}

/**
 * Read a file's content.
 */
export async function readSessionFile(sessionId: string, path: string): Promise<string> {
  const token = await getAuthToken();
  const res = await fetch(
    `${API_URL}/sessions/${encodeURIComponent(sessionId)}/files/content?path=${encodeURIComponent(path)}`,
    {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }
  );
  if (!res.ok) throw new Error(`Failed to read file: ${res.status}`);
  return res.text();
}

/**
 * Write a file.
 */
export function writeSessionFile(
  sessionId: string,
  path: string,
  content: string,
  mimeType?: string,
): Promise<void> {
  return apiFetch(
    `/sessions/${encodeURIComponent(sessionId)}/files`,
    { method: 'POST', body: JSON.stringify({ path, content, mimeType }) }
  );
}

/**
 * Delete a file.
 */
export function deleteSessionFile(sessionId: string, path: string): Promise<void> {
  return apiFetch(
    `/sessions/${encodeURIComponent(sessionId)}/files?path=${encodeURIComponent(path)}`,
    { method: 'DELETE' }
  );
}

// ── Session Health ────────────────────────────────────────────────────────────

/**
 * Check session/sandbox health. Returns the daemon's health JSON.
 */
export async function getSessionHealth(sessionId: string): Promise<{
  status: string;
  runtimeReady: boolean;
  opencode?: string;
  error?: string;
}> {
  try {
    return await apiFetch(
      `/sessions/${encodeURIComponent(sessionId)}/health`
    );
  } catch {
    return { status: 'error', runtimeReady: false };
  }
}

// ── React Query Keys ──────────────────────────────────────────────────────────

export const sessionKeys = {
  all: ['sessions'] as const,
  list: ['sessions', 'list'] as const,
  detail: (id: string) => ['sessions', 'detail', id] as const,
  files: (id: string) => ['sessions', 'files', id] as const,
  start: (id: string) => ['sessions', 'start', id] as const,
  health: (id: string) => ['sessions', 'health', id] as const,
};
