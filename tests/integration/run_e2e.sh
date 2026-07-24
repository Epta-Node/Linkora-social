#!/usr/bin/env bash
# =============================================================================
# Linkora E2E Integration Test Runner
#
# Sets up the full test environment:
#   1. Docker Compose (Stellar sandbox + PostgreSQL + Indexer + DM Relay)
#   2. Create funded test accounts
#   3. Build and deploy the Linkora contract
#   4. Deploy the native asset token contract
#   5. Initialize the contract
#   6. Export environment variables
#   7. Run Jest E2E test suites
#   8. Clean up
#
# Usage:
#   ./tests/integration/run_e2e.sh              # Full test run
#   ./tests/integration/run_e2e.sh --skip-build  # Skip contract build
#   ./tests/integration/run_e2e.sh --test <name> # Run specific test
#   ./tests/integration/run_e2e.sh --no-docker   # Use existing Docker services
#   ./tests/integration/run_e2e.sh --help        # Show help
# =============================================================================

set -euo pipefail

REQUIRED_STELLAR_VERSION=${REQUIRED_STELLAR_VERSION:-"22.8.1"}
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTRACT_DIR="$ROOT_DIR/packages/contracts"
E2E_DIR="$ROOT_DIR/tests/integration"
CFG_DIR="$(mktemp -d)"

# Flags
SKIP_BUILD=false
SPECIFIC_TEST=""
NO_DOCKER=false
CI_MODE=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) SKIP_BUILD=true; shift ;;
    --test) SPECIFIC_TEST="$2"; shift 2 ;;
    --no-docker) NO_DOCKER=true; shift ;;
    --ci) CI_MODE=true; NO_DOCKER=true; shift ;;
    --help)
      echo "Linkora E2E Integration Test Runner"
      echo ""
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --skip-build         Skip contract WASM build"
      echo "  --test <name>        Run only tests matching <name>"
      echo "  --no-docker          Use existing Docker services (skip docker compose)"
      echo "  --ci                 CI mode (assumes services already running)"
      echo "  --help               Show this help message"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Helper Functions ─────────────────────────────────────────────────────────

info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
pass()  { echo -e "${GREEN}[PASS]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; }

cleanup() {
  set +e
  info "Cleaning up..."

  # Stop Docker Compose (if we started it)
  if [[ "$NO_DOCKER" == "false" ]]; then
    info "Stopping Docker Compose services..."
    docker compose -f "$E2E_DIR/docker-compose.test.yml" down -v 2>/dev/null || true
  fi

  # Remove temp config
  rm -rf "$CFG_DIR" 2>/dev/null || true

  info "Cleanup complete."
}

assert_contains() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    pass "$name"
  else
    fail "$name"
    echo "        expected to find : $expected"
    echo "        actual output    : $actual"
    FAILURES=$((FAILURES + 1))
  fi
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "Required command '$1' is not installed"
    exit 1
  fi
}

# ── Pre-flight Checks ───────────────────────────────────────────────────────

FAILURES=0
trap cleanup EXIT

info "=== Linkora E2E Integration Test Runner ==="
echo ""

# Check required tools
require_cmd docker
require_cmd node
require_cmd pnpm
require_cmd stellar
require_cmd cargo

STELLAR_VERSION="$(stellar --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+'| head -1)"
if [[ "$STELLAR_VERSION" != "$REQUIRED_STELLAR_VERSION" ]]; then
  warn "stellar-cli version mismatch (found $STELLAR_VERSION, required $REQUIRED_STELLAR_VERSION)"
  warn "  Continuing anyway — tests may fail if ABI differs."
fi

# ── Step 1: Start Docker Compose Environment ────────────────────────────────

if [[ "$NO_DOCKER" == "false" ]]; then
  info "[1/9] Starting Docker Compose test environment..."
  docker compose -f "$E2E_DIR/docker-compose.test.yml" up -d --build 2>&1

  info "  Waiting for Stellar RPC to be ready..."
  # Wait for Soroban RPC endpoint to respond (up to 120s)
  for i in $(seq 1 120); do
    status=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/rpc 2>/dev/null || true)
    if [[ -n "$status" && "$status" != "000" && "$status" != "502" ]]; then
      info "  Stellar RPC ready (HTTP $status)"
      break
    fi
    sleep 1
  done

  info "  Waiting for friendbot..."
  for i in $(seq 1 60); do
    status=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/friendbot 2>/dev/null || true)
    if [[ -n "$status" && "$status" != "000" ]]; then
      info "  Friendbot ready (HTTP $status)"
      break
    fi
    sleep 1
  done

  # Wait for PostgreSQL
  info "  Waiting for PostgreSQL..."
  for i in $(seq 1 30); do
    if docker compose -f "$E2E_DIR/docker-compose.test.yml" exec -T postgres pg_isready -U linkora 2>/dev/null; then
      info "  PostgreSQL ready"
      break
    fi
    sleep 2
  done
