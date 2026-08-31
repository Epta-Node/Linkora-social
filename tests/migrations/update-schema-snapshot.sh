#!/usr/bin/env bash
#
# Regenerate tests/migrations/expected-schema.sql from the current migrations.
#
# Run this after intentionally changing a migration. It applies every migration
# to a throwaway database and writes the normalised schema dump back to the
# committed snapshot. Review the resulting diff before committing.
#
# Usage: bash tests/migrations/update-schema-snapshot.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MIG_DIR="$ROOT_DIR/services/indexer/migrations"
COMPOSE_FILE="$ROOT_DIR/docker-compose.migrations.yml"
SNAPSHOT="$ROOT_DIR/tests/migrations/expected-schema.sql"
PROJECT="linkora-migrations-snapshot"
SERVICE="migrations-postgres"
DB="linkora_migtest"
DB_USER="linkora"

COMPOSE=(docker compose -p "$PROJECT" -f "$COMPOSE_FILE")

cleanup() { "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "Starting fresh PostgreSQL..."
"${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
"${COMPOSE[@]}" up -d >/dev/null
for _ in $(seq 1 60); do
    # TCP probe so we skip the socket-only initdb bootstrap server.
    "${COMPOSE[@]}" exec -T "$SERVICE" psql -h 127.0.0.1 -U "$DB_USER" -d "$DB" -tAXc 'SELECT 1' >/dev/null 2>&1 && break
    sleep 1
done

echo "Applying migrations..."
for m in "$MIG_DIR"/*.sql; do
    "${COMPOSE[@]}" exec -T "$SERVICE" psql -h 127.0.0.1 -v ON_ERROR_STOP=1 -q -U "$DB_USER" -d "$DB" < "$m" >/dev/null
    echo "  applied $(basename "$m")"
done

echo "Writing snapshot to $SNAPSHOT ..."
"${COMPOSE[@]}" exec -T "$SERVICE" \
    pg_dump -h 127.0.0.1 -U "$DB_USER" -d "$DB" --schema-only --no-owner --no-privileges --no-comments 2>/dev/null \
    | grep -vE '^--|^$|^SET |^SELECT pg_catalog|^\\' > "$SNAPSHOT"

echo "Done. Review the diff and commit tests/migrations/expected-schema.sql."
