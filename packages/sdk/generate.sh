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
#   - pnpm dependencies installed for packages/codegen

set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$(pwd)"

WASM="$ROOT/packages/contracts/contracts/linkora-contracts/linkora_contracts.wasm"

if [ ! -f "$WASM" ]; then
  echo "WASM not found at $WASM — run 'pnpm build:contracts' first." >&2
  exit 1
fi

if [ ! -d "$ROOT/packages/codegen/node_modules" ]; then
  echo "Installing codegen dependencies..."
  pnpm install --filter @linkora/codegen
fi

pnpm --filter @linkora/codegen generate
