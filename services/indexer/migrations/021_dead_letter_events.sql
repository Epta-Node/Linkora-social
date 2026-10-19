-- Migration: Create dead_letter_events table for permanently failed events
-- Description: Stores events that exhausted retries for later replay/analysis

CREATE TABLE IF NOT EXISTS dead_letter_events (
    id              BIGSERIAL   PRIMARY KEY,
    ledger_sequence BIGINT      NOT NULL,
    event_index     INT         NOT NULL,
    contract_id     TEXT        NOT NULL,
    topic           TEXT[]      NOT NULL,
    data            JSONB       NOT NULL,
    error_message   TEXT,
    failed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (ledger_sequence, event_index)
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_ledger ON dead_letter_events (ledger_sequence);
CREATE INDEX IF NOT EXISTS idx_dead_letter_failed_at ON dead_letter_events (failed_at DESC);