else
  info "[1/9] Skipping Docker Compose (--no-docker mode)"
  # Wait for existing services
  info "  Waiting for Stellar RPC..."
  for i in $(seq 1 60); do
    status=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/rpc 2>/dev/null || true)
    if [[ -n "$status" && "$status" != "000" && "$status" != "502" ]]; then
      info "  Stellar RPC ready"
      break
    fi
    sleep 1
  done
fi

echo ""

# ── Step 2: Generate Funded Accounts ────────────────────────────────────────

info "[2/9] Generating funded Stellar accounts..."

for name in linkora_admin linkora_alice linkora_bob linkora_charlie linkora_issuer; do
  stellar --config-dir "$CFG_DIR" keys generate "$name" --overwrite --no-fund --network local 2>/dev/null
  stellar --config-dir "$CFG_DIR" keys fund "$name" --network local 2>/dev/null || {
    warn "  Could not fund $name via friendbot (expected outside sandbox)"
  }
done

ADMIN_ADDR="$(stellar --config-dir "$CFG_DIR" keys address linkora_admin)"
ALICE_ADDR="$(stellar --config-dir "$CFG_DIR" keys address linkora_alice)"
BOB_ADDR="$(stellar --config-dir "$CFG_DIR" keys address linkora_bob)"
CHARLIE_ADDR="$(stellar --config-dir "$CFG_DIR" keys address linkora_charlie)"
ISSUER_ADDR="$(stellar --config-dir "$CFG_DIR" keys address linkora_issuer)"

# Export secrets for TypeScript tests (so they can sign transactions)
ALICE_SECRET="$(stellar --config-dir "$CFG_DIR" keys show linkora_alice)"
BOB_SECRET="$(stellar --config-dir "$CFG_DIR" keys show linkora_bob)"
CHARLIE_SECRET="$(stellar --config-dir "$CFG_DIR" keys show linkora_charlie)"
ADMIN_SECRET="$(stellar --config-dir "$CFG_DIR" keys show linkora_admin)"

info "  Admin:  $ADMIN_ADDR"
info "  Alice:  $ALICE_ADDR"
info "  Bob:    $BOB_ADDR"
info "  Charlie:$CHARLIE_ADDR"

echo ""

# ── Step 2.5: Build SDK (required by integration tests) ─────────────────────

info "[2.5/9] Building linkora-sdk..."
(
  cd "$ROOT_DIR/packages/sdk"
  if [[ -f "package.json" ]]; then
    pnpm run build 2>&1 | tail -3
  fi
)
echo ""

# ── Step 3: Build Contract WASM ─────────────────────────────────────────────

if [[ "$SKIP_BUILD" == "false" ]]; then
  info "[3/9] Building Linkora contract WASM..."
  (
    cd "$CONTRACT_DIR"
    # The contracts crate may be at packages/contracts
    if [[ -f "Cargo.toml" ]]; then
      cargo build --target wasm32v1-none --release 2>&1 | tail -5
    else
      # Check subdirectory
      if [[ -f "contracts/linkora-contracts/Cargo.toml" ]]; then
        cd contracts/linkora-contracts
        cargo build --target wasm32v1-none --release 2>&1 | tail -5
      fi
    fi
  )
else
  info "[3/9] Skipping contract build (--skip-build)"
fi

# Find the WASM file
WASM_PATH=""
for candidate in \
  "$CONTRACT_DIR/target/wasm32v1-none/release/linkora_contracts.wasm" \
  "$CONTRACT_DIR/contracts/linkora-contracts/target/wasm32v1-none/release/linkora_contracts.wasm" \
  "$CONTRACT_DIR/target/wasm32v1-none/release/soroban_linkora_contract.wasm" \
  "$CONTRACT_DIR/target/wasm32v1-none/release/linkora.wasm"; do
  if [[ -f "$candidate" ]]; then
    WASM_PATH="$candidate"
    break
  fi
done

if [[ -z "$WASM_PATH" ]]; then
  fail "Contract WASM not found. Build it first or use --skip-build if pre-built."
  info "  Expected at: $CONTRACT_DIR/target/wasm32v1-none/release/linkora_contracts.wasm"
  exit 1
fi
info "  WASM: $WASM_PATH"
echo ""

# ── Step 4: Deploy Contracts ────────────────────────────────────────────────

info "[4/9] Deploying Linkora contract..."

