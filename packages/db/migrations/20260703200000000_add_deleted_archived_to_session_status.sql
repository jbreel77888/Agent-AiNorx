-- Migration: add 'deleted' and 'archived' to project_session_status enum
-- The DELETE /v1/sessions/:sessionId handler tries to SET status='deleted'
-- but the enum only allows: queued, branching, provisioning, running, stopped,
-- failed, completed. This causes a DrizzleQueryError (PostgreSQL enum violation)
-- and the DELETE returns 500 — the session is never actually deleted.

ALTER TYPE kortix.project_session_status ADD VALUE IF NOT EXISTS 'deleted';
ALTER TYPE kortix.project_session_status ADD VALUE IF NOT EXISTS 'archived';
