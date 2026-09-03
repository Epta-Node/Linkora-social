#!/usr/bin/env bash
# Apply all numbered migrations in filename order against $DATABASE_URL.
#
# Usage:
#   DATABASE_URL=postgresql://user:pass@host/db bash services/indexer/migrate.sh
#
# The script is idempotent: every migration uses IF NOT EXISTS so re-running
# against an already-migrated database is safe.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG_DIR="$SCRIPT_DIR/migrations"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "error: DATABASE_URL is not set" >&2
  exit 1
fi

shopt -s nullglob
MIGRATIONS=("$MIG_DIR"/*.sql)
shopt -u nullglob

if [[ ${#MIGRATIONS[@]} -eq 0 ]]; then
  echo "error: no migration files found in $MIG_DIR" >&2
  exit 1
fi

echo "[migrate] applying ${#MIGRATIONS[@]} migration(s) from $MIG_DIR"
for f in "${MIGRATIONS[@]}"; do
  echo "[migrate] $(basename "$f")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done
echo "[migrate] done"
