-- Migration: notifications table
-- Date: 2026-07-22
--
-- Stores notifications for users. Each notification is account-scoped
-- (so all members of an account see relevant notifications) and user-scoped
-- (for personal notifications like task completion).

CREATE TABLE IF NOT EXISTS kortix.notifications (
  notification_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       UUID NOT NULL,
  user_id          UUID,
  kind             VARCHAR(64) NOT NULL,
  title            VARCHAR(255) NOT NULL,
  body             TEXT,
  payload          JSONB DEFAULT '{}'::jsonb,
  read_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_account
  ON kortix.notifications(account_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user
  ON kortix.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON kortix.notifications(account_id, read_at) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_created
  ON kortix.notifications(created_at DESC);
