-- Migration 006b: indexer_cursor table
-- Stores the per-stream processed ledger cursor for exactly-once ingestion.
-- Renamed from indexer_state to avoid collision with the state-root table (006_indexer_state.sql).

CREATE TABLE IF NOT EXISTS indexer_cursor (
    id               TEXT        PRIMARY KEY,
    processed_cursor BIGINT      NOT NULL DEFAULT 0,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
