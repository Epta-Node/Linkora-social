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
-- Guard: only create the single-column unique index when raw_events is a plain
-- heap table. After migration 012 converts it to a partitioned table the index
-- must include the partition key; migration 012 creates idx_raw_events_id1 for
-- that purpose.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'raw_events'
      AND c.relkind = 'r'          -- plain heap table only
      AND n.nspname = 'public'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename  = 'raw_events'
        AND indexname  = 'idx_raw_events_id'
    ) THEN
      EXECUTE 'CREATE UNIQUE INDEX idx_raw_events_id ON raw_events (id)';
    END IF;
  END IF;
END
$$;
CREATE INDEX IF NOT EXISTS idx_raw_events_contract_id ON raw_events (contract_id);
CREATE INDEX IF NOT EXISTS idx_raw_events_ledger      ON raw_events (ledger_sequence);

-- NOTE: The per-stream ingestion cursor lives in `indexer_cursor`
-- (006_indexer_cursor.sql). It was originally defined here as `indexer_state`,
-- but that name now belongs to the state-root table (006_indexer_state.sql),
-- so the cursor definition was moved out to avoid a name collision.
