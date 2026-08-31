-- Migration: Create message_idempotency table
-- Description: Caches the response for each client-supplied idempotency key
-- so a retried message submission (network timeout, client crash, etc.)
-- replays the original result instead of being processed again.

CREATE TABLE IF NOT EXISTS message_idempotency (
  idempotency_key UUID PRIMARY KEY,
  response_status INT NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_idempotency_created_at
  ON message_idempotency (created_at);
