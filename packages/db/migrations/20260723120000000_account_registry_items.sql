-- Migration: account_registry_items
-- Account-scoped marketplace registry items. In session-only mode there is no
-- project/git repo to commit to, so installs are persisted as DB rows keyed by
-- (account_id, item_name).

CREATE TABLE IF NOT EXISTS kortix.account_registry_items (
    item_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id     uuid NOT NULL,
    name           text NOT NULL,
    type           text NOT NULL DEFAULT 'skill',
    source_address text,
    content_hash   text,
    skill_content  text NOT NULL,
    metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_active      boolean NOT NULL DEFAULT true,
    version        integer NOT NULL DEFAULT 1,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_registry_items_account
    ON kortix.account_registry_items(account_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_registry_items_account_name
    ON kortix.account_registry_items(account_id, name);
