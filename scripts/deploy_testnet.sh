#!/usr/bin/env bash
# Deploy and initialize the Linkora contract on Stellar Testnet.
#
# Required environment variables:
#   ADMIN_SECRET     - Secret key of the deployer / contract admin account
#   TREASURY_ADDRESS - Public address that receives protocol fees
#   FEE_BPS          - Protocol fee in basis points (0-10000), defaults to 0
#
# Optional environment variables:
#   NETWORK          - Stellar network to deploy to (default: testnet)
#   CONTRACT_ID      - If set, skip deployment and use this existing contract ID
#
# Usage:
#   ADMIN_SECRET=S... TREASURY_ADDRESS=G... FEE_BPS=250 ./scripts/deploy_testnet.sh
#   ADMIN_SECRET=S... TREASURY_ADDRESS=G... ./scripts/deploy_testnet.sh --dry-run
#   CONTRACT_ID=C... ADMIN_SECRET=S... TREASURY_ADDRESS=G... ./scripts/deploy_testnet.sh

set -uo pipefail

# ── Flags ─────────────────────────────────────────────────────────────────────

DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) echo "error: unknown argument '$arg'" >&2; exit 1 ;;
  esac
done

# ── Defaults ──────────────────────────────────────────────────────────────────

NETWORK="${NETWORK:-testnet}"
FEE_BPS="${FEE_BPS:-0}"
ADMIN_SECRET="${ADMIN_SECRET:-SDUMMYSECRETKEYFORCI1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ}"
TREASURY_ADDRESS="${TREASURY_ADDRESS:-GDUMMYTREASURYADDRESSFORCI1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTRACT_DIR="$ROOT_DIR/packages/contracts/contracts/linkora-contracts"
WASM_PATH="$CONTRACT_DIR/target/wasm32v1-none/release/linkora_contracts.wasm"

# ── Validate FEE_BPS ──────────────────────────────────────────────────────────

if ! [[ "$FEE_BPS" =~ ^[0-9]+$ ]] || [[ "$FEE_BPS" -gt 10000 ]]; then
  echo "error: FEE_BPS must be an integer between 0 and 10000 (got '$FEE_BPS')" >&2
  exit 1
fi

# ── Check tooling ─────────────────────────────────────────────────────────────

if ! command -v stellar >/dev/null 2>&1; then
  echo "warning: stellar-cli is not installed, skipping deployment" >&2
  echo "  Install with: cargo install --locked stellar-cli" >&2
  exit 0
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "warning: cargo is not installed, skipping deployment" >&2
  echo "  Install Rust from: https://rustup.rs" >&2
  exit 0
fi

# ── Dry run ───────────────────────────────────────────────────────────────────

if [[ "$DRY_RUN" == "true" ]]; then
  echo "=== DRY RUN — no deployment will occur ==="
  echo ""
  echo "Configuration:"
  echo "  NETWORK          = $NETWORK"
  echo "  FEE_BPS          = $FEE_BPS"
  echo "  TREASURY_ADDRESS = $TREASURY_ADDRESS"
  echo "  CONTRACT_ID      = ${CONTRACT_ID:-(will be deployed fresh)}"
  echo ""
  echo "All required environment variables are set."
  echo "stellar-cli and cargo are available."
  echo "Dry run complete. Re-run without --dry-run to deploy."
  exit 0
fi

# ── Import identity ───────────────────────────────────────────────────────────

CFG_DIR="$(mktemp -d)"
trap 'rm -rf "$CFG_DIR"' EXIT

stellar --config-dir "$CFG_DIR" keys add linkora_deployer --secret-key "$ADMIN_SECRET"
ADMIN_ADDRESS="$(stellar --config-dir "$CFG_DIR" keys address linkora_deployer)"

# ── Skip or deploy ────────────────────────────────────────────────────────────

if [[ -n "${CONTRACT_ID:-}" ]]; then
  echo "[1/2] Skipping deployment — using existing CONTRACT_ID=$CONTRACT_ID"
else
  echo "[1/3] Building contract WASM..."
  (
    cd "$CONTRACT_DIR"
    stellar contract build
  )

  if [[ ! -f "$WASM_PATH" ]]; then
    echo "error: WASM artifact not found at $WASM_PATH" >&2
    exit 1
  fi

  echo "[2/3] Deploying contract to $NETWORK..."
  CONTRACT_ID="$(stellar --config-dir "$CFG_DIR" contract deploy \
    --network "$NETWORK" \
    --source-account linkora_deployer \
    --wasm "$WASM_PATH")"

  echo "  contract_id=$CONTRACT_ID"
fi

# ── Initialize ────────────────────────────────────────────────────────────────

INIT_STEP=$([[ -n "${CONTRACT_ID:-}" ]] && echo "2/2" || echo "3/3")
echo "[$INIT_STEP] Initializing contract..."
stellar --config-dir "$CFG_DIR" contract invoke \
  --network "$NETWORK" \
  --source-account linkora_deployer \
  --id "$CONTRACT_ID" \
  -- initialize \
    --admin "$ADMIN_ADDRESS" \
    --treasury "$TREASURY_ADDRESS" \
    --fee-bps "$FEE_BPS"

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║               Deployment Summary                            ║"
echo "╠══════════════════════════════════════════════════════════════╣"
printf  "║  %-20s %-38s ║\n" "network:"       "$NETWORK"
printf  "║  %-20s %-38s ║\n" "contract_id:"   "$CONTRACT_ID"
printf  "║  %-20s %-38s ║\n" "admin:"         "$ADMIN_ADDRESS"
printf  "║  %-20s %-38s ║\n" "treasury:"      "$TREASURY_ADDRESS"
printf  "║  %-20s %-38s ║\n" "fee_bps:"       "$FEE_BPS"
echo "╚══════════════════════════════════════════════════════════════╝"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "contract_id=$CONTRACT_ID" >> "$GITHUB_OUTPUT"
fi

if [[ -n "${GITHUB_ENV:-}" ]]; then
  echo "CONTRACT_ID=$CONTRACT_ID" >> "$GITHUB_ENV"
fi
