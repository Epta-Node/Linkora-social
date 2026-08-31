#!/usr/bin/env bash
# One-command local development setup for Linkora-social.
# Safe to run multiple times (idempotent).
#
# Usage:
#   ./scripts/setup.sh

set -euo pipefail

# ── Helpers ───────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[setup]${NC} $*"; }
warn()  { echo -e "${YELLOW}[setup]${NC} $*"; }
error() { echo -e "${RED}[error]${NC} $*" >&2; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ERRORS=0

# ── Prerequisite checks ───────────────────────────────────────────────────────

check_node() {
  # .node-version is the single source of truth for the required Node
  # major version, shared with CI (actions/setup-node node-version-file)
  # and packages/sdk/package.json engines. Node 20 is the current LTS.
  local required_major
  required_major=$(cat "$REPO_ROOT/.node-version" 2>/dev/null | tr -d '[:space:]')
  required_major="${required_major:-20}"

  if ! command -v node &>/dev/null; then
    error "Node.js is not installed. Install Node.js ≥ ${required_major} from https://nodejs.org"
    ERRORS=$((ERRORS + 1))
    return
  fi
  local version
  version=$(node --version | sed 's/v//')
  local major="${version%%.*}"
  if [[ "$major" -lt "$required_major" ]]; then
    error "Node.js $version found, but ≥ ${required_major} is required. Upgrade at https://nodejs.org"
    ERRORS=$((ERRORS + 1))
  else
    info "Node.js $version ✓"
  fi
}

check_pnpm() {
  if ! command -v pnpm &>/dev/null; then
    error "pnpm is not installed. Run: npm install -g pnpm"
    ERRORS=$((ERRORS + 1))
  else
    info "pnpm $(pnpm --version) ✓"
  fi
}

check_rust() {
  if ! command -v cargo &>/dev/null; then
    error "Rust/Cargo is not installed. Install from https://rustup.rs"
    ERRORS=$((ERRORS + 1))
    return
  fi
  info "Rust $(rustc --version | awk '{print $2}') ✓"

  if ! rustup target list --installed | grep -q 'wasm32-unknown-unknown'; then
    warn "wasm32-unknown-unknown target not found — installing..."
    rustup target add wasm32-unknown-unknown
  else
    info "wasm32-unknown-unknown target ✓"
  fi
}

check_stellar_cli() {
  if command -v stellar &>/dev/null; then
    info "stellar CLI $(stellar --version 2>&1 | head -1) ✓"
  elif command -v soroban &>/dev/null; then
    info "soroban CLI $(soroban --version 2>&1 | head -1) ✓"
  else
    error "Stellar CLI is not installed. Run: cargo install --locked stellar-cli"
    ERRORS=$((ERRORS + 1))
  fi
}

# ── Main ──────────────────────────────────────────────────────────────────────

info "Checking prerequisites..."
check_node
check_pnpm
check_rust
check_stellar_cli

if [[ "$ERRORS" -gt 0 ]]; then
  error "$ERRORS prerequisite(s) missing. Fix the errors above and re-run this script."
  exit 1
fi

info "Installing JavaScript dependencies..."
cd "$REPO_ROOT"
pnpm install

info "Building Soroban contracts..."
cd "$REPO_ROOT/packages/contracts"
cargo build

cd "$REPO_ROOT"

echo ""
info "✅ Setup complete! Next steps:"
echo "   • Run tests:          pnpm test"
echo "   • Build contracts:    pnpm build:contracts"
echo "   • Deploy to testnet:  ADMIN_SECRET=S... TREASURY_ADDRESS=G... ./scripts/deploy_testnet.sh"
echo "   • See README.md for the full command reference."
