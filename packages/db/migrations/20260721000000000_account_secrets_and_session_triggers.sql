-- Migration: account_secrets — account-scoped secrets for session-only mode
-- Date: 2026-07-21
--
-- In session-only mode there's no project, so project_secrets can't be used.
-- This table mirrors project_secrets but is keyed on account_id instead.
-- Used by:
--   - Setup links (ksa_ tokens) — the public intake endpoint writes here
--   - Executor credentials (account-scoped connectors)
--   - Runtime env vars injected into sandboxes

CREATE TABLE IF NOT EXISTS kortix.account_secrets (
  secret_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID NOT NULL REFERENCES kortix.accounts(account_id) ON DELETE CASCADE,
  name           VARCHAR(64) NOT NULL,
  value_enc      TEXT NOT NULL,
  scope          VARCHAR(16) NOT NULL DEFAULT 'runtime',
  share_scope    VARCHAR(16) NOT NULL DEFAULT 'project',
  owner_user_id  UUID,
  active         BOOLEAN NOT NULL DEFAULT true,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_account_secrets_account ON kortix.account_secrets(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_secrets_account_name_shared
  ON kortix.account_secrets(account_id, name) WHERE owner_user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_secrets_account_name_owner
  ON kortix.account_secrets(account_id, name, owner_user_id) WHERE owner_user_id IS NOT NULL;

-- Add session_id column to project_trigger_runtime (nullable, for session-scoped triggers)
ALTER TABLE kortix.project_trigger_runtime
  ADD COLUMN IF NOT EXISTS session_id UUID;

-- Create session_trigger_executions table for trigger run history
CREATE TABLE IF NOT EXISTS kortix.session_trigger_executions (
  execution_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID NOT NULL,
  trigger_slug   VARCHAR(128) NOT NULL,
  status         VARCHAR(32) NOT NULL DEFAULT 'pending',
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ,
  duration_ms    INTEGER,
  result         JSONB,
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_trigger_executions_session
  ON kortix.session_trigger_executions(session_id);
CREATE INDEX IF NOT EXISTS idx_session_trigger_executions_trigger
  ON kortix.session_trigger_executions(session_id, trigger_slug);
