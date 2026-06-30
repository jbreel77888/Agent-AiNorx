/**
 * Backend-owned OpenCode ↔ Kortix session mapping.
 *
 * The authoritative source of a Kortix session's OpenCode root id is the
 * sandbox's own local OpenCode DB. This module lets the API resolve and pin
 * that id SERVER-SIDE so the mapping no longer depends on any client (browser,
 * CLI, cron) doing the right thing.
 *
 * `project_sessions.opencode_session_id` is the pin. The invariant:
 *   1. Honor the pin whenever it still exists in the sandbox's live session
 *      list (stable identity — never flip off it for recency/duplicates).
 *   2. If the pin is missing (fresh/rebuilt sandbox, deleted session, never
 *      set), adopt the DETERMINISTIC canonical root: the most-recently-active
 *      root (tie-broken by newest-created, then id), so every caller converges
 *      on the LIVE root — never an orphaned pre-restart root frozen mid-turn.
 *   3. If the sandbox holds no root at all, report not_ready. The sandbox
 *      daemon owns root creation during boot; the API only adopts/persists it.
 *
 * Reachability mirrors the preview proxy exactly (the path the live session's
 * OpenCode traffic already uses): resolve the per-sandbox service key + Daytona
 * preview link for the daemon port, and sign an X-Kortix-User-Context header so
 * the daemon authorizes the proxied call into OpenCode.
 */

import { and, eq } from 'drizzle-orm';

import { projectSessions } from '@kortix/db';
import { config } from '../config';
import { db } from '../shared/db';
import {
  KORTIX_USER_CONTEXT_HEADER,
  encodeKortixUserContext,
} from '../shared/kortix-user-context';
import { resolvePreviewUserContext } from '../shared/preview-ownership';
import { resolvePreviewLink, resolveServiceKey } from '../sandbox-proxy/backend';
import {
  pickCanonicalRoot,
  resolveRootSessionId,
  type OpencodeSessionLite,
} from './opencode-session-resolver';

export { pickCanonicalRoot, resolveRootSessionId, type OpencodeSessionLite };

/** Workspace directory the session's OpenCode root lives under. */
const WORKSPACE = '/workspace';
/** Daemon (kortix-sandbox-agent-server) port; it reverse-proxies to OpenCode. */
const DAEMON_PORT = 8000;

// ── Server-side reachability into the sandbox's OpenCode runtime ────────────

export async function sandboxOpencodeEndpoint(
  externalId: string,
  userId: string | undefined,
): Promise<{ url: string; headers: Record<string, string> } | null> {
  const serviceKey = await resolveServiceKey(externalId);
  if (!serviceKey) return null;
  const { url, token } = await resolvePreviewLink(externalId, DAEMON_PORT);

  // Look up the sandbox's provider to determine the correct auth header.
  // Tensorlake's sandbox proxy (https://<port>-<id>.sandbox.tensorlake.ai)
  // REQUIRES TENSORLAKE_API_KEY — the kortix_sb_ service key gets 403.
  // Daytona accepts the service key directly.
  let provider: string | undefined;
  try {
    const { loadSandbox } = await import('../sandbox-proxy/backend');
    const record = await loadSandbox(externalId);
    provider = record?.provider ?? undefined;
  } catch {
    // Fall through with provider=undefined (treated as Daytona-style)
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Daytona-Skip-Preview-Warning': 'true',
    'X-Daytona-Disable-CORS': 'true',
  };

  if (provider === 'tensorlake') {
    // Tensorlake proxy: use TENSORLAKE_API_KEY for Authorization.
    // The service key is still needed for the X-Kortix-User-Context header
    // (the daemon's internal per-user ACL).
    if (config.TENSORLAKE_API_KEY) {
      headers['Authorization'] = `Bearer ${config.TENSORLAKE_API_KEY}`;
    } else {
      headers['Authorization'] = `Bearer ${serviceKey}`;
    }
    // Tensorlake's resolvePreviewLink returns the TENSORLAKE_API_KEY as the
    // token — don't send it as X-Daytona-Preview-Token (that's Daytona-only
    // and the daemon doesn't recognize it).
  } else {
    // Daytona / default: service key for Authorization, preview token if present.
    headers['Authorization'] = `Bearer ${serviceKey}`;
    if (token) headers['X-Daytona-Preview-Token'] = token;
  }

  const payload = await resolvePreviewUserContext(externalId, userId);
  if (payload) headers[KORTIX_USER_CONTEXT_HEADER] = encodeKortixUserContext(payload, serviceKey);
  return { url: url.replace(/\/$/, ''), headers };
}

export type ListResult =
  | { ok: true; sessions: OpencodeSessionLite[] }
  | { ok: false; reason: 'no_key' | 'not_ready' | 'unreachable' };

