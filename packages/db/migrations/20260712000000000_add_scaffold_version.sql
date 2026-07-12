-- Migration: Add scaffold_version to platform_settings
-- Date: 2026-07-12
--
-- The scaffold_version setting tracks the current version of agent/skill
-- definitions. When the admin publishes updates (POST /v1/admin/platform/publish),
-- this version is bumped. New sessions receive it as KORTIX_SCAFFOLD_VERSION
-- env var, and the daemon can check it on boot to fetch updated files.

INSERT INTO kortix.platform_settings (key, value, category, description)
VALUES ('scaffold_version', '0', 'scaffold', 'Current scaffold version — bumped on every publish')
ON CONFLICT (key) DO NOTHING;
