-- Migration: make executor_connectors project_id nullable + support account-scoped connectors
-- This allows connectors to belong to an account (user) instead of a project,
-- enabling the Phase 6 requirement: Connectors per user.

-- 1. Make project_id nullable on executor_connectors
ALTER TABLE kortix.executor_connectors ALTER COLUMN project_id DROP NOT NULL;

-- 2. Drop the old unique index (project_id, slug) — it won't work with NULL project_id
DROP INDEX IF EXISTS kortix.idx_executor_connectors_project_slug;

-- 3. Create a new unique index that handles both project-scoped and account-scoped connectors
-- For project-scoped: unique per (project_id, slug)
-- For account-scoped: unique per (account_id, slug) where project_id IS NULL
CREATE UNIQUE INDEX IF NOT EXISTS idx_executor_connectors_project_slug
  ON kortix.executor_connectors (project_id, slug)
  WHERE project_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_executor_connectors_account_slug
  ON kortix.executor_connectors (account_id, slug)
  WHERE project_id IS NULL;

-- 4. Same for executor_credentials
ALTER TABLE kortix.executor_credentials ALTER COLUMN project_id DROP NOT NULL;

-- 5. Same for executor_executions (if it has project_id NOT NULL)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'kortix'
      AND table_name = 'executor_executions'
      AND column_name = 'project_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE kortix.executor_executions ALTER COLUMN project_id DROP NOT NULL;
  END IF;
END $$;

-- 6. Same for executor_project_policies (if it has project_id NOT NULL)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'kortix'
      AND table_name = 'executor_project_policies'
      AND column_name = 'project_id'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE kortix.executor_project_policies ALTER COLUMN project_id DROP NOT NULL;
  END IF;
END $$;