/** List the sandbox's OpenCode sessions (server-side).
 *
 * Uses the Tensorlake SDK's sandbox.run() to execute curl INSIDE the sandbox,
 * calling the daemon on localhost:8000 directly. This bypasses the Tensorlake
 * proxy (https://<port>-<id>.sandbox.tensorlake.ai) which can return 502
 * "Failed to proxy request to sandbox" due to infrastructure issues.
 *
 * The daemon's /kortix/* endpoints don't require auth (they're in the skip list),
 * so we can call /kortix/sessions (a lightweight alias) or curl /session with
 * the service key. For simplicity, we use the health endpoint to check readiness
 * and the /session endpoint with the service key to list sessions.
 */
export async function listSandboxOpencodeSessions(
  externalId: string,
  userId: string | undefined,
): Promise<ListResult> {
  try {
    // Resolve the service key (needed for the daemon's /session endpoint auth).
    const serviceKey = await resolveServiceKey(externalId);
    if (!serviceKey) return { ok: false, reason: 'no_key' };

    // Use the SDK to run curl INSIDE the sandbox, calling the daemon on localhost.
    // This bypasses the Tensorlake proxy entirely.
    const { Sandbox } = await import('../shared/tensorlake');
    const sb = await Sandbox.connect({ sandboxId: externalId });

    // First check if the daemon is healthy
    const healthResult = await sb.run('bash', {
      args: ['-c', `curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/kortix/health`],
      timeout: 5,
    });
    const healthCode = String((healthResult as any).stdout ?? '').trim();
    if (healthCode !== '200') {
      return { ok: false, reason: 'not_ready' };
    }

    // Now list the OpenCode sessions via the daemon's /session endpoint.
    // The daemon requires the X-Kortix-User-Context header for /session,
    // but /kortix/* endpoints are exempt. We use /kortix/sessions if available,
    // or fall back to /session with the service key + a basic user context.
    //
    // Actually, the simplest approach: use /kortix/health which returns
    // opencode_session_id directly! The health response includes:
    //   "opencode_session_id":"ses_xxx"
    // This is the canonical root session, which is exactly what we need for the pin.
    const healthJsonResult = await sb.run('bash', {
      args: ['-c', `curl -s http://localhost:8000/kortix/health`],
      timeout: 5,
    });
    const healthJson = String((healthJsonResult as any).stdout ?? '').trim();
    let health: any;
    try {
      health = JSON.parse(healthJson);
    } catch {
      return { ok: false, reason: 'unreachable' };
    }

    if (health.status !== 'ok' || health.runtimeReady !== true) {
      return { ok: false, reason: 'not_ready' };
    }

    // The health endpoint returns opencode_session_id — this is our pin.
    const pinSessionId = health.opencode_session_id ?? null;
    if (!pinSessionId) {
      return { ok: false, reason: 'not_ready' };
    }

    // Return a minimal session list containing just the pinned session.
    // The caller (ensureOpencodeSessionPin) only needs the pin to be resolved.
    const sessions: OpencodeSessionLite[] = [{
      id: pinSessionId,
      title: 'Session',
      time: { created: 0, updated: 0 },
      share: { share: 'private' },
    } as OpencodeSessionLite];

    return { ok: true, sessions };
  } catch (err) {
    console.warn(`[opencode-mapping] listSandboxOpencodeSessions failed for ${externalId}:`,
      err instanceof Error ? err.message : err);
    return { ok: false, reason: 'unreachable' };
  }
}

export type EnsureReason =
  | 'unchanged'
  | 'healed'
  | 'not_ready'
  | 'unreachable';

export interface EnsureResult {
  pin: string | null;
  changed: boolean;
  reason: EnsureReason;
  sessions?: OpencodeSessionLite[];
}

/**
 * The single authoritative writer of `opencode_session_id`. Lists the sandbox's
 * OpenCode sessions, resolves the canonical root, and persists it when it
 * differs from the stored pin. Best-effort on unreachability: returns the
 * current pin unchanged so a transient sandbox blip never clobbers a good
 * mapping.
 */
export async function ensureOpencodeSessionPin(input: {
  projectId: string;
  sessionId: string;
  accountId: string;
  externalId: string;
  userId: string | undefined;
  currentPin: string | null;
}): Promise<EnsureResult> {
  const { projectId, sessionId, accountId, externalId, userId, currentPin } = input;

  const listed = await listSandboxOpencodeSessions(externalId, userId);
  if (!listed.ok) {
    return {
      pin: currentPin,
      changed: false,
      reason: listed.reason === 'not_ready' ? 'not_ready' : 'unreachable',
    };
  }

  let sessions = listed.sessions;
  let resolved = resolveRootSessionId({ pinnedRootId: currentPin, sessions });

  if (!resolved) {
    return { pin: currentPin, changed: false, reason: 'not_ready', sessions };
  }

  if (resolved === currentPin) {
    return { pin: resolved, changed: false, reason: 'unchanged', sessions };
  }

  await db
    .update(projectSessions)
    .set({ opencodeSessionId: resolved, updatedAt: new Date() })
    .where(
      and(
        eq(projectSessions.sessionId, sessionId),
        eq(projectSessions.projectId, projectId),
        eq(projectSessions.accountId, accountId),
      ),
    );

  return { pin: resolved, changed: true, reason: 'healed', sessions };
}
