/**
 * Shared session types — extracted from projects-client.ts in Phase 7.2.1.
 *
 * These types describe the lifecycle stages of a simple-mode session and
 * the payload returned by the /sessions/:id/start endpoint. They are
 * intentionally separate from sessions-client.ts so non-API code (UI
 * components, hooks) can depend on just the type without pulling in the
 * fetch layer.
 */

/**
 * Coarse lifecycle stage of a simple-mode session. The /sessions/:id/start
 * endpoint returns this as `result.stage` and the client polls until it
 * reaches a terminal state (`ready` = success, `failed` = error).
 *
 *   provisioning → starting → ready
 *                   ↓
 *                 failed
 *                 stopped (idle-reaped; can be resumed)
 */
export type SessionStartStage =
  | 'provisioning'
  | 'starting'
  | 'ready'
  | 'stopped'
  | 'failed';

/**
 * Result of POST /sessions/:id/start. Returned by `startSession()` in
 * sessions-client.ts and consumed by the session-starting loader + polling
 * loop in /sessions/[sessionId]/page.tsx.
 */
export interface SessionStartResult {
  stage: SessionStartStage;
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
