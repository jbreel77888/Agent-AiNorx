-- Migration: account_warm_pool_presence
-- Session-only-mode warm pool presence tracker. Unlike the legacy
-- warm_pool_presence (keyed by project_id), this is keyed by account_id —
-- one presence row per account that has an active warm pool.
--
-- Ships dormant: the account_warm_pool flag in platform_settings defaults
-- OFF, so no rows are written until an operator enables the feature.

CREATE TABLE IF NOT EXISTS kortix.account_warm_pool_presence (
    account_id  uuid PRIMARY KEY REFERENCES kortix.accounts(account_id) ON DELETE CASCADE,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    target_size integer NOT NULL DEFAULT 3
);

CREATE INDEX IF NOT EXISTS idx_account_warm_pool_presence_seen
    ON kortix.account_warm_pool_presence(last_seen_at);

-- Also relax session_sandboxes.project_id so session-only-mode spares can
-- be inserted with NULL. Existing project-scoped rows are unaffected.
ALTER TABLE kortix.session_sandboxes ALTER COLUMN project_id DROP NOT NULL;
