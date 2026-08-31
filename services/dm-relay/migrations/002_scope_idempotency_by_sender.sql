-- Migration: Scope message idempotency keys per sender
-- Description: `message_idempotency` previously deduplicated on
--              `idempotency_key` alone, so two different senders reusing the
--              same client-generated key would collide and one message would
--              be silently dropped. The key is now scoped to
--              (sender_address, idempotency_key), and a request_fingerprint
--              hash lets the middleware detect when the same (sender, key)
--              pair is reused with a different message payload.

ALTER TABLE message_idempotency
  ADD COLUMN IF NOT EXISTS sender_address TEXT,
  ADD COLUMN IF NOT EXISTS request_fingerprint TEXT;

UPDATE message_idempotency
  SET sender_address = '', request_fingerprint = ''
  WHERE sender_address IS NULL;

ALTER TABLE message_idempotency
  ALTER COLUMN sender_address SET NOT NULL,
  ALTER COLUMN request_fingerprint SET NOT NULL;

ALTER TABLE message_idempotency
  DROP CONSTRAINT IF EXISTS message_idempotency_pkey;

ALTER TABLE message_idempotency
  ADD PRIMARY KEY (sender_address, idempotency_key);
