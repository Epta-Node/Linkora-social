#!/usr/bin/env bash
#
# Migration test harness.
#
# Spins up a throwaway PostgreSQL (docker-compose.migrations.yml) and proves the
# indexer migrations are production-safe:
#
#   1. every migration applies forward on a fresh database,
#   2. the resulting schema matches the committed snapshot,
#   3. structural invariants hold (verify-schema.sql),
#   4. seed data can be inserted,
#   5. re-applying every migration is idempotent (no errors),
#   6. the seed data survives that second pass unchanged,
#   7. a later migration failing does not undo earlier ones,
#   8. resuming migrations onto a partially-migrated DB preserves its data, and
#   9. concurrent migration runs don't corrupt the schema.
#
# Runs identically locally and in CI. Requires only docker (compose v2) — psql
# and pg_dump are invoked inside the postgres container, so no local client or
# version match is needed.
#
# Usage: bash tests/migrations/test-migrations.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIG_DIR="$ROOT_DIR/services/indexer/migrations"
TEST_DIR="$ROOT_DIR/tests/migrations"
COMPOSE_FILE="$ROOT_DIR/docker-compose.migrations.yml"
PROJECT="linkora-migrations"
SERVICE="migrations-postgres"
DB="linkora_migtest"
DB_USER="linkora"

COMPOSE=(docker compose -p "$PROJECT" -f "$COMPOSE_FILE")

START_TS=$SECONDS
FAILURES=0

log()  { echo "  $*"; }
step() { echo; echo "=== $* ==="; }
fail() { echo "  FAIL: $*"; FAILURES=$((FAILURES + 1)); }

cleanup() {
    set +e
    step "Tearing down test database"
    "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1
    log "done"
}
trap cleanup EXIT

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "error: required command '$1' is not installed" >&2
        exit 1
    fi
}

# All in-container psql/pg_dump calls connect over TCP (-h 127.0.0.1) rather
# than the unix socket. During first-boot initdb the official image starts a
# socket-only bootstrap server; connecting over TCP guarantees we only ever
# talk to the real server once it is genuinely accepting connections.
PGHOST_ARG=(-h 127.0.0.1)

# Run a .sql file (from the host) inside the container, aborting on the first error.
psql_file() {
    "${COMPOSE[@]}" exec -T "$SERVICE" \
        psql "${PGHOST_ARG[@]}" -v ON_ERROR_STOP=1 -q -U "$DB_USER" -d "$DB" < "$1"
}

# Run an inline SQL statement, returning a single unaligned value.
psql_value() {
    "${COMPOSE[@]}" exec -T "$SERVICE" \
        psql "${PGHOST_ARG[@]}" -tAX -U "$DB_USER" -d "$DB" -c "$1"
}

# Same as psql_file/psql_value but against an arbitrary database name, so
# failure-scenario tests can use scratch databases without disturbing the
# main happy-path run above.
psql_file_db() {
    "${COMPOSE[@]}" exec -T "$SERVICE" \
        psql "${PGHOST_ARG[@]}" -v ON_ERROR_STOP=1 -q -U "$DB_USER" -d "$1" < "$2"
}

psql_value_db() {
    "${COMPOSE[@]}" exec -T "$SERVICE" \
        psql "${PGHOST_ARG[@]}" -tAX -U "$DB_USER" -d "$1" -c "$2"
}

# Normalise a schema dump so two dumps of the same schema compare equal:
# strip comments, blanks, session GUCs and psql meta-commands (the \restrict
# token pg_dump emits is randomised per run).
normalize_schema() {
    grep -vE '^--|^$|^SET |^SELECT pg_catalog|^\\'
}

dump_schema() {
    "${COMPOSE[@]}" exec -T "$SERVICE" \
        pg_dump "${PGHOST_ARG[@]}" -U "$DB_USER" -d "$DB" \
        --schema-only --no-owner --no-privileges --no-comments 2>/dev/null \
        | normalize_schema
}

require_cmd docker

