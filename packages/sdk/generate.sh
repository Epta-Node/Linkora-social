#!/usr/bin/env bash
# Regenerate the typed TypeScript client from the compiled contract WASM.
# Run this script from the repository root after rebuilding the contracts.
#
# Usage:
#   bash packages/sdk/generate.sh
#
# Prerequisites:
#   - stellar CLI installed (cargo install --locked stellar-cli)
#   - Contract built: pnpm build:contracts

set -euo pipefail

WASM="packages/contracts/contracts/linkora-contracts/target/wasm32-unknown-unknown/release/linkora_contracts.wasm"
OUT_DIR="packages/sdk/src"

if [ ! -f "$WASM" ]; then
  echo "WASM not found at $WASM — run 'pnpm build:contracts' first." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

stellar contract bindings typescript \
  --wasm "$WASM" \
  --output-dir "$OUT_DIR" \
  --overwrite

echo "Client generated in $OUT_DIR"
