-- Migration: Create device token registry for Expo push notifications

CREATE TABLE IF NOT EXISTS device_tokens (
    id SERIAL PRIMARY KEY,
    address TEXT NOT NULL,
    token TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (address, token)
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_address_updated
    ON device_tokens (address, updated_at DESC);
