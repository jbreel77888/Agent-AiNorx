-- Migration: make project_id nullable in session_sandboxes
-- This allows simple-mode sandboxes to exist without a project.
-- The nil-UUID sentinel ('00000000-0000-0000-0000-000000000000') was a
-- workaround that conflated "no project" with "a project whose ID is all zeros".

-- Drop the NOT NULL constraint (safe — existing rows are unaffected).
ALTER TABLE kortix.session_sandboxes ALTER COLUMN project_id DROP NOT NULL;

-- Backfill: replace the nil-UUID sentinel with NULL for existing simple-mode rows
-- so future queries can use IS NULL instead of comparing to a magic value.
UPDATE kortix.session_sandboxes
SET project_id = NULL
WHERE project_id = '00000000-0000-0000-0000-000000000000';

-- Note: the index idx_session_sandboxes_pool on (project_id, pool_state) is fine
-- to keep — PostgreSQL supports NULL values in indexes (they just won't match
-- the warm-pool query, which is intended: simple-mode sandboxes are never pooled).