CONTRACT_ID="$(stellar --config-dir "$CFG_DIR" contract deploy \
  --network local \
  --source-account linkora_admin \
  --wasm "$WASM_PATH")"

info "  Contract ID: $CONTRACT_ID"

info "[5/9] Deploying token contract (native asset)..."
TOKEN_ID="$(stellar --config-dir "$CFG_DIR" contract asset deploy \
  --network local \
  --source-account linkora_issuer \
  --asset native)"

info "  Token ID: $TOKEN_ID"
echo ""

# ── Step 5: Initialize Contract ─────────────────────────────────────────────

info "[6/9] Initializing contract..."
stellar --config-dir "$CFG_DIR" contract invoke \
  --network local \
  --source-account linkora_admin \
  --id "$CONTRACT_ID" \
  -- initialize --admin "$ADMIN_ADDR" --treasury "$ADMIN_ADDR" --fee-bps 0

info "  Contract initialized."
echo ""

# ── Step 6: Configure Indexer with Contract ID ──────────────────────────────

info "[7/9] Configuring indexer with contract ID..."
if [[ "$NO_DOCKER" == "false" ]]; then
  # Restart the indexer container with the correct CONTRACT_ID
  CONTRACT_ID="$CONTRACT_ID" TOKEN_ID="$TOKEN_ID" \
    docker compose -f "$E2E_DIR/docker-compose.test.yml" up -d indexer 2>&1 || true

  # Wait for indexer to be ready
  info "  Waiting for indexer to be healthy..."
  for i in $(seq 1 60); do
    status=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3002/health 2>/dev/null || true)
    if [[ "$status" == "200" ]]; then
      info "  Indexer ready (HTTP 200)"
      break
    fi
    sleep 2
  done

  # Wait for DM relay to be ready
  info "  Waiting for DM relay to be healthy..."
  for i in $(seq 1 30); do
    status=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3003/health 2>/dev/null || true)
    if [[ "$status" == "200" ]]; then
      info "  DM relay ready (HTTP 200)"
      break
    fi
    sleep 2
  done
fi
echo ""

# ── Step 7: Set Contract IDs in the Container (if Docker Compose) ───────────

info "[8/9] Setting contract ID in indexer..."
# We need to either restart the indexer with the contract ID or use an API to set it.
# For simplicity, we rely on the environment variable passed in the docker-compose.yml.

echo ""

# ── Step 8: Run E2E Tests ───────────────────────────────────────────────────

info "[9/9] Running E2E tests..."

# Build the test command
TEST_CMD="npx jest"

TEST_FILES="$E2E_DIR/e2e-*.test.ts"
if [[ -n "$SPECIFIC_TEST" ]]; then
  TEST_FILES="$E2E_DIR/e2e-$SPECIFIC_TEST.test.ts"
  info "  Running specific test: $SPECIFIC_TEST"
fi

info "  Using contract: $CONTRACT_ID"
info "  Using token:    $TOKEN_ID"
info "  Indexer URL:    http://localhost:3002"
info "  DM Relay URL:   http://localhost:3003"
echo ""

# Set environment variables for the tests
export CONTRACT_ID="$CONTRACT_ID"
export TOKEN_ID="$TOKEN_ID"
export STELLAR_RPC_URL="${STELLAR_RPC_URL:-http://localhost:8000/rpc}"
export STELLAR_NETWORK_PASSPHRASE="${STELLAR_NETWORK_PASSPHRASE:-Standalone Network ; February 2017}"
export INDEXER_URL="http://localhost:3002"
export DM_RELAY_URL="http://localhost:3003"
export HORIZON_URL="http://localhost:8000"

# Account secrets for programmatic transaction signing
export ALICE_SECRET
export BOB_SECRET
export CHARLIE_SECRET
export ADMIN_SECRET

# Run the tests from the E2E directory
cd "$E2E_DIR"

if ! $TEST_CMD --config jest.config.js "$TEST_FILES" 2>&1; then
  fail "E2E tests failed!"
  FAILURES=$((FAILURES + 1))
else
  pass "All E2E tests passed!"
fi

cd "$ROOT_DIR"

echo ""

# ── Step 9: Report Results ─────────────────────────────────────────────────

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                  E2E Test Results                             ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""
echo "Contract ID: $CONTRACT_ID"
echo "Token ID:    $TOKEN_ID"
echo "Admin:       $ADMIN_ADDR"
echo "Alice:       $ALICE_ADDR"
echo "Bob:         $BOB_ADDR"
echo "Charlie:     $CHARLIE_ADDR"
echo ""

if [[ $FAILURES -gt 0 ]]; then
  fail "$FAILURES test suite(s) failed."
  exit 1
fi

pass "All E2E integration tests passed!"
