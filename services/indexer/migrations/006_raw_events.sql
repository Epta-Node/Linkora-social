-- Migration: Create raw_events staging table
-- Description: Backbone of the exactly-once ingestion pipeline.
--
-- Events are first written to `raw_events` (idempotent on the natural
-- (ledger_sequence, event_index) key), then projected into the domain
-- tables (posts, follows, …) inside the SAME serialisable transaction.
-- The per-stream cursor (see 006_indexer_cursor.sql) only advances when that
-- transaction commits, so a crash mid-batch rolls back the raw ingest, the
-- domain write, AND the cursor together — guaranteeing no duplicate domain
-- rows on restart.

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

-- `id` is a surrogate key used by downstream tables (e.g. sent_notifications
-- references raw_events(id)). A UNIQUE index both serves point lookups and
-- provides the unique constraint a foreign key requires.
CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_events_id ON raw_events (id);
CREATE INDEX IF NOT EXISTS idx_raw_events_contract_id ON raw_events (contract_id);
CREATE INDEX IF NOT EXISTS idx_raw_events_ledger      ON raw_events (ledger_sequence);

-- NOTE: The per-stream ingestion cursor lives in `indexer_cursor`
-- (006_indexer_cursor.sql). It was originally defined here as `indexer_state`,
-- but that name now belongs to the state-root table (006_indexer_state.sql),
-- so the cursor definition was moved out to avoid a name collision.
