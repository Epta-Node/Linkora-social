-- Migration 015: Incremental state-root tables
-- Replaces the per-batch full-table scan with an O(batch_size) XOR-accumulator
-- approach.
--
-- state_root_accumulators  — one row per logical table; stores a 64-char hex
--   XOR accumulator.  The combined root is:
--     sha256(posts_acc || follows_acc || profiles_acc || pools_acc)
--
-- state_root_row_hashes    — one row per indexed row key; stores the hash that
--   was last XOR'd into the accumulator for that key, so updates and deletes
--   can XOR out the old value before XOR'ing in the new one.
--
-- Rollback: DROP TABLE state_root_row_hashes; DROP TABLE state_root_accumulators;

CREATE TABLE IF NOT EXISTS state_root_accumulators (
    table_name  TEXT        PRIMARY KEY,          -- 'posts' | 'follows' | 'profiles' | 'pools'
    accumulator TEXT        NOT NULL DEFAULT repeat('0', 64),  -- 256-bit XOR, hex-encoded
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the four logical tables so there is always exactly one row per table.
INSERT INTO state_root_accumulators (table_name, accumulator)
VALUES
    ('posts',    repeat('0', 64)),
    ('follows',  repeat('0', 64)),
    ('profiles', repeat('0', 64)),
    ('pools',    repeat('0', 64))
ON CONFLICT (table_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS state_root_row_hashes (
    table_name  TEXT        NOT NULL,
    row_key     TEXT        NOT NULL,   -- deterministic key for the row
    row_hash    TEXT        NOT NULL,   -- sha256 hex of the row's canonical fields
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (table_name, row_key)
);

CREATE INDEX IF NOT EXISTS idx_state_root_row_hashes_table
    ON state_root_row_hashes (table_name);

-- bootstrap_done flag: once the one-time full scan has been run this is set to
-- TRUE so subsequent batches skip the bootstrap path entirely.
INSERT INTO state_root_accumulators (table_name, accumulator)
VALUES ('__bootstrap_done__', repeat('0', 64))
ON CONFLICT (table_name) DO NOTHING;
