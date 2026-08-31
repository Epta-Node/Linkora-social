#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Linkora E2E Test Runner
#
# Orchestrates the full Docker Compose environment:
#   1. Spin up Stellar standalone, PostgreSQL, indexer, and DM relay
#   2. Wait for all services to be healthy
#   3. Build, deploy, and initialize the contract
#   4. Run the TypeScript Jest E2E tests
#   5. Aggregate results
#   6. Tear down cleanly (including on failure)
#
# Usage:
#   bash tests/integration/run_e2e.sh
#
# Environment variables:
#   SKIP_BUILD     - Set to "1" to skip contract WASM rebuild
#   E2E_TIMEOUT    - Test timeout in ms (default 600000 = 10 min)
#   E2E_VERBOSE    - Set to "1" for verbose output
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

REQUIRED_STELLAR_VERSION="27.1.0"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/tests/integration/docker-compose.test.yml"
PROJECT="linkora-e2e"
CONTRACT_DIR="$ROOT_DIR/packages/contracts/contracts/linkora-contracts"
NETWORK="local"
NETWORK_PASSPHRASE="Standalone Network ; February 2017"
RPC_URL="http://localhost:8000/rpc"
TIMEOUT="${E2E_TIMEOUT:-600000}"
VERBOSE="${E2E_VERBOSE:-0}"
PASSED=0
FAILED=0
SKIPPED=0

# ── Color output helpers ──────────────────────────────────────────────────────

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

pass() { echo -e "  ${GREEN}PASS${NC}: $1"; PASSED=$((PASSED + 1)); }
fail() { echo -e "  ${RED}FAIL${NC}: $1"; FAILED=$((FAILED + 1)); }
skip() { echo -e "  ${YELLOW}SKIP${NC}: $1"; SKIPPED=$((SKIPPED + 1)); }
info() { echo -e "${CYAN}$1${NC}"; }
step() { echo; echo "━━━ $1 ━━━"; }

# ── Cleanup trap ──────────────────────────────────────────────────────────────

cleanup() {
  local exit_code=$?
  set +e
  echo ""
  info "━━━ Tearing down test environment ━━━"

  # Stop Docker Compose services (removes volumes, networks)
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true

  # Remove temp config directory
  if [[ -n "${CFG_DIR:-}" ]]; then
    rm -rf "$CFG_DIR" 2>/dev/null || true
  fi

  echo ""
  if [[ $exit_code -eq 0 ]]; then
    info "━━━ E2E Tests Complete ━━━"
    echo "  Passed: $PASSED  Failed: $FAILED  Skipped: $SKIPPED"
  else
    info "━━━ E2E Tests Interrupted (exit code $exit_code) ━━━"
    echo "  Passed: $PASSED  Failed: $FAILED  Skipped: $SKIPPED"
  fi

  if [[ $FAILED -gt 0 ]]; then
    exit 1
  fi
  exit $exit_code
}
trap cleanup EXIT

# ── Dependency checks ─────────────────────────────────────────────────────────

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command '$1' is not installed" >&2
    exit 1
  fi
}

info "━━━ Linkora E2E Test Suite ━━━"
echo "  Root:       $ROOT_DIR"
echo "  Network:    $NETWORK ($NETWORK_PASSPHRASE)"
echo "  RPC URL:    $RPC_URL"
echo "  Timeout:    ${TIMEOUT}ms"
echo "  Verbose:    $([ "$VERBOSE" = "1" ] && echo "yes" || echo "no")"

require_cmd docker
require_cmd stellar
require_cmd cargo
require_cmd pnpm
require_cmd node

# Check stellar-cli version
STELLAR_VERSION="$(stellar --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
if [[ "$STELLAR_VERSION" != "$REQUIRED_STELLAR_VERSION" ]]; then
  echo "error: stellar-cli version mismatch (found $STELLAR_VERSION, required $REQUIRED_STELLAR_VERSION)"
  echo "  Install the correct version with: cargo install --locked stellar-cli --version $REQUIRED_STELLAR_VERSION"
  exit 1
fi
echo "  stellar-cli: $STELLAR_VERSION (OK)"

