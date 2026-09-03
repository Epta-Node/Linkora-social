# Indexer database migrations

SQL migrations for the indexer's PostgreSQL schema. Files apply in filename
order (`001_…` → `013_…`). They are validated on every PR by the
[Migration Tests](../../../.github/workflows/migrations.yml) workflow — see
[Running the tests](#running-the-tests).

## Design rules

Every migration MUST be **additive and idempotent**:

- Use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
  `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION/TRIGGER`,
  `CREATE MATERIALIZED VIEW IF NOT EXISTS`.
- Re-applying the full set on an already-migrated database must succeed with no
  errors and must not change existing data. The test harness enforces this by
  applying every migration twice and diffing row counts.
- **No inline `INDEX …` inside `CREATE TABLE`.** That is MySQL syntax and is a
  hard error in PostgreSQL. Declare indexes as separate
  `CREATE INDEX IF NOT EXISTS` statements after the table.
- A foreign key may only reference a column with a unique/primary-key
  constraint. `raw_events.id` is backed by a `UNIQUE` index for exactly this
  reason (`sent_notifications.event_id` references it).

## Reversibility

There are **no down/rollback migrations**, and this is deliberate:

- Every migration is **non-destructive** — no `DROP TABLE`, no `DROP COLUMN`, no
  data-losing `ALTER`. The only `ALTER TABLE` is
  `009_posts_fts.sql`, which does `ADD COLUMN IF NOT EXISTS … GENERATED ALWAYS`
  (purely additive; drops no data).
- Because nothing is destroyed, the recovery model is **roll-forward**: a fresh
  or partially-migrated database reaches the correct state by (re-)applying the
  migrations, which the idempotency test guarantees is safe. There is no data to
  restore on the way back, so a `DOWN` script would only ever `DROP` objects —
  which is the destructive operation we are avoiding in the first place.

If a future migration ever needs a destructive change (`DROP`, narrowing
`ALTER COLUMN`, etc.), it must:

1. document the rationale and the data-loss implications inline, and
2. ship with an accompanying idempotency test and, where a rollback is
   meaningful, a matching `*_down.sql`.

## Starting the indexer

**Migrations must be applied before the indexer starts.** At boot the indexer
calls `assertSchemaVersion()` (`src/schema-version.ts`) which checks that all
sentinel tables and columns exist and exits with a clear error if any are
missing.

Apply migrations with one of:

```bash
# Docker Compose (recommended) — migrate service runs automatically before indexer
docker compose up

# Shell script (CI / bare-metal)
DATABASE_URL=postgresql://linkora:linkora@localhost/linkora bash migrate.sh
```

Notably, `indexer_state` is the **state-root** table
(`ledger_sequence, state_root, computed_at`); the per-stream ingestion cursor
lives in `indexer_cursor`. (An earlier revision of `006_raw_events.sql` also
defined `indexer_state` as a cursor table, colliding with the state-root
definition — that stale block has been removed.)

---

## raw_events migration path (012_raw_events_partitioned.sql)

`012_raw_events_partitioned.sql` converts the monolithic `raw_events` table
created by `006_raw_events.sql` into a range-partitioned table. This section
explains the migration path and what operators need to do for **existing
deployments**.

### What the migration does

1. **Detects** whether `raw_events` is already partitioned (idempotent — skips
   entirely if it is).
2. **Renames** the monolithic table to `raw_events_legacy`.
3. **Creates** a new `PARTITION BY RANGE (ledger_sequence)` parent with:
   - the same columns and `PRIMARY KEY (ledger_sequence, event_index)`,
   - a `UNIQUE` index on `id` (preserves the FK from `sent_notifications`),
   - a **partial index** `idx_raw_events_unprocessed` on
     `(ledger_sequence, event_index) WHERE processed_at IS NULL`, eliminating
     full-table scans on crash-recovery queries,
   - a default catch-all partition.
4. **Seeds** 10 initial 1 000 000-ledger buckets (ledger 0 – 10 000 000).
5. **Migrates** all rows from `raw_events_legacy` into the partitioned parent
   using `INSERT … ON CONFLICT DO NOTHING` so re-application is safe.
6. **Advances** the `id` sequence so new inserts do not collide with legacy IDs.

### Steps for existing deployments

```
# 1. Take a database backup before running the migration.
pg_dump $DATABASE_URL -Fc -f raw_events_pre_012_backup.dump

# 2. Apply the migration.  The harness applies all migrations in order, but
#    you can also run it by itself:
psql $DATABASE_URL -f services/indexer/migrations/012_raw_events_partitioned.sql

# 3. Verify the migration succeeded.
psql $DATABASE_URL -c "
  SELECT relkind, relname
  FROM   pg_class
  WHERE  relname IN ('raw_events','raw_events_legacy')
    AND  relnamespace = 'public'::regnamespace;
"
-- Expected output:
--  relkind |       relname
-- ---------+----------------------
--  p       | raw_events           ← partitioned parent
--  r       | raw_events_legacy    ← original table (kept for safety)

# 4. Confirm row counts match.
psql $DATABASE_URL -c "
  SELECT
    (SELECT COUNT(*) FROM raw_events_legacy) AS legacy_count,
    (SELECT COUNT(*) FROM raw_events)        AS new_count;
"

# 5. Verify the partial index is in use for crash-recovery queries.
psql $DATABASE_URL -c "
  EXPLAIN (ANALYZE, BUFFERS)
  SELECT ledger_sequence, event_index
  FROM   raw_events
  WHERE  processed_at IS NULL
  LIMIT  1000;
"
-- Look for: 'Index Scan using idx_raw_events_unprocessed …'

# 6. Start the indexer normally.  The retention manager will start
#    proactively creating future partition buckets.

# 7. Once you are satisfied with indexer health, drop the legacy table
#    (the migration intentionally leaves it for the operator to decide):
psql $DATABASE_URL -c "DROP TABLE IF EXISTS raw_events_legacy;"
```

### Partition naming convention

```
raw_events_p<lo>_<hi>
```

Each bucket spans `<hi> - <lo>` ledgers. The default value is 1 000 000. At
Stellar mainnet cadence (~1 ledger/5 s) that is ≈ 5.8 M seconds ≈ **67 days
per partition**.

### Retention / partition-drop job

The `RawEventsRetentionManager` (`src/retention.ts`) runs on a configurable
`node-cron` schedule (default: every hour at minute 5). On each tick it:

1. Creates the next partition bucket (one bucket ahead of the current cursor),
   so new writes never fall into the default partition.
2. Drops any partition whose **entire ledger range** is older than
   `RAW_EVENTS_RETENTION_LEDGERS` **and** whose every row has been processed
   (`processed_at IS NOT NULL`). Partitions with unprocessed rows are logged
   as warnings and skipped.

Relevant environment variables (all optional):

| Variable                       | Default     | Description                                        |
| ------------------------------ | ----------- | -------------------------------------------------- |
| `RAW_EVENTS_RETENTION_LEDGERS` | `4000000`   | Ledgers to keep (≈ 231 days at mainnet cadence).   |
| `RAW_EVENTS_PARTITION_SIZE`    | `1000000`   | Ledger range per bucket. Must match migration 012. |
| `RAW_EVENTS_ARCHIVE_ONLY`      | `false`     | Set `true` to detach but not drop old partitions.  |
| `RAW_EVENTS_RETENTION_CRON`    | `5 * * * *` | cron schedule for the retention job.               |

---

## Running the tests

Requires Docker (Compose v2). From the repo root:

```bash
bash tests/migrations/test-migrations.sh
```

The harness spins up a throwaway PostgreSQL, applies all migrations forward,
compares the result against the committed schema snapshot
(`tests/migrations/expected-schema.sql`), checks structural invariants
(`tests/migrations/verify-schema.sql`), seeds data
(`tests/migrations/seed-data.sql`), re-applies every migration to prove
idempotency, and verifies the seed data survives — then tears the database down.
It runs in well under a minute.

After an **intentional** schema change, refresh the committed snapshot and
review the diff before committing:

```bash
bash tests/migrations/update-schema-snapshot.sh
```
