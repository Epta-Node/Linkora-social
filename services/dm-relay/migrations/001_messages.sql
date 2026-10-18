-- Migration: Create messages and idempotency_keys tables

CREATE TABLE IF NOT EXISTS messages (
    id              BIGSERIAL   PRIMARY KEY,
    sender          TEXT        NOT NULL,
    recipient       TEXT        NOT NULL,
    ciphertext      TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages (recipient);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages (created_at);

-- Idempotency keys prevent duplicate deliveries
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key             TEXT        PRIMARY KEY,
    message_id      BIGINT      NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
