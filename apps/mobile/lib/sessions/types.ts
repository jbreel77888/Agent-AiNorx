/**
 * Session types — project-optional session model for VaelorX mobile.
 *
 * Mirrors the web's SimpleSession but includes sandbox info needed by
 * the mobile app's chat/connect flow.
 */

export type SessionStatus =
  | 'provisioning'
  | 'running'
  | 'stopped'
  | 'failed'
  | 'completed'
  | 'deleted'
  | 'archived';

export interface Session {
  session_id: string;
  account_id: string;
  /** Nullable in simple mode — sessions don't require a project. */
  project_id: string | null;
  /** Sandbox provider (e.g. 'tensorlake'). */
  sandbox_provider: string | null;
  /** The sandbox ID (same as session_id in simple mode). */
  sandbox_id: string | null;
  /** Base URL for proxying to the sandbox (e.g. /v1/p/{externalId}/{port}). */
  sandbox_url: string | null;
  /** OpenCode session ID inside the sandbox. */
  opencode_session_id: string | null;
  /** User-set or auto-generated session name. */
  name: string | null;
  /** User-set name override. */
  custom_name?: string | null;
  /** Agent name (e.g. 'vaelorx', 'default'). */
  agent_name: string | null;
  status: SessionStatus;
  error: string | null;
  metadata: Record<string, unknown>;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSessionInput {
  session_id?: string;     // client-provided UUID for optimistic creation
  name?: string;
  initial_prompt?: string;
  opencode_model?: string;
}

export type SessionStartStage = 'provisioning' | 'starting' | 'ready' | 'stopped' | 'failed';

export interface SessionStartResult {
  stage: SessionStartStage;
  retriable: boolean;
  sandbox: SessionSandbox | null;
  opencode_session_id: string | null;
  reason?: string;
}

export interface SessionSandbox {
  sandbox_id: string;
  session_id: string;
  external_id: string | null;
  status: string;
  provider: string;
  base_url: string | null;
}

export interface SessionFile {
  path: string;
  sizeBytes: number;
  isBinary: boolean;
  mimeType: string | null;
  updatedAt: string;
}

/** Sharing intent — who can see/open a session. */
export type SessionSharing =
  | { mode: 'private' }
  | { mode: 'members'; memberIds?: string[]; groupIds?: string[] };
