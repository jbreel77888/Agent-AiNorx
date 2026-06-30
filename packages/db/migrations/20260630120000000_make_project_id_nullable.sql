-- Migration: make project_id and branch_name nullable in project_sessions
-- This allows simple-mode sessions to exist without a project or git branch.

-- Drop the NOT NULL constraints (expand phase — safe, doesn't break existing data)
ALTER TABLE kortix.project_sessions ALTER COLUMN project_id DROP NOT NULL;
ALTER TABLE kortix.project_sessions ALTER COLUMN branch_name DROP NOT NULL;

-- Drop the unique index on (project_id, branch_name) since both can now be NULL
-- PostgreSQL treats NULL != NULL in unique indexes, so this is safe to keep,
-- but the index is useless for simple-mode sessions. We'll keep it for now.
-- DROP INDEX IF EXISTS kortix.project_sessions_project_branch_key;
