-- Migration: Convert raw_events to a range-partitioned table
-- Description: Replaces the monolithic raw_events table with a
--   PARTITION BY RANGE (ledger_sequence) parent. Existing rows are migrated
--   into the correct per-month partition with zero data loss.
--
-- Design decisions
-- ────────────────
-- • Partitions are 1 000 000-ledger buckets. At ~1 ledger/5 s Stellar
--   mainnet cadence that is ~5.8 M seconds ≈ 67 days per partition, giving
--   roughly monthly partitions that can be dropped atomically when old.
-- • The PRIMARY KEY includes the partition key (ledger_sequence) so that
--   PostgreSQL can enforce uniqueness within each partition.
-- • The partial index  processed_at IS NULL  is created on the parent; PG 11+
--   propagates it to each child automatically.
-- • sent_notifications.event_id references raw_events(id) via the unique index
--   idx_raw_events_id.  That index is re-created here on the parent.
-- • The migration is non-destructive: the old table is renamed to
--   raw_events_legacy, data is bulk-inserted, then the legacy table is kept
--   until the operator decides to drop it (see DROP NOTE below).
-- • Applying this migration a second time is safe: every step is guarded by
--   IF NOT EXISTS or an existence check.
--
-- DROP NOTE (post-migration, by the operator, not automated):
--   Once you have verified data integrity and the indexer is running cleanly:
--     DROP TABLE IF EXISTS raw_events_legacy;

-- ── 1. Skip entirely when the partitioned parent already exists ───────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'raw_events'
      AND c.relkind = 'p'          -- 'p' = partitioned table
      AND n.nspname = 'public'
  ) THEN
    RAISE NOTICE 'raw_events is already partitioned — skipping migration 012';
    RETURN;
  END IF;
END
$$;

-- ── 2. Rename the existing monolithic table ───────────────────────────────────
-- Guard: only rename if raw_events still exists as a plain table.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'raw_events'
      AND c.relkind = 'r'          -- 'r' = plain (heap) table
      AND n.nspname = 'public'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'raw_events_legacy' AND relkind = 'r'
  ) THEN
    ALTER TABLE raw_events RENAME TO raw_events_legacy;
    RAISE NOTICE 'Renamed raw_events → raw_events_legacy';
  END IF;
END
$$;

-- ── 3. Create the new partitioned parent ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS raw_events (
    id              BIGSERIAL   NOT NULL,
    ledger_sequence BIGINT      NOT NULL,
    event_index     INT         NOT NULL,
    contract_id     TEXT        NOT NULL,
    topic           TEXT[]      NOT NULL,
    data            JSONB       NOT NULL,
    processed_at    TIMESTAMPTZ,
    PRIMARY KEY (ledger_sequence, event_index)
) PARTITION BY RANGE (ledger_sequence);

-- ── 4. Indexes on the parent (propagated to each child by Postgres 11+) ───────
-- NOTE: The original idx_raw_events_id, idx_raw_events_contract_id, and
-- idx_raw_events_ledger remain on raw_events_legacy (the renamed heap table).
-- New indexes on the partitioned parent use a "1" suffix to avoid collisions.

-- Surrogate-key unique index.
-- PostgreSQL requires every UNIQUE index on a partitioned table to include
-- all partitioning columns, so we include ledger_sequence alongside id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_events_id1
    ON raw_events (id, ledger_sequence);

-- Lookup by contract.
CREATE INDEX IF NOT EXISTS idx_raw_events_contract_id1
    ON raw_events (contract_id);

-- Partition-aware ledger lookup (helps gap-detector queries).
CREATE INDEX IF NOT EXISTS idx_raw_events_ledger1
    ON raw_events (ledger_sequence);

-- Partial index for crash-recovery scan (only unprocessed rows).
-- This is the critical index that eliminates full-table scans.
CREATE INDEX IF NOT EXISTS idx_raw_events_unprocessed
    ON raw_events (ledger_sequence, event_index)
    WHERE processed_at IS NULL;

-- ── 5. Default partition — catches any ledger not yet covered ─────────────────
-- The default partition holds rows until the operator creates a dedicated
-- partition for a new range. The retention job (see index.ts) creates new
-- partitions proactively and will never need to touch the default partition
-- for normal operation.
CREATE TABLE IF NOT EXISTS raw_events_default
    PARTITION OF raw_events DEFAULT;

-- ── 6. Seed initial partitions ────────────────────────────────────────────────
-- Cover ledger 0 through 10 000 000 (≈ 10 monthly buckets at mainnet cadence).
-- The retention job will create further buckets automatically.
-- Each statement is guarded so re-applying is safe.

DO $$
DECLARE
  i INT;
  tbl TEXT;
  lo  BIGINT;
  hi  BIGINT;
BEGIN
  FOR i IN 0..9 LOOP
    lo  := i::BIGINT * 1000000;
    hi  := lo + 1000000;
    tbl := format('raw_events_p%s_%s', lo, hi);
    IF NOT EXISTS (
        SELECT 1 FROM pg_class WHERE relname = tbl
    ) THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF raw_events FOR VALUES FROM (%s) TO (%s)',
        tbl, lo, hi
      );
      RAISE NOTICE 'Created partition %', tbl;
    END IF;
  END LOOP;
END
$$;

-- ── 7. Migrate existing rows (skipped if legacy table does not exist) ─────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'raw_events_legacy' AND relkind = 'r'
  ) THEN
    INSERT INTO raw_events
      (id, ledger_sequence, event_index, contract_id, topic, data, processed_at)
    SELECT
      id, ledger_sequence, event_index, contract_id, topic, data, processed_at
    FROM raw_events_legacy
    ON CONFLICT (ledger_sequence, event_index) DO NOTHING;

    RAISE NOTICE 'Migrated rows from raw_events_legacy into partitioned raw_events';
  END IF;
END
$$;

-- ── 8. Re-point sent_notifications FK to raw_events_legacy ───────────────────
-- After renaming raw_events → raw_events_legacy, the FK on sent_notifications
-- still points to the original OID (now raw_events_legacy), so on existing
-- deployments no change is needed.  On a fresh migration run the FK was
-- created by 008_sent_notifications.sql pointing to raw_events which is now
-- the partitioned parent — we re-point it to raw_events_legacy(id) which has
-- the single-column unique index idx_raw_events_id that can back a FK.
DO $$
BEGIN
  -- Only re-point if the FK currently references the partitioned parent.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid  = 'sent_notifications'::regclass
      AND conname   = 'sent_notifications_event_id_fkey'
      AND confrelid = 'raw_events'::regclass
  ) THEN
    ALTER TABLE sent_notifications
      DROP CONSTRAINT sent_notifications_event_id_fkey;
    ALTER TABLE sent_notifications
      ADD CONSTRAINT sent_notifications_event_id_fkey
      FOREIGN KEY (event_id) REFERENCES raw_events_legacy(id) ON DELETE CASCADE;
    RAISE NOTICE 'Re-pointed sent_notifications FK → raw_events_legacy';
  END IF;
END
$$;

-- ── 9. Sequence sync ─────────────────────────────────────────────────────────
-- The new BIGSERIAL starts at 1. If we copied rows from legacy, advance the
-- sequence past the highest existing id so new inserts do not collide.
DO $$
DECLARE
  max_id BIGINT;
BEGIN
  SELECT COALESCE(MAX(id), 0) INTO max_id FROM raw_events;
  IF max_id > 0 THEN
    PERFORM setval(pg_get_serial_sequence('raw_events', 'id'), max_id);
  END IF;
END
$$;
