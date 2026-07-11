-- Migration: Fix default model and session idle timeout
-- Date: 2026-07-11
--
-- Problem: The default model was set to 'deepseek-v4-flash' (without '-free')
-- which doesn't exist in the OpenCode Zen provider. This caused OpenCode to
-- fall back to 'north-mini-code-free' (a random available model).
-- The session_idle_timeout_secs was 600 (10 min) which caused sandboxes to
-- terminate too quickly during idle periods, interrupting sessions.

-- 1. Fix the default model: deepseek-v4-flash → deepseek-v4-flash-free
UPDATE kortix.platform_models
SET is_default = false
WHERE model_key = 'deepseek-v4-flash' AND provider = 'opencode';

UPDATE kortix.platform_models
SET is_default = true
WHERE model_key = 'deepseek-v4-flash-free' AND provider = 'opencode'
AND NOT EXISTS (
  SELECT 1 FROM kortix.platform_models
  WHERE is_default = true AND model_key = 'deepseek-v4-flash-free'
);

-- 2. Increase session idle timeout from 600s (10 min) to 7200s (2 hours)
-- This prevents sandboxes from terminating during brief idle periods
INSERT INTO kortix.platform_settings (key, value)
VALUES ('session_idle_timeout_secs', '7200')
ON CONFLICT (key) DO UPDATE SET value = '7200';
