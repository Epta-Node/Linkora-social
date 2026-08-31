-- Migration: Create dm_messages table
-- Description: Core messages table for end-to-end encrypted direct messages.

CREATE TABLE IF NOT EXISTS dm_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id VARCHAR(64) NOT NULL,
  sender VARCHAR(56) NOT NULL,
  recipient VARCHAR(56) NOT NULL,
  ciphertext_b64 TEXT NOT NULL,
  message_index INTEGER NOT NULL,
  timestamp BIGINT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  CONSTRAINT unique_sender_message_index UNIQUE (sender, recipient, message_index)
);

CREATE INDEX IF NOT EXISTS idx_dm_messages_conversation_created
  ON dm_messages (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dm_messages_created_at
  ON dm_messages (created_at);

CREATE INDEX IF NOT EXISTS idx_dm_messages_timestamp
  ON dm_messages (timestamp);
