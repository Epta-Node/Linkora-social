#!/usr/bin/env bash
#
# Migration filename lint.
#
# Hard requirement (see migrations/README.md): every migration filename must
# start with a ZERO-PADDED NUMERIC prefix followed by `_`, and no two
# migrations may share the same prefix.
#
# Apply order is derived from the filename (see migrate.sh), so a shared
# prefix silently hands ordering to the shell's sort collation and a future
# migration can be applied before the one it depends on. This script fails
# loudly instead.
#
# Usage:
#   bash services/indexer/lint-migrations.sh [migrations-dir]
#
# Exits 0 when the directory is clean, 1 with a diagnostic otherwise.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG_DIR="${1:-$SCRIPT_DIR/migrations}"

if [[ ! -d "$MIG_DIR" ]]; then
  echo "error: migrations directory not found: $MIG_DIR" >&2
  exit 1
fi

shopt -s nullglob
MIGRATIONS=("$MIG_DIR"/*.sql)
shopt -u nullglob

if [[ ${#MIGRATIONS[@]} -eq 0 ]]; then
  echo "error: no migration files found in $MIG_DIR" >&2
  exit 1
fi

STATUS=0
PREFIXES=""

for f in "${MIGRATIONS[@]}"; do
  base="$(basename "$f")"
  prefix="${base%%_*}"

  case "$prefix" in
    ''|*[!0-9]*)
      echo "error: migration '$base' must start with a numeric prefix followed by '_'" >&2
      STATUS=1
      continue
      ;;
  esac

  if [[ "$prefix" != "$(printf '%03d' "$((10#$prefix))")" ]]; then
    echo "error: migration '$base' prefix '$prefix' must be zero-padded to 3 digits" >&2
    STATUS=1
    continue
  fi

  PREFIXES="${PREFIXES}${prefix}
"
done

# Duplicated prefixes are exactly the bug this lint exists to catch.
DUPES="$(printf '%s' "$PREFIXES" | sort | uniq -d)"
if [[ -n "$DUPES" ]]; then
  while IFS= read -r dup; do
    [[ -z "$dup" ]] && continue
    names=""
    for f in "${MIGRATIONS[@]}"; do
      base="$(basename "$f")"
      if [[ "${base%%_*}" == "$dup" ]]; then
        names="$names $base"
      fi
    done
    echo "error: duplicate migration prefix '$dup':$names" >&2
  done <<< "$DUPES"
  STATUS=1
fi

if [[ $STATUS -ne 0 ]]; then
  echo "error: migration filename lint failed in $MIG_DIR" >&2
  exit 1
fi

echo "[lint] ${#MIGRATIONS[@]} migration(s) in $MIG_DIR have unique numeric prefixes"
exit 0
