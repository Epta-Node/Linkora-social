#!/usr/bin/env bash
# Deploy and initialize the Linkora contract on Stellar Testnet.
#
# Required environment variables:
#   ADMIN_SECRET     - Secret key of the deployer / contract admin account
#   TREASURY_ADDRESS - Public address that receives protocol fees
#   FEE_BPS          - Protocol fee in basis points (0–10000), defaults to 0
#
# Usage:
#   ADMIN_SECRET=S... TREASURY_ADDRESS=G... FEE_BPS=250 ./scripts/deploy_testnet.sh

set -euo pipefail

# ── Defaults ──────────────────────────────────────────────────────────────────

NETWORK="${NETWORK:-testnet}"
FEE_BPS="${FEE_BPS:-0}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACT_DIR="$ROOT_DIR/packages/contracts/contracts/linkora-contracts"
WASM_PATH="$CONTRACT_DIR/target/wasm32v1-none/release/linkora_contracts.wasm"

# ── Validate environment ───────────────────────────────────────────────────────

if [[ -z "${ADMIN_SECRET:-}" ]]; then
  echo "error: ADMIN_SECRET is required" >&2
  exit 1
fi

if [[ -z "${TREASURY_ADDRESS:-}" ]]; then
  echo "error: TREASURY_ADDRESS is required" >&2
  exit 1
fi

if ! command -v stellar >/dev/null 2>&1; then
  echo "error: stellar-cli is not installed" >&2
  echo "  Install with: cargo install --locked stellar-cli" >&2
  exit 1
fi

# ── Build ─────────────────────────────────────────────────────────────────────

echo "[1/3] Building contract WASM..."
(
  cd "$CONTRACT_DIR"
  stellar contract build
)

if [[ ! -f "$WASM_PATH" ]]; then
  echo "error: WASM artifact not found at $WASM_PATH" >&2
  exit 1
fi

# ── Import identity ───────────────────────────────────────────────────────────

CFG_DIR="$(mktemp -d)"
trap 'rm -rf "$CFG_DIR"' EXIT

stellar --config-dir "$CFG_DIR" keys add linkora_deployer --secret-key "$ADMIN_SECRET"
ADMIN_ADDRESS="$(stellar --config-dir "$CFG_DIR" keys address linkora_deployer)"

# ── Deploy ────────────────────────────────────────────────────────────────────

echo "[2/3] Deploying contract to $NETWORK..."
CONTRACT_ID="$(stellar --config-dir "$CFG_DIR" contract deploy \
  --network "$NETWORK" \
  --source-account linkora_deployer \
  --wasm "$WASM_PATH")"

echo "  contract_id=$CONTRACT_ID"

# ── Initialize ────────────────────────────────────────────────────────────────

echo "[3/3] Initializing contract (admin=$ADMIN_ADDRESS, treasury=$TREASURY_ADDRESS, fee_bps=$FEE_BPS)..."
stellar --config-dir "$CFG_DIR" contract invoke \
  --network "$NETWORK" \
  --source-account linkora_deployer \
  --id "$CONTRACT_ID" \
  -- initialize \
    --admin "$ADMIN_ADDRESS" \
    --treasury "$TREASURY_ADDRESS" \
    --fee-bps "$FEE_BPS"

echo ""
echo "Deployment complete."
echo "contract_id=$CONTRACT_ID"