# Verify Docker Compose v2 is available
if ! docker compose version >/dev/null 2>&1; then
  echo "error: docker compose v2 is required" >&2
  exit 1
fi

# ── Phase 1: Start Docker Compose environment ─────────────────────────────────

step "Phase 1/6: Starting Docker Compose environment"

# Ensure we start fresh
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true

# Pull images in parallel
info "  Pulling Docker images..."
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" pull --quiet 2>/dev/null || true

# Start all services
info "  Starting services (Stellar, PostgreSQL, Indexer, DM Relay)..."
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d 2>&1

# ── Phase 2: Wait for services to be healthy ─────────────────────────────────

step "Phase 2/6: Waiting for services to become healthy"

wait_for_healthy() {
  local service="$1"
  local max_attempts="$2"
  local attempt=0

  while [[ $attempt -lt $max_attempts ]]; do
    local status
    status=$(docker compose -p "$PROJECT" -f "$COMPOSE_FILE" ps --format "json" "$service" 2>/dev/null | grep -o '"Health":"[^"]*"' | cut -d'"' -f4 || echo "")
    if [[ "$status" == "healthy" ]]; then
      echo "  $service: healthy (after ${attempt}s)"
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  echo "  $service: NOT healthy after ${max_attempts}s"
  echo "  ── $service logs (last 40 lines) ──" >&2
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" logs --tail 40 "$service" 2>/dev/null || true
  return 1
}

echo "  Waiting for Stellar sandbox (friendbot)..."

# Wait for the RPC getHealth endpoint (canonical readiness signal) and for
# friendbot to answer requests. A parameter-less GET to friendbot returns
# HTTP 400 once it is serving, so accept 200 or 400 there.
SANDBOX_READY=0
for i in $(seq 1 120); do
  rpc=$(curl -s -X POST -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "http://localhost:8000/rpc" 2>/dev/null || true)
  fb_status=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:8000/friendbot" 2>/dev/null || true)
  if [[ "$rpc" == *healthy* && ("$fb_status" == "200" || "$fb_status" == "400") ]]; then
    echo "  Stellar sandbox ready (rpc healthy, friendbot HTTP $fb_status)"
    SANDBOX_READY=1
    break
  fi
  sleep 1
done

if [[ $SANDBOX_READY -ne 1 ]]; then
  echo "error: Stellar sandbox did not become ready in time" >&2
  exit 1
fi

# Wait for PostgreSQL, Indexer, DM Relay
wait_for_healthy "postgres" 30 || true
wait_for_healthy "dm-relay" 30 || true

info "  All core services are up (indexer will become healthy after contract deployment)"

# ── Phase 3: Create temp config directory for stellar CLI ─────────────────────

step "Phase 3/6: Configuring Stellar CLI and accounts"

CFG_DIR="$(mktemp -d)"
echo "  Config directory: $CFG_DIR"

# Set env vars for stellar CLI
export STELLAR_RPC_URL="$RPC_URL"
export STELLAR_NETWORK_PASSPHRASE="$NETWORK_PASSPHRASE"

# Ensure the 'local' network is configured in stellar CLI
stellar --config-dir "$CFG_DIR" network add "$NETWORK" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$NETWORK_PASSPHRASE" 2>/dev/null || true

# Generate and fund test accounts
fund_account() {
  local name="$1" addr="$2"
  if stellar --config-dir "$CFG_DIR" keys fund "$name" --network "$NETWORK" >/dev/null 2>&1; then
    return 0
  fi
  curl -sf --retry 15 --retry-delay 2 --retry-all-errors \
    "http://localhost:8000/friendbot?addr=${addr}" >/dev/null 2>&1
}

echo "  Generating funded identities..."
for name in e2e-admin e2e-alice e2e-bob e2e-charlie e2e-issuer e2e-treasury; do
  stellar --config-dir "$CFG_DIR" keys generate "$name" --overwrite >/dev/null
  addr=$(stellar --config-dir "$CFG_DIR" keys address "$name")
  if ! fund_account "$name" "$addr"; then
    echo "error: failed to fund $name ($addr)" >&2
    exit 1
  fi
  echo "  Funded $name"
done

