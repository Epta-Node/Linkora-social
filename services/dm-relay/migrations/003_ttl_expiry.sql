-- Migration: Add TTL expiry support to dm_messages
-- Description: Add ttl_seconds column for self-destructing messages (issue #1969)

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dm_messages' AND column_name = 'ttl_seconds') THEN
        ALTER TABLE dm_messages ADD COLUMN ttl_seconds INTEGER;
        CREATE INDEX IF NOT EXISTS idx_dm_messages_ttl ON dm_messages (ttl_seconds);
    END IF;
END$$;
