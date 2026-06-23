-- Migration: Create raw_events staging table and indexer_state cursor
-- Description: Backbone of the exactly-once ingestion pipeline.
--
-- Events are first written to `raw_events` (idempotent on the natural
-- (ledger_sequence, event_index) key), then projected into the domain
-- tables (posts, follows, …) inside the SAME serialisable transaction.
-- `indexer_state.processed_cursor` only advances when that transaction
-- commits, so a crash mid-batch rolls back the raw ingest, the domain
-- write, AND the cursor together — guaranteeing no duplicate domain rows
-- on restart.

CREATE TABLE IF NOT EXISTS raw_events (
    id              BIGSERIAL   NOT NULL,
    ledger_sequence BIGINT      NOT NULL,
    event_index     INT         NOT NULL,
    contract_id     TEXT        NOT NULL,
    topic           TEXT[]      NOT NULL,
    data            JSONB       NOT NULL,
    processed_at    TIMESTAMPTZ,
    PRIMARY KEY (ledger_sequence, event_index)
);

CREATE INDEX IF NOT EXISTS idx_raw_events_id          ON raw_events (id);
CREATE INDEX IF NOT EXISTS idx_raw_events_contract_id ON raw_events (contract_id);
CREATE INDEX IF NOT EXISTS idx_raw_events_ledger      ON raw_events (ledger_sequence);

-- Single-row-per-stream cursor table. `id` identifies the stream (we use the
-- contract id, or 'default' for a single-contract deployment).
CREATE TABLE IF NOT EXISTS indexer_state (
    id               TEXT        PRIMARY KEY,
    -- Last ledger sequence whose DOMAIN write has committed. Advancing this
    -- is the final statement of the ingest transaction; never bump it after
    -- the raw ingest alone.
    processed_cursor BIGINT      NOT NULL DEFAULT 0,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