# Read addresses
ADMIN_ADDR="$(stellar --config-dir "$CFG_DIR" keys address e2e-admin)"
ALICE_ADDR="$(stellar --config-dir "$CFG_DIR" keys address e2e-alice)"
BOB_ADDR="$(stellar --config-dir "$CFG_DIR" keys address e2e-bob)"
CHARLIE_ADDR="$(stellar --config-dir "$CFG_DIR" keys address e2e-charlie)"
ISSUER_ADDR="$(stellar --config-dir "$CFG_DIR" keys address e2e-issuer)"
TREASURY_ADDR="$(stellar --config-dir "$CFG_DIR" keys address e2e-treasury)"

echo "  admin:    $ADMIN_ADDR"
echo "  alice:    $ALICE_ADDR"
echo "  bob:      $BOB_ADDR"
echo "  charlie:  $CHARLIE_ADDR"
echo "  issuer:   $ISSUER_ADDR"
echo "  treasury: $TREASURY_ADDR"

# ── Phase 4: Build, deploy, and initialize contracts ─────────────────────────

step "Phase 4/6: Building and deploying contracts"

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  info "  Building contract WASM..."
  (
    cd "$CONTRACT_DIR"
    stellar --config-dir "$CFG_DIR" contract build >/dev/null
  )
  echo "  Build complete"
else
  info "  SKIP_BUILD=1, using existing WASM"
fi

# stellar contract build places artefacts in the cargo WORKSPACE target dir
# (packages/contracts/target), not inside the crate directory.
WASM_PATH="$ROOT_DIR/packages/contracts/target/wasm32v1-none/release/linkora_contracts.wasm"
if [[ ! -f "$WASM_PATH" ]]; then
  echo "error: wasm artifact not found at $WASM_PATH" >&2
  exit 1
fi

info "  Deploying Linkora contract..."
CONTRACT_ID="$(stellar --config-dir "$CFG_DIR" contract deploy \
  --network "$NETWORK" \
  --source-account e2e-admin \
  --wasm "$WASM_PATH")"
echo "  Contract ID: $CONTRACT_ID"

info "  Deploying native asset SAC..."
TOKEN_ID="$(stellar --config-dir "$CFG_DIR" contract asset deploy \
  --network "$NETWORK" \
  --source-account e2e-issuer \
  --asset native)"
echo "  Token ID: $TOKEN_ID"

info "  Initializing contract..."
stellar --config-dir "$CFG_DIR" contract invoke \
  --network "$NETWORK" \
  --source-account e2e-admin \
  --id "$CONTRACT_ID" \
  -- initialize --admin "$ADMIN_ADDR" --treasury "$TREASURY_ADDR" --fee-bps 0 >/dev/null
echo "  Contract initialized"

# ── Phase 5: Wait for indexer to catch up ─────────────────────────────────────

step "Phase 5/6: Waiting for indexer to sync"

