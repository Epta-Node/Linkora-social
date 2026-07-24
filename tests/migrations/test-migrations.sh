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
#   5. re-applying every migration is idempotent (no errors), and
#   6. the seed data survives that second pass unchanged.
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

step "Step 1/6: Applying migrations forward on a fresh database"
for m in "${MIGRATIONS[@]}"; do
    if psql_file "$m" >/dev/null 2>err.log; then
        log "applied $(basename "$m")"
    else
        fail "$(basename "$m") failed to apply:"
        sed 's/^/        /' err.log
    fi
done
rm -f err.log

step "Step 2/6: Comparing schema against committed snapshot"
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

step "Step 3/6: Verifying structural invariants (verify-schema.sql)"
if psql_file "$TEST_DIR/verify-schema.sql" 2>&1 | sed 's/^/  /'; then
    log "structural invariants hold"
else
    fail "verify-schema.sql reported a problem"
fi

step "Step 4/6: Seeding test data"
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

step "Step 5/6: Re-applying migrations (idempotency check)"
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

step "Step 6/6: Verifying data integrity after re-apply"
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
