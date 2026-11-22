# Getting Started with Linkora

> A complete, step-by-step guide for new contributors — from zero to your first merged PR.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Clone the Repository](#clone-the-repository)
- [Automated Setup (`./scripts/setup.sh`)](#automated-setup-scripts-setupsh)
- [Manual Setup (Alternative)](#manual-setup-alternative)
- [Running the Full Monorepo](#running-the-full-monorepo)
- [Component Quick-Start Guides](#component-quick-start-guides)
  - [Web Frontend (`apps/web`)](#web-frontend-appsweb)
  - [Mobile App (`apps/mobile`)](#mobile-app-appsmobile)
  - [Indexer Service (`services/indexer`)](#indexer-service-servicesindexer)
  - [DM Relay (`services/dm-relay`)](#dm-relay-servicesdm-relay)
  - [Analytics Oracle (`services/analytics-oracle`)](#analytics-oracle-servicesanalytics-oracle)
  - [Smart Contracts (`packages/contracts`)](#smart-contracts-packagescontracts)
- [Contract Build & Test Cycle](#contract-build--test-cycle)
- [Running Tests](#running-tests)
- [Code Generation](#code-generation)
- [Using Docker Compose](#using-docker-compose)
- [Making Your First Contribution](#making-your-first-contribution)
- [Where to Find Help](#where-to-find-help)
- [Troubleshooting](#troubleshooting)
- [Useful Links](#useful-links)

---

## Prerequisites

Before you begin, ensure the following tools are installed on your machine. The setup script will verify these for you.

| Tool                    | Minimum Version                    | Installation                                                                  |
| ----------------------- | ---------------------------------- | ----------------------------------------------------------------------------- |
| **Node.js**             | `>=20` (pinned in `.node-version`) | [nodejs.org](https://nodejs.org) or `fnm`/`nvm`                               |
| **pnpm**                | `9.15.9+`                          | `npm install -g pnpm`                                                         |
| **Rust toolchain**      | Latest stable                      | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh`             |
| **Stellar CLI**         | Latest                             | `cargo install --locked stellar-cli`                                          |
| **Docker & Compose v2** | Latest                             | [docker.com](https://www.docker.com/) (required for DB migrations & services) |
| **Git**                 | Any recent version                 | [git-scm.com](https://git-scm.com/)                                           |

### Rust Wasm Targets

After installing Rust, add the WebAssembly targets required for Soroban contract compilation:

```bash
rustup target add wasm32-unknown-unknown
rustup target add wasm32v1-none
```

> **Tip:** The `setup.sh` script will offer to install missing targets automatically.

---

## Clone the Repository

```bash
# 1. Fork the repository on GitHub (https://github.com/Epta-Node/Linkora-social)
# 2. Clone your fork
git clone https://github.com/YOUR-USERNAME/Linkora-social.git
cd Linkora-social

# 3. Add the upstream remote (for syncing with main)
git remote add upstream https://github.com/Epta-Node/Linkora-social.git
```

---

## Automated Setup (`./scripts/setup.sh`)

The repository includes a **one-command setup script** that:

1. Checks all prerequisites
2. Installs JavaScript dependencies via `pnpm install`
3. Builds the Soroban contracts via `cargo build`

```bash
./scripts/setup.sh
```

### What the script does

```bash
# Checks performed:
✓ Node.js ≥ 20
✓ pnpm ≥ 9.15.9
✓ Rust/Cargo installed
✓ wasm32-unknown-unknown target
✓ Stellar CLI (stellar or soroban)

# Then runs:
pnpm install                    # Installs all workspace dependencies
cd packages/contracts && cargo build   # Builds contracts (release + debug)
```

### Expected output

```text
[setup] Checking prerequisites...
[setup] Node.js v20.18.0 ✓
[setup] pnpm 9.15.9 ✓
[setup] Rust 1.82.0 ✓
[setup] wasm32-unknown-unknown target ✓
[setup] stellar CLI 24.0.0 ✓
[setup] Installing JavaScript dependencies...
[setup] Building Soroban contracts...
[setup] ✅ Setup complete! Next steps:
   • Run tests:          pnpm test
   • Build contracts:    pnpm build:contracts
   • Deploy to testnet:  ADMIN_SECRET=S... TREASURY_ADDRESS=G... ./scripts/deploy_testnet.sh
   • See README.md for the full command reference.
```

> **Safe to re-run:** The script is idempotent. Run it again anytime you pull changes that might add new dependencies or update the Rust toolchain.

---

## Manual Setup (Alternative)

If you prefer to run steps manually or need to debug the setup process:

```bash
# 1. Install JS dependencies
pnpm install

# 2. Build contracts
pnpm build:contracts
# or equivalently:
cd packages/contracts && cargo build --workspace

# 3. Generate SDK bindings from contract WASM
pnpm codegen
```

---

## Running the Full Monorepo

Linkora uses **Turborepo** to orchestrate the monorepo. The `dev` script starts all persistent development servers in parallel.

```bash
# From the repository root
pnpm dev
```

This starts:

- **Web app** (`apps/web`) — Next.js 15 on `http://localhost:3000`
- **Mobile app** (`apps/mobile`) — Expo dev server (QR code in terminal)
- **Indexer** (`services/indexer`) — REST API on `http://localhost:3000` (conflicts with web; see below)
- **DM Relay** (`services/dm-relay`) — WebSocket on `http://localhost:3001`
- **Analytics Oracle** (`services/analytics-oracle`) — API on `http://localhost:4000`

> **Note:** The indexer and web app both default to port 3000. Run them in separate terminals, or change the indexer port via `PORT=3001 pnpm --filter @linkora/indexer dev`.

### Running Individual Services

```bash
# Web only
pnpm --filter apps-web dev

# Mobile only
pnpm --filter @linkora/mobile dev

# Indexer only (requires PostgreSQL & Redis — see Docker Compose below)
pnpm --filter @linkora/indexer dev

# DM Relay only
pnpm --filter @linkora/dm-relay dev

# Analytics Oracle only
pnpm --filter @linkora/analytics-oracle dev

# Contracts watch mode (re-runs tests on file change)
pnpm --filter contracts dev
```

---

## Component Quick-Start Guides

### Web Frontend (`apps/web`)

**Tech stack:** Next.js 15, React 19, Tailwind CSS 4, TypeScript

```bash
cd apps/web
pnpm dev          # Starts on http://localhost:3000
```

**Environment variables** (create `.env.local`):

```env
# Optional — defaults work for local development
NEXT_PUBLIC_INDEXER_API_URL=http://localhost:3000
NEXT_PUBLIC_WALLET_SDK_URL=https://cdn.freighter.app/freighter.min.js
```

**Key commands:**

```bash
pnpm build              # Production build
pnpm typecheck          # TypeScript check
pnpm lint               # ESLint
pnpm test               # Jest unit tests
pnpm test:e2e           # Playwright E2E tests (requires mock server)
pnpm test:e2e:ui        # Playwright with UI mode
pnpm storybook          # Component library on http://localhost:6006
```

---

### Mobile App (`apps/mobile`)

**Tech stack:** Expo SDK 57, React Native 0.86, Expo Router, TypeScript

```bash
cd apps/mobile
pnpm dev          # Starts Expo dev server (press 'a' for Android, 'i' for iOS)
```

**Prerequisites for device/simulator:**

- **Android:** Android Studio + emulator, or physical device with USB debugging
- **iOS (macOS only):** Xcode + simulator

**Environment variables** (create `.env`):

```env
EXPO_PUBLIC_INDEXER_API_URL=http://localhost:3000
EXPO_PUBLIC_WALLET_CONNECT_PROJECT_ID=your_walletconnect_project_id
```

**Key commands:**

```bash
pnpm android          # Build & run on Android emulator/device
pnpm ios              # Build & run on iOS simulator/device (macOS only)
pnpm build            # Production export (iOS)
pnpm typecheck        # TypeScript check
pnpm lint             # ESLint
pnpm test             # Jest unit tests
```

> **Note:** The mobile app shares the `linkora-sdk` and `@linkora/types` packages from the monorepo. Changes to those packages are reflected immediately.

---

### Indexer Service (`services/indexer`)

**Tech stack:** Node.js, TypeScript, Express, PostgreSQL, Redis, Stellar SDK

The indexer polls Stellar RPC for contract events, stores them in PostgreSQL, and serves a REST + WebSocket API.

```bash
cd services/indexer

# 1. Copy example env and fill in required values
cp .env.example .env

# 2. Start dependencies (PostgreSQL + Redis)
docker compose -f ../../docker-compose.yml up -d postgres redis

# 3. Run dev server
pnpm dev
```

**Required `.env` variables:**

```env
DATABASE_URL=postgresql://linkora:linkora@localhost:5432/linkora
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
CONTRACT_ID=CA...  # Deployed contract address (optional for local dev)
START_LEDGER=0     # Ledger to start indexing from
PORT=3000
REDIS_URL=redis://localhost:6379
```

**Key commands:**

```bash
pnpm build            # Compile TypeScript
pnpm typecheck        # TypeScript check
pnpm test             # Jest tests
pnpm lint             # ESLint
```

**API endpoints (when running):**

- `GET /health/ready` — readiness probe
- `GET /api/posts` — paginated posts
- `GET /api/profiles/:address` — profile by address
- `GET /api/pools` — community pools
- `WS /ws` — real-time event stream (requires auth frame)

---

### DM Relay (`services/dm-relay`)

**Tech stack:** Node.js, TypeScript, Express, WebSocket, PostgreSQL, Redis

End-to-end encrypted direct message relay.

```bash
cd services/dm-relay
cp .env.example .env
docker compose -f ../../docker-compose.yml up -d postgres redis
pnpm dev          # Runs on http://localhost:3001
```

**Required `.env` variables:**

```env
DATABASE_URL=postgresql://linkora:linkora@localhost:5432/linkora_dm_relay
PORT=3001
STELLAR_NETWORK=Testnet
REDIS_URL=redis://localhost:6379
```

---

### Analytics Oracle (`services/analytics-oracle`)

**Tech stack:** Node.js, TypeScript, Express, PostgreSQL, Redis, Ed25519 signing

Signs creator analytics reports and submits attestations on-chain.

```bash
cd services/analytics-oracle
cp .env.example .env  # If exists, otherwise create manually
docker compose -f ../../docker-compose.yml up -d postgres redis
pnpm dev          # Runs on http://localhost:4000
```

**Required environment:**

```env
DATABASE_URL=postgresql://linkora:linkora@localhost:5432/linkora
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
CONTRACT_ID=CA...
ORACLE_KEY_FILE=./oracle-key.hex  # 32-byte Ed25519 seed (hex)
ADMIN_SECRET=your_admin_secret
ORACLE_NAME=default
WINDOW_LEDGERS=1000
PORT=4000
REDIS_URL=redis://localhost:6379
```

> **Generate an oracle key:**
>
> ```bash
> openssl rand -hex 32 > oracle-key.hex
> ```

---

### Smart Contracts (`packages/contracts`)

**Tech stack:** Rust, Soroban SDK, Cargo workspace

```bash
cd packages/contracts

# Build (debug)
cargo build

# Build (release + wasm32v1-none target)
cargo build --target wasm32v1-none --release --workspace

# Run all tests
cargo test

# Watch mode (re-runs tests on save)
cargo watch -x test
```

**Workspace structure:**

```
packages/contracts/
├── Cargo.toml                    # Workspace root
└── contracts/
    ├── linkora-contracts/        # Core social + DeFi primitives
    │   ├── Cargo.toml
    │   ├── src/
    │   │   ├── lib.rs            # Contract entry point
    │   │   ├── test.rs           # Unit tests
    │   │   ├── validation.rs     # Input validation
    │   │   └── tests/            # Integration-style tests
    │   └── tests/                # Property-based / fuzz tests
    └── token-factory/            # Token factory contract
```

---

## Contract Build & Test Cycle

### Building Contracts

```bash
# From repo root (uses Turborepo)
pnpm build:contracts

# Or directly
cd packages/contracts
cargo build --target wasm32v1-none --release --workspace
```

**Output artifacts:**

- `packages/contracts/contracts/linkora-contracts/target/wasm32v1-none/release/linkora_contracts.wasm`
- `packages/contracts/contracts/token-factory/target/wasm32v1-none/release/token_factory.wasm`

### Running Contract Tests

```bash
# All tests (unit + integration + fuzz)
pnpm --filter contracts test

# Or directly via Cargo
cd packages/contracts
cargo test

# Specific test suites
cargo test -p linkora-contracts --test fuzz_social_graph
cargo test -p linkora-contracts --test invariant_social_graph
cargo test -p linkora-contracts --test fuzz_pools
cargo test -p linkora-contracts --test fuzz_rent
cargo test -p linkora-contracts --test fuzz_tip
cargo test -p linkora-contracts --test fuzz_credential
cargo test -p linkora-contracts --test fuzz_governance
cargo test -p linkora-contracts --test fuzz_oracle

# With fuzz feature (if applicable)
cargo test --features fuzz
```

### Test Categories

| Category                  | Location                        | Purpose                                                                |
| ------------------------- | ------------------------------- | ---------------------------------------------------------------------- |
| **Unit tests**            | `src/test.rs`, `src/tests/*.rs` | Isolated business logic, state transitions                             |
| **Property-based / Fuzz** | `tests/fuzz_*.rs`               | `proptest` invariants under arbitrary call sequences                   |
| **Invariant tests**       | `tests/invariant_*.rs`          | Mathematical invariants (nullifier uniqueness, root persistence, etc.) |
| **Integration (E2E)**     | `tests/integration/`            | Sandbox-backed cross-component tests                                   |

> **Coverage target:** ≥ 80% for `packages/contracts`. Run `cargo llvm-cov` locally if you have it installed.

---

## Running Tests

### Monorepo-Wide (TypeScript)

```bash
# All unit tests across all packages
pnpm test

# TypeScript type checking
pnpm typecheck

# Linting
pnpm lint

# Format check (run `pnpm format` to auto-fix)
pnpm format
```

### Per-Package Test Commands

| Package          | Command                                        |
| ---------------- | ---------------------------------------------- |
| Contracts        | `pnpm --filter contracts test`                 |
| SDK              | `pnpm --filter @linkora/sdk test`              |
| SDK E2E          | `pnpm --filter @linkora/sdk test:e2e`          |
| Web              | `pnpm --filter apps-web test`                  |
| Web E2E          | `pnpm --filter apps-web test:e2e`              |
| Mobile           | `pnpm --filter @linkora/mobile test`           |
| Indexer          | `pnpm --filter @linkora/indexer test`          |
| DM Relay         | `pnpm --filter @linkora/dm-relay test`         |
| Analytics Oracle | `pnpm --filter @linkora/analytics-oracle test` |

### Database Migration Tests

The indexer migrations have a dedicated test harness that verifies forward application, schema parity, idempotency, and rollback resilience:

```bash
# Requires Docker + Compose v2
bash tests/migrations/test-migrations.sh
```

See [`services/indexer/migrations/README.md`](./services/indexer/migrations/README.md) for migration authoring rules and how to refresh the schema snapshot.

---

## Code Generation

When contract interfaces change (new functions, events, or types), you must regenerate the TypeScript SDK bindings:

```bash
# From repo root
pnpm codegen
```

This runs:

1. `pnpm build:contracts` — builds every contract crate to WASM
   (`packages/contracts/target/wasm32v1-none/release/*.wasm`)
2. `pnpm --filter @linkora/codegen generate` — reads the contract spec straight
   from each WASM (the `contractspecv0` section, as `xdr.ScSpecEntry` values —
   no `stellar` CLI needed) and writes `packages/sdk/src/generated/contracts/`:
   one module per contract (`linkora`, `multicall`, `referral`, `token-factory`,
   `vesting`) with TypeScript types, `xdr.ScVal` encoders/decoders, per-function
   `Args` types, argument encoders and result decoders, event decoders and a
   typed operation builder class. New contract crates in the workspace are
   picked up automatically.

The bindings are published as the `linkora-sdk/contracts` entry point:

```ts
import { vesting } from "linkora-sdk/contracts";

const op = new vesting.VestingContract(vestingId).claim({ vest_id: 1n });
const vest = vesting.decodeGetVestResult(simulation.result.retval);
```

**Verify the committed bindings are current** (CI runs this in the
`Contract bindings are up to date` job):

```bash
pnpm codegen:check
# builds the contracts, regenerates in memory and fails listing any stale file
```

---

## Using Docker Compose

The `docker-compose.yml` at the repo root spins up the full backend stack:

```bash
# Start all services (PostgreSQL, Redis, Indexer, DM Relay, Analytics Oracle)
docker compose up -d

# View logs
docker compose logs -f indexer
docker compose logs -f dm-relay
docker compose logs -f analytics-oracle

# Stop everything
docker compose down

# Stop + remove volumes (clean slate)
docker compose down -v
```

**Service ports (host):**

| Service          | Port |
| ---------------- | ---- |
| PostgreSQL       | 5432 |
| Redis            | 6379 |
| Indexer REST API | 3000 |
| DM Relay         | 3001 |
| Analytics Oracle | 4000 |

**Environment overrides:** Create a `.env` file in the repo root to customize:

```env
POSTGRES_USER=linkora
POSTGRES_PASSWORD=linkora
POSTGRES_DB=linkora
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
CONTRACT_ID=CA...
```

---

## Making Your First Contribution

### 1. Pick an Issue

- Browse [good first issues](https://github.com/Epta-Node/Linkora-social/labels/good%20first%20issue)
- Look for `help wanted` labels
- **Introduce yourself in Telegram** before starting work to coordinate

### 2. Create a Branch

```bash
git checkout main
git pull upstream main
git checkout -b feat/your-feature-name
# or fix/, docs/, test/, chore/
```

### 3. Make Changes

- Follow the existing code style (run `pnpm format` before committing)
- Add tests for new functionality
- Update documentation if you change public APIs

### 4. Run the Full Test Suite

```bash
pnpm test           # All TypeScript tests
pnpm typecheck      # TypeScript checks
pnpm lint           # ESLint
cd packages/contracts && cargo test  # Contract tests
```

### 5. Commit with Conventional Commits

```bash
git add .
git commit -m "feat(contracts): add repost function with author attribution"
# Types: feat, fix, docs, test, chore, refactor, ci
```

### 6. Push and Open a PR

```bash
git push origin feat/your-feature-name
# Open PR on GitHub, link the issue: "Closes #1234"
```

### PR Checklist

- [ ] All tests pass locally
- [ ] New behaviour covered by tests (meeting coverage targets)
- [ ] `pnpm format` and `cargo fmt` pass
- [ ] `pnpm typecheck` passes
- [ ] Contract API docs updated if functions/events changed
- [ ] Migration tests pass if indexer schema changed
- [ ] Commit messages follow Conventional Commits
- [ ] Branch rebased on latest `main`
- [ ] PR description links the target issue

---

## Where to Find Help

| Channel                    | Purpose                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 💬 **Telegram**            | [t.me/+13csp8G4ccRhY2Zk](https://t.me/+13csp8G4ccRhY2Zk) — real-time chat, coordinate before PRs               |
| 🐛 **GitHub Issues**       | [Epta-Node/Linkora-social/issues](https://github.com/Epta-Node/Linkora-social/issues) — bugs, feature requests |
| 🔒 **Security**            | See [`SECURITY.md`](../SECURITY.md) for private vulnerability reporting                                        |
| 📖 **Documentation Index** | [`docs/INDEX.md`](./INDEX.md) — master table of contents for all docs                                          |

> **Pro tip:** Join Telegram and say hi! Maintainers and contributors hang out there and can unblock you quickly.

---

## Troubleshooting

### `./scripts/setup.sh` fails on Rust target

```bash
rustup target add wasm32-unknown-unknown
rustup target add wasm32v1-none
./scripts/setup.sh
```

### `pnpm install` fails with peer dependency errors

```bash
pnpm install --shamefully-hoist
# Or delete node_modules and pnpm-lock.yaml, then re-run
rm -rf node_modules pnpm-lock.yaml
pnpm install
```

### Port 3000 already in use (web vs indexer)

```bash
# Option 1: Run indexer on different port
PORT=3001 pnpm --filter @linkora/indexer dev

# Option 2: Kill the process on 3000
lsof -ti:3000 | xargs kill -9
```

### Docker Compose fails: "port already allocated"

```bash
docker compose down -v
docker compose up -d
```

### Contract build fails: "linker `cc` not found"

Install build tools:

- **Ubuntu/Debian:** `sudo apt-get install build-essential pkg-config libssl-dev`
- **macOS:** `xcode-select --install`
- **Fedora:** `sudo dnf install gcc pkg-config openssl-devel`

### Mobile: "Metro bundler ECONNREFUSED"

```bash
cd apps/mobile
pnpm dev --reset-cache
# Or kill existing Metro processes
pkill -f metro
```

### TypeScript errors after pulling changes

```bash
pnpm install        # May have new deps
pnpm codegen        # Contract bindings may have changed
pnpm typecheck      # Verify
```

---

## Useful Links

### Repository

- [GitHub Repo](https://github.com/Epta-Node/Linkora-social)
- [Issue Tracker](https://github.com/Epta-Node/Linkora-social/issues)
- [Pull Requests](https://github.com/Epta-Node/Linkora-social/pulls)
- [Actions / CI](https://github.com/Epta-Node/Linkora-social/actions)

### Documentation

- [Documentation Index](./INDEX.md)
- [Architecture Overview](./ARCHITECTURE.md)
- [Contract API Reference](./CONTRACT_API.md)
- [SDK Reference](./SDK_REFERENCE.md)
- [Design System](./design/README.md)
- [Deployment Guide](./DEPLOYMENT_GUIDE.md)
- [Security Audit](./SECURITY_AUDIT.md)
- [Mini Apps Developer Guide](./mini-apps/DEVELOPER_GUIDE.md)

### External Resources

- [Stellar Developer Docs](https://developers.stellar.org/)
- [Soroban SDK Docs](https://soroban.stellar.org/docs)
- [Stellar CLI Reference](https://github.com/stellar/stellar-cli)
- [pnpm Documentation](https://pnpm.io/)
- [Turborepo Documentation](https://turbo.build/repo/docs)
- [Next.js 15 Docs](https://nextjs.org/docs)
- [Expo Docs](https://docs.expo.dev/)

---

## Quick Reference Card

```bash
# ── Daily workflow ──────────────────────────────────────────────
./scripts/setup.sh              # One-time / after pulling big changes
pnpm dev                        # Start everything (web, mobile, services)
pnpm test                       # Run all tests
pnpm typecheck                  # Type-check everything
pnpm lint                       # Lint everything
pnpm format                     # Auto-format

# ── Contracts ───────────────────────────────────────────────────
pnpm build:contracts            # Build WASM
pnpm codegen                    # Regenerate SDK bindings
cd packages/contracts && cargo test   # Contract tests
cd packages/contracts && cargo watch -x test  # Watch mode

# ── Individual services ─────────────────────────────────────────
pnpm --filter apps-web dev              # Web on :3000
pnpm --filter @linkora/mobile dev       # Mobile (Expo)
pnpm --filter @linkora/indexer dev      # Indexer on :3000 (needs DB)
pnpm --filter @linkora/dm-relay dev     # DM Relay on :3001
pnpm --filter @linkora/analytics-oracle dev  # Oracle on :4000

# ── Docker ──────────────────────────────────────────────────────
docker compose up -d            # Start Postgres, Redis, all services
docker compose logs -f indexer  # Tail indexer logs
docker compose down -v          # Clean shutdown + volumes

# ── Git ─────────────────────────────────────────────────────────
git checkout main && git pull upstream main
git checkout -b feat/my-feature
# ... work ...
git add . && git commit -m "feat(scope): description"
git push origin feat/my-feature
# Open PR on GitHub
```

---

_Last updated: 2026 — If you find gaps or inaccuracies, please open a PR to improve this guide!_