# The indexer needs the deployed contract ID; recreate it now that one exists.
# Start streaming near the chain tip — a startLedger below the RPC's retention
# floor is rejected outright.
info "  Restarting indexer with deployed contract..."
CURRENT_LEDGER=$(curl -s -X POST "$RPC_URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' \
  | grep -o '"sequence":[0-9]*' | head -1 | cut -d: -f2)
if [[ -n "$CURRENT_LEDGER" && "$CURRENT_LEDGER" -gt 4 ]]; then
  export E2E_START_LEDGER=$((CURRENT_LEDGER - 2))
else
  export E2E_START_LEDGER=2
fi
CONTRACT_ID="$CONTRACT_ID" E2E_START_LEDGER="$E2E_START_LEDGER" \
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" \
  up -d --no-deps --force-recreate indexer

echo "  Contract ID: $CONTRACT_ID"
echo "  Token ID: $TOKEN_ID"

# Export variables for the test suite
export CONTRACT_ID="$CONTRACT_ID"
export TOKEN_ID="$TOKEN_ID"
export E2E_CFG_DIR="$CFG_DIR"
export E2E_RPC_URL="$RPC_URL"
export E2E_NETWORK_PASSPHRASE="$NETWORK_PASSPHRASE"
export E2E_FRIENDBOT_URL="http://localhost:8000/friendbot"
export E2E_HORIZON_URL="http://localhost:8000"
export E2E_INDEXER_URL="http://localhost:3000"
export E2E_RELAY_URL="http://localhost:3001"
export E2E_PROJECT_ROOT="$ROOT_DIR"

# Wait for indexer health
echo "  Waiting for indexer to be ready..."
for i in $(seq 1 30); do
  status=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/health/ready" 2>/dev/null || true)
  if [[ "$status" == "200" ]]; then
    echo "  Indexer ready (after ${i}s)"
    break
  fi
  sleep 2
done

# Wait for DM relay health
echo "  Waiting for DM relay to be ready..."
for i in $(seq 1 20); do
  status=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/health/ready" 2>/dev/null || true)
  if [[ "$status" == "200" || "$status" == "404" ]]; then
    echo "  DM relay ready (after ${i}s, health check returned $status)"
    break
  fi
  sleep 2
done

info "  Environment ready. Starting tests..."

# ── Phase 6: Run Jest E2E tests ───────────────────────────────────────────────

step "Phase 6/6: Running E2E test suites"

# Install dependencies if needed (should already be installed, but ensure)
pnpm install --frozen-lockfile --silent 2>/dev/null || pnpm install --silent 2>/dev/null || true

# Build the SDK first so imports work
pnpm --filter linkora-sdk build 2>/dev/null || true

# Resolve Jest config path
JEST_CONFIG="$ROOT_DIR/tests/integration/jest.config.js"

# Run each test file in sequence (they share the bootstrap setup)
TEST_FILES=(
  "tests/integration/e2e-lifecycle.test.ts"
  "tests/integration/e2e-social-graph.test.ts"
  "tests/integration/e2e-tipping.test.ts"
  "tests/integration/e2e-governance.test.ts"
  "tests/integration/e2e-dm-relay.test.ts"
)

for test_file in "${TEST_FILES[@]}"; do
  test_name="$(basename "$test_file" .test.ts)"
  info ""
  info "═══ Running: $test_name ═══"

  set +e
  # jest is not a root dependency; borrow the indexer's installation and pin
  # rootDir explicitly since pnpm exec starts inside the package directory.
  if [[ "$VERBOSE" == "1" ]]; then
    pnpm --filter @linkora/indexer exec jest --config "$JEST_CONFIG" \
      --rootDir "$ROOT_DIR" \
      "$ROOT_DIR/$test_file" \
      --verbose \
      --bail \
      --testTimeout "$TIMEOUT"
  else
    pnpm --filter @linkora/indexer exec jest --config "$JEST_CONFIG" \
      --rootDir "$ROOT_DIR" \
      "$ROOT_DIR/$test_file" \
      --bail \
      --testTimeout "$TIMEOUT"
  fi
  JEST_EXIT=$?
  set -e

  if [[ $JEST_EXIT -eq 0 ]]; then
    pass "$test_name"
  else
    fail "$test_name"
  fi
done

echo ""
if [[ $FAILED -gt 0 ]]; then
  info "━━━ E2E Test Summary ━━━"
  echo -e "  ${GREEN}Passed: $PASSED${NC}  ${RED}Failed: $FAILED${NC}  ${YELLOW}Skipped: $SKIPPED${NC}"
  echo ""

  # Dump service logs to make pipeline failures (e.g. missed events) diagnosable.
  info "  Dumping service logs for diagnosis..."
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" logs --tail 150 indexer || true
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" logs --tail 50 dm-relay || true

  echo "  Some tests failed. See above for details."
  exit 1
fi

info "━━━ All E2E Tests Passed ━━━"
echo -e "  ${GREEN}Passed: $PASSED${NC}  ${RED}Failed: $FAILED${NC}  ${YELLOW}Skipped: $SKIPPED${NC}"
echo ""
echo "  contract_id=$CONTRACT_ID"
echo "  token_id=$TOKEN_ID"
echo "  admin=$ADMIN_ADDR"
echo "  alice=$ALICE_ADDR"
echo "  bob=$BOB_ADDR"
echo "  charlie=$CHARLIE_ADDR"
echo "  issuer=$ISSUER_ADDR"
echo "  treasury=$TREASURY_ADDR"
