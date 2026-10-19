-- Migration: Create notification_preferences table
-- Description: Stores user-defined notification preferences (toggles) for both push and web notifications

CREATE TABLE IF NOT EXISTS notification_preferences (
  address              TEXT PRIMARY KEY,
  browser_push_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  new_followers        BOOLEAN NOT NULL DEFAULT TRUE,
  new_likes            BOOLEAN NOT NULL DEFAULT TRUE,
  new_comments         BOOLEAN NOT NULL DEFAULT TRUE,
  direct_messages      BOOLEAN NOT NULL DEFAULT TRUE,
  pool_activity        BOOLEAN NOT NULL DEFAULT TRUE,
  governance_updates   BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
