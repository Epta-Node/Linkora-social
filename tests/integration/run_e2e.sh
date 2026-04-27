#!/usr/bin/env bash
set -euo pipefail

REQUIRED_STELLAR_VERSION="22.8.1"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CONTRACT_DIR="$ROOT_DIR/packages/contracts/contracts/linkora-contracts"
CFG_DIR="$(mktemp -d)"
CONTAINER_NAME="linkora-e2e-sandbox"
NETWORK="local"
NETWORK_PASSPHRASE="Standalone Network ; February 2017"
RPC_URL="http://localhost:8000/rpc"

FAILURES=0

assert_contains() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    echo "  PASS: $name"
  else
    echo "  FAIL: $name"
    echo "        expected to find : $expected"
    echo "        actual output    : $actual"
    FAILURES=$((FAILURES + 1))
  fi
}

cleanup() {
  set +e
  stellar --config-dir "$CFG_DIR" container stop --name "$CONTAINER_NAME" >/dev/null 2>&1
  rm -rf "$CFG_DIR"
}
trap cleanup EXIT

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "error: required command '$1' is not installed" >&2
    exit 1
  fi
}

require_cmd stellar
require_cmd cargo
require_cmd docker

STELLAR_VERSION="$(stellar --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+'| head -1)"
if [[ "$STELLAR_VERSION" != "$REQUIRED_STELLAR_VERSION" ]]; then
  echo "error: stellar-cli version mismatch (found $STELLAR_VERSION, required $REQUIRED_STELLAR_VERSION)" >&2
  echo "  Install the correct version with: cargo install --locked stellar-cli --version $REQUIRED_STELLAR_VERSION" >&2
  exit 1
fi

echo "[1/8] Starting local Stellar sandbox container..."
stellar --config-dir "$CFG_DIR" container start local --name "$CONTAINER_NAME"

# Wait briefly for RPC/friendbot readiness.
sleep 4

echo "[2/8] Generating funded identities..."
for name in linkora_alice linkora_bob linkora_issuer; do
  stellar --config-dir "$CFG_DIR" keys generate "$name" --overwrite --no-fund --network "$NETWORK" >/dev/null
  stellar --config-dir "$CFG_DIR" keys fund "$name" --network "$NETWORK" >/dev/null
done

ALICE_ADDR="$(stellar --config-dir "$CFG_DIR" keys address linkora_alice)"
BOB_ADDR="$(stellar --config-dir "$CFG_DIR" keys address linkora_bob)"
ISSUER_ADDR="$(stellar --config-dir "$CFG_DIR" keys address linkora_issuer)"

echo "[3/8] Building and deploying Linkora contract..."
(
  cd "$CONTRACT_DIR"
  stellar --config-dir "$CFG_DIR" contract build >/dev/null
)
WASM_PATH="$CONTRACT_DIR/target/wasm32v1-none/release/linkora_contracts.wasm"
if [[ ! -f "$WASM_PATH" ]]; then
  echo "error: wasm artifact not found at $WASM_PATH" >&2
  exit 1
fi

CONTRACT_ID="$(stellar --config-dir "$CFG_DIR" contract deploy \
  --network "$NETWORK" \
  --source-account linkora_alice \
  --wasm "$WASM_PATH")"

echo "[4/8] Deploying token contract (SAC) for native asset..."
TOKEN_ID="$(stellar --config-dir "$CFG_DIR" contract asset deploy \
  --network "$NETWORK" \
  --source-account linkora_issuer \
  --asset native)"

echo "[5/8] Running profile/follow/post flow with real signatures..."
stellar --config-dir "$CFG_DIR" contract invoke \
  --network "$NETWORK" \
  --source-account linkora_alice \
  --id "$CONTRACT_ID" \
  -- set_profile --user "$ALICE_ADDR" --username alice --creator-token "$TOKEN_ID" >/dev/null

stellar --config-dir "$CFG_DIR" contract invoke \
  --network "$NETWORK" \
  --source-account linkora_bob \
  --id "$CONTRACT_ID" \
  -- set_profile --user "$BOB_ADDR" --username bob --creator-token "$TOKEN_ID" >/dev/null

stellar --config-dir "$CFG_DIR" contract invoke \
  --network "$NETWORK" \
  --source-account linkora_bob \
  --id "$CONTRACT_ID" \
  -- follow --follower "$BOB_ADDR" --followee "$ALICE_ADDR" >/dev/null

POST_ID="$(stellar --config-dir "$CFG_DIR" contract invoke \
  --network "$NETWORK" \
  --source-account linkora_alice \
  --id "$CONTRACT_ID" \
  -- create_post --author "$ALICE_ADDR" --content "hello-from-e2e")"

POST_ID="$(echo "$POST_ID" | tr -d '[:space:]')"

echo "[6/8] Running tip and pool flows against SAC token..."
stellar --config-dir "$CFG_DIR" contract invoke \
  --network "$NETWORK" \
  --source-account linkora_bob \
  --id "$CONTRACT_ID" \
  -- tip --tipper "$BOB_ADDR" --post-id "$POST_ID" --token "$TOKEN_ID" --amount 1000 >/dev/null

stellar --config-dir "$CFG_DIR" contract invoke \
  --network "$NETWORK" \
  --source-account linkora_bob \
  --id "$CONTRACT_ID" \
  -- pool_deposit --depositor "$BOB_ADDR" --pool-id community --token "$TOKEN_ID" --amount 600 >/dev/null

stellar --config-dir "$CFG_DIR" contract invoke \
  --network "$NETWORK" \
  --source-account linkora_alice \
  --id "$CONTRACT_ID" \
  -- pool_withdraw --recipient "$ALICE_ADDR" --pool-id community --amount 250 >/dev/null

echo "[7/8] Verifying end-to-end state..."
FOLLOWING="$(stellar --config-dir "$CFG_DIR" contract invoke \
  --network "$NETWORK" \
  --source-account linkora_bob \
  --id "$CONTRACT_ID" \
  --send no \
  -- get_following --user "$BOB_ADDR")"

assert_contains "bob follows alice" "$ALICE_ADDR" "$FOLLOWING"

POST_STATE="$(stellar --config-dir "$CFG_DIR" contract invoke \
  --network "$NETWORK" \
  --source-account linkora_alice \
  --id "$CONTRACT_ID" \
  --send no \
  -- get_post --id "$POST_ID")"

assert_contains "post tip amount is 1000" "1000" "$POST_STATE"
assert_contains "post content is hello-from-e2e" "hello-from-e2e" "$POST_STATE"

POOL_STATE="$(stellar --config-dir "$CFG_DIR" contract invoke \
  --network "$NETWORK" \
  --source-account linkora_alice \
  --id "$CONTRACT_ID" \
  --send no \
  -- get_pool --pool-id community)"

assert_contains "pool balance is 350 after deposit 600 and withdraw 250" "350" "$POOL_STATE"

echo ""
if [[ $FAILURES -gt 0 ]]; then
  echo "FAIL: $FAILURES assertion(s) failed."
  exit 1
fi

echo "[8/8] Integration flow passed."
echo "PASS: all assertions succeeded."
echo "contract_id=$CONTRACT_ID"
echo "token_id=$TOKEN_ID"
echo "alice=$ALICE_ADDR"
echo "bob=$BOB_ADDR"
echo "issuer=$ISSUER_ADDR"