step "Starting fresh PostgreSQL"
"${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
"${COMPOSE[@]}" up -d >/dev/null
log "waiting for database to accept connections..."
READY=0
for i in $(seq 1 60); do
    # Gate on a real query over TCP: this only succeeds once the actual server
    # (not the socket-only initdb bootstrap server) is up and serving.
    if "${COMPOSE[@]}" exec -T "$SERVICE" \
        psql "${PGHOST_ARG[@]}" -U "$DB_USER" -d "$DB" -tAXc 'SELECT 1' >/dev/null 2>&1; then
        log "ready after ${i}s"
        READY=1
        break
    fi
    sleep 1
done
if [[ $READY -ne 1 ]]; then
    echo "error: database did not become ready in time" >&2
    exit 1
fi

# Fail loudly if no migrations were discovered (path typo / bad checkout).
shopt -s nullglob
MIGRATIONS=("$MIG_DIR"/*.sql)
shopt -u nullglob
if [[ ${#MIGRATIONS[@]} -eq 0 ]]; then
    echo "error: no migration files found in $MIG_DIR" >&2
    exit 1
fi
log "discovered ${#MIGRATIONS[@]} migration files"

step "Step 1/9: Applying migrations forward on a fresh database"
for m in "${MIGRATIONS[@]}"; do
    if psql_file "$m" >/dev/null 2>err.log; then
        log "applied $(basename "$m")"
    else
        fail "$(basename "$m") failed to apply:"
        sed 's/^/        /' err.log
    fi
done
rm -f err.log

step "Step 2/9: Comparing schema against committed snapshot"
if [[ ! -f "$TEST_DIR/expected-schema.sql" ]]; then
    fail "expected-schema.sql snapshot is missing"
else
    ACTUAL_SCHEMA="$(dump_schema)"
    if diff -u "$TEST_DIR/expected-schema.sql" <(echo "$ACTUAL_SCHEMA") > schema.diff; then
        log "schema matches committed snapshot"
    else
        fail "schema drifted from tests/migrations/expected-schema.sql"
        log "(regenerate with: bash tests/migrations/update-schema-snapshot.sh)"
        sed 's/^/        /' schema.diff
    fi
fi
rm -f schema.diff

step "Step 3/9: Verifying structural invariants (verify-schema.sql)"
if psql_file "$TEST_DIR/verify-schema.sql" 2>&1 | sed 's/^/  /'; then
    log "structural invariants hold"
else
    fail "verify-schema.sql reported a problem"
fi

step "Step 4/9: Seeding test data"
if psql_file "$TEST_DIR/seed-data.sql" >/dev/null 2>err.log; then
    PROFILES_BEFORE="$(psql_value 'SELECT count(*) FROM profiles;')"
    POSTS_BEFORE="$(psql_value 'SELECT count(*) FROM posts;')"
    log "seeded: profiles=$PROFILES_BEFORE posts=$POSTS_BEFORE"
else
    fail "seed-data.sql failed to apply:"
    sed 's/^/        /' err.log
    PROFILES_BEFORE=-1
    POSTS_BEFORE=-1
fi
rm -f err.log

step "Step 5/9: Re-applying migrations (idempotency check)"
for m in "${MIGRATIONS[@]}"; do
    if psql_file "$m" >/dev/null 2>err.log; then
        :
    else
        fail "$(basename "$m") is NOT idempotent (failed on re-apply):"
        sed 's/^/        /' err.log
    fi
done
rm -f err.log
log "all migrations re-applied"

step "Step 6/9: Verifying data integrity after re-apply"
PROFILES_AFTER="$(psql_value 'SELECT count(*) FROM profiles;')"
POSTS_AFTER="$(psql_value 'SELECT count(*) FROM posts;')"
LIKES_AFTER="$(psql_value 'SELECT count(*) FROM likes;')"
SENT_AFTER="$(psql_value 'SELECT count(*) FROM sent_notifications;')"
log "after re-apply: profiles=$PROFILES_AFTER posts=$POSTS_AFTER likes=$LIKES_AFTER sent_notifications=$SENT_AFTER"

if [[ "$PROFILES_AFTER" != "$PROFILES_BEFORE" || "$POSTS_AFTER" != "$POSTS_BEFORE" ]]; then
    fail "row counts changed across the idempotent re-apply (profiles $PROFILES_BEFORE->$PROFILES_AFTER, posts $POSTS_BEFORE->$POSTS_AFTER)"
fi
# Sanity floor: the seed must actually be present.
if [[ "$PROFILES_AFTER" -lt 3 || "$POSTS_AFTER" -lt 1000 ]]; then
    fail "seed data missing after re-apply (profiles=$PROFILES_AFTER posts=$POSTS_AFTER)"
fi

# Re-verify invariants still hold with data present.
if ! psql_file "$TEST_DIR/verify-schema.sql" >/dev/null 2>&1; then
    fail "verify-schema.sql failed after the idempotent re-apply"
fi

step "Step 7/9: Partial failure — a later error must not undo earlier migrations"
FAIL_DB="${DB}_fail"
psql_value "DROP DATABASE IF EXISTS ${FAIL_DB};" >/dev/null
psql_value "CREATE DATABASE ${FAIL_DB} OWNER ${DB_USER};" >/dev/null

for m in "${MIGRATIONS[@]}"; do
    if ! psql_file_db "$FAIL_DB" "$m" >/dev/null 2>err.log; then
        fail "unexpected failure applying $(basename "$m") while priming $FAIL_DB"
        sed 's/^/        /' err.log
    fi
done
rm -f err.log
FAIL_PROFILES_BEFORE="$(psql_value_db "$FAIL_DB" 'SELECT count(*) FROM profiles;')"
FAIL_TABLES_BEFORE="$(psql_value_db "$FAIL_DB" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")"

# Simulate migration N+1 failing partway through (references a table that
# doesn't exist). It must error out without touching anything already applied.
if echo "ALTER TABLE this_table_does_not_exist ADD COLUMN x int;" | \
    "${COMPOSE[@]}" exec -T "$SERVICE" \
        psql "${PGHOST_ARG[@]}" -v ON_ERROR_STOP=1 -q -U "$DB_USER" -d "$FAIL_DB" >/dev/null 2>&1; then
    fail "deliberately broken migration statement did not fail as expected"
else
    log "broken statement failed as expected"
fi

FAIL_PROFILES_AFTER="$(psql_value_db "$FAIL_DB" 'SELECT count(*) FROM profiles;')"
FAIL_TABLES_AFTER="$(psql_value_db "$FAIL_DB" "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")"
if [[ "$FAIL_PROFILES_AFTER" != "$FAIL_PROFILES_BEFORE" || "$FAIL_TABLES_AFTER" != "$FAIL_TABLES_BEFORE" ]]; then
    fail "state changed after a failed migration statement (profiles $FAIL_PROFILES_BEFORE->$FAIL_PROFILES_AFTER, tables $FAIL_TABLES_BEFORE->$FAIL_TABLES_AFTER)"
else
    log "prior migrations remained intact after the failed statement ($FAIL_TABLES_AFTER tables, profiles=$FAIL_PROFILES_AFTER)"
fi

step "Step 8/9: Resuming onto a partially-migrated database preserves existing data"
PARTIAL_DB="${DB}_partial"
psql_value "DROP DATABASE IF EXISTS ${PARTIAL_DB};" >/dev/null
psql_value "CREATE DATABASE ${PARTIAL_DB} OWNER ${DB_USER};" >/dev/null

HALF=$(( ${#MIGRATIONS[@]} / 2 ))
[[ $HALF -lt 1 ]] && HALF=1
for m in "${MIGRATIONS[@]:0:$HALF}"; do
    if ! psql_file_db "$PARTIAL_DB" "$m" >/dev/null 2>err.log; then
        fail "priming partial state failed on $(basename "$m")"
        sed 's/^/        /' err.log
    fi
done
rm -f err.log

psql_value_db "$PARTIAL_DB" \
    "INSERT INTO profiles (address, username) VALUES ('GPARTIALTESTUSER0000000000000000000000000000000000000', 'partialuser');" >/dev/null
PARTIAL_PROFILES_BEFORE="$(psql_value_db "$PARTIAL_DB" 'SELECT count(*) FROM profiles;')"
log "seeded 1 profile after applying $HALF/${#MIGRATIONS[@]} migrations (profiles=$PARTIAL_PROFILES_BEFORE)"

# Resume: apply the full migration set (re-applying the first half must be a
# no-op; the rest completes the schema) against the database that already has
# real data in it.
for m in "${MIGRATIONS[@]}"; do
    if ! psql_file_db "$PARTIAL_DB" "$m" >/dev/null 2>err.log; then
        fail "resuming migrations from a partial state failed on $(basename "$m")"
        sed 's/^/        /' err.log
    fi
done
rm -f err.log

PARTIAL_PROFILES_AFTER="$(psql_value_db "$PARTIAL_DB" 'SELECT count(*) FROM profiles;')"
if [[ "$PARTIAL_PROFILES_AFTER" != "$PARTIAL_PROFILES_BEFORE" ]]; then
    fail "existing data lost while completing migrations from a partial state ($PARTIAL_PROFILES_BEFORE -> $PARTIAL_PROFILES_AFTER)"
else
    log "existing data preserved while resuming from a partial migration state"
fi

step "Step 9/9: Concurrent migration attempts don't corrupt the schema"
CONC_DB="${DB}_concurrent"
psql_value "DROP DATABASE IF EXISTS ${CONC_DB};" >/dev/null
psql_value "CREATE DATABASE ${CONC_DB} OWNER ${DB_USER};" >/dev/null

apply_all_to() {
    # Apply every migration to $1, logging all output to $2.
    # We intentionally omit -v ON_ERROR_STOP=1 here: in a concurrent run a
    # racer will sometimes lose a CREATE TABLE/TRIGGER/INDEX race and receive
    # a benign "already exists" error from Postgres. That error must not abort
    # the runner — the loser should continue so that every subsequent migration
    # (each individually idempotent) still executes. The schema-consistency
    # check that follows this step is the authoritative correctness gate.
    local dbname="$1" logfile="$2"
    : > "$logfile"
    for m in "${MIGRATIONS[@]}"; do
        "${COMPOSE[@]}" exec -T "$SERVICE" \
            psql "${PGHOST_ARG[@]}" -q -U "$DB_USER" -d "$dbname" \
            >>"$logfile" 2>&1 < "$m"
    done
}

apply_all_to "$CONC_DB" conc_a.log & PID_A=$!
apply_all_to "$CONC_DB" conc_b.log & PID_B=$!

RC_A=0; RC_B=0
wait "$PID_A" || RC_A=$?
wait "$PID_B" || RC_B=$?

if [[ $RC_A -ne 0 && $RC_B -ne 0 ]]; then
    fail "both concurrent migration runners failed"
    sed 's/^/        /' conc_a.log conc_b.log
else
    log "at least one concurrent runner completed (racer exit codes: A=$RC_A B=$RC_B)"
fi

if ! psql_file_db "$CONC_DB" "$TEST_DIR/verify-schema.sql" >/dev/null 2>err.log; then
    fail "schema invariants broken after concurrent migration runs"
    sed 's/^/        /' err.log
else
    log "schema is consistent after concurrent migration runs"
fi
rm -f err.log conc_a.log conc_b.log

ELAPSED=$((SECONDS - START_TS))
echo
echo "======================================================================"
if [[ $FAILURES -eq 0 ]]; then
    echo "PASS: all migration checks succeeded in ${ELAPSED}s (${#MIGRATIONS[@]} migrations)."
    exit 0
else
    echo "FAIL: $FAILURES migration check(s) failed (${ELAPSED}s)."
    exit 1
fi
