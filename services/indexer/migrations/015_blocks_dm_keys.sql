-- Migration: Create blocks and dm_keys tables
-- Description: Stores user blocks and dm_keys indexed from BlockEvent / UnblockEvent and DmKeyPublishedEvent

CREATE TABLE IF NOT EXISTS blocks (
    blocker TEXT NOT NULL,
    blocked TEXT NOT NULL,
    PRIMARY KEY (blocker, blocked)
);

CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks (blocker);
CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks (blocked);

CREATE TABLE IF NOT EXISTS dm_keys (
    address       TEXT PRIMARY KEY,
    x25519_pubkey TEXT NOT NULL,
    updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);
