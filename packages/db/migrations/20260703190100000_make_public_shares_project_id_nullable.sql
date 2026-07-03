-- Migration: make project_id nullable in project_session_public_shares
-- This allows simple-mode sessions (which have no project) to have public shares.

ALTER TABLE kortix.project_session_public_shares ALTER COLUMN project_id DROP NOT NULL;

-- Backfill: replace the nil-UUID sentinel with NULL for any existing simple-mode rows
UPDATE kortix.project_session_public_shares
SET project_id = NULL
WHERE project_id = '00000000-0000-0000-0000-000000000000';
