# Indexer database migrations

SQL migrations for the indexer's PostgreSQL schema. Files apply in filename
order (`001_…` → `011_…`). They are validated on every PR by the
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

## Relationship to `ensureSchema()`

The indexer also creates a subset of these tables at boot via `ensureSchema()`
in `src/index.ts`, so dev/test environments can run without a separate migration
step. The two must stay consistent. Notably, `indexer_state` is the
**state-root** table (`ledger_sequence, state_root, computed_at`); the
per-stream ingestion cursor lives in `indexer_cursor`. (An earlier revision of
`006_raw_events.sql` also defined `indexer_state` as a cursor table, colliding
with the state-root definition — that stale block has been removed.)

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
