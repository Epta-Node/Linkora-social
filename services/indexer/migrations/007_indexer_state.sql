-- Migration 006: indexer_state table
-- Stores the per-ledger cryptographic state root for divergence detection.

CREATE TABLE IF NOT EXISTS indexer_state (
    ledger_sequence BIGINT      PRIMARY KEY,
    state_root      TEXT        NOT NULL,
    computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
