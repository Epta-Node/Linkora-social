-- Migration: Create notification preferences table for per-user toggle control

CREATE TABLE IF NOT EXISTS notification_preferences (
    id SERIAL PRIMARY KEY,
    address TEXT NOT NULL,
    follow_notifications BOOLEAN NOT NULL DEFAULT TRUE,
    tip_notifications BOOLEAN NOT NULL DEFAULT TRUE,
    like_notifications BOOLEAN NOT NULL DEFAULT TRUE,
    moderation_notifications BOOLEAN NOT NULL DEFAULT TRUE,
    governance_notifications BOOLEAN NOT NULL DEFAULT TRUE,
    pool_notifications BOOLEAN NOT NULL DEFAULT TRUE,
    post_notifications BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (address)
);

CREATE INDEX IF NOT EXISTS idx_notification_preferences_address
    ON notification_preferences (address);
