# Contributing to Linkora-socials

Thank you for contributing to Linkora! This document covers everything you need to know from initial development setup to opening a pull request, with detailed conventions for testing and code quality across our monorepo.

> ⭐ **Star the repo** — [Epta-Node/Linkora-social](https://github.com/Epta-Node/Linkora-social)  
> 💬 **Join Telegram** — [t.me/+13csp8G4ccRhY2Zk](https://t.me/+13csp8G4ccRhY2Zk)
>
> Please introduce yourself in Telegram before opening a PR to coordinate and avoid duplicate work.

---

## Prerequisites

Install the following tools before working on the project:

| Tool                    | Version                            | Install Link / Command                                                    |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------------------- |
| **Node.js**             | `>=20` (pinned in `.node-version`) | [nodejs.org](https://nodejs.org)                                          |
| **pnpm**                | `9.15.9+`                          | `npm install -g pnpm`                                                     |
| **Rust toolchain**      | latest stable                      | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh`         |
| **Stellar CLI**         | latest                             | `cargo install --locked stellar-cli`                                      |
| **Docker & Compose v2** | latest                             | [docker.com](https://www.docker.com/) (required for DB migration harness) |

Add the Wasm target required for Soroban contract builds:

```bash
rustup target add wasm32-unknown-unknown
# For current Soroban SDK target:
rustup target add wasm32v1-none
```

---

## Repository Structure

```text
.
├── apps/
│   ├── web/                # Next.js 15 web application
│   └── mobile/             # Expo / React Native mobile application
├── packages/
│   ├── contracts/          # Soroban smart contracts (Rust / Cargo workspace)
│   │   └── contracts/
│   │       ├── linkora-contracts/ # Core social and DeFi primitives
│   │       └── token-factory/    # Token factory contract
│   ├── sdk/                # Typed TypeScript contract client & transaction queue
│   └── types/              # Shared TypeScript type definitions
├── services/
│   ├── indexer/            # PostgreSQL event indexer & full-text search API
│   ├── dm-relay/           # E2EE direct-message relay service
│   └── analytics-oracle/   # Analytics oracle service
├── tests/
│   ├── migrations/         # PostgreSQL migration test harness & schema verification
│   └── integration/        # Sandbox-backed end-to-end integration test scripts
├── docs/                   # Architecture decision records (ADR) and API specifications
├── scripts/                # Environment setup, code generation, and deployment scripts
├── .github/                # GitHub Actions CI workflows, issue/PR templates, CODEOWNERS
├── Makefile
├── turbo.json
└── pnpm-workspace.yaml
```

---

## Local Setup

```bash
# 1. Clone your fork
git clone https://github.com/YOUR-USERNAME/Linkora-social.git
cd Linkora-social

# 2. Run automated setup (checks prerequisites, installs pnpm dependencies, builds contracts)
./scripts/setup.sh

# Or install dependencies manually:
pnpm install

# 3. Build contracts and generate SDK bindings
pnpm build:contracts
pnpm codegen
```

---

## Testing

Linkora uses a multi-tiered testing strategy spanning unit, property-based/fuzzing, integration, database migration, and end-to-end (E2E) suites across all packages.

### Testing Conventions

- **Unit Tests**:
  - Focus on isolated business logic, data models, state transitions, and edge cases.
  - Rust contract unit tests live in `src/test.rs` and leverage Soroban SDK test utilities (`Env::default()`, `mock_all_auths()`).
  - TypeScript unit tests use Jest (`*.test.ts` or `*.test.tsx`) with mocks for external network and blockchain dependencies.
- **Integration & Property-Based Tests**:
  - Property-based tests use [`proptest`](https://docs.rs/proptest) in `packages/contracts/contracts/linkora-contracts/tests/` to verify mathematical and state machine invariants under arbitrary sequences of calls.
  - Integration suites in `tests/integration/` validate cross-component interactions using a local standalone network or Docker container.
- **End-to-End (E2E) Tests**:
  - Web UI flows are validated using Playwright (`apps/web/tests/e2e`), simulating real user journeys including authentication, wallet interactions, post creation, and tipping.
  - SDK E2E tests (`packages/sdk`) verify full transaction lifecycle against simulated or live RPC nodes.
- **Database Migration Invariants**:
  - Indexer migrations are verified against strict schema snapshots and idempotency tests before merge.

---

### Coverage Targets per Package

Contributors are expected to maintain or improve code coverage when adding new features or fixing bugs:

| Package              | Minimum Target | Focus Areas                                                                            |
| -------------------- | -------------- | -------------------------------------------------------------------------------------- |
| `packages/contracts` | **80%+**       | Core social primitives, balance conservation, authorization gates, rent & fee splits   |
| `packages/sdk`       | **85%+**       | Transaction building, RPC simulation, serialization, error classification, retry logic |
| `services/indexer`   | **75%+**       | Event parsing, DB migration scripts, API route handlers, full-text queries             |
| `apps/web`           | **70%+**       | User journeys, state hooks, form validations, wallet connection & signers              |
| `apps/mobile`        | **65%+**       | Navigation flows, secure keystore storage, wallet connect integration, UI rendering    |

---

### Per-Package Test Commands

#### 1. Smart Contracts (`packages/contracts`)

```bash
# Run all contract unit tests via root pnpm filter:
pnpm --filter contracts test

# Or run directly via Cargo inside packages/contracts:
cd packages/contracts
cargo test

# Run specific fuzz and invariant property tests:
cargo test -p linkora-contracts --test fuzz_social_graph
cargo test -p linkora-contracts --test invariant_social_graph
cargo test -p linkora-contracts --test fuzz_pools
cargo test -p linkora-contracts --test fuzz_rent
cargo test -p linkora-contracts --test fuzz_tip
cargo test -p linkora-contracts --test fuzz_credential
cargo test -p linkora-contracts --test fuzz_governance
cargo test -p linkora-contracts --test fuzz_oracle

# Run fuzz tests with the fuzz feature flag (if applicable):
cargo test --features fuzz
```

> For details on property-based test design and shrinking regressions, refer to [`packages/contracts/contracts/linkora-contracts/tests/FUZZING.md`](./packages/contracts/contracts/linkora-contracts/tests/FUZZING.md).

#### 2. TypeScript SDK (`packages/sdk`)

```bash
# Run SDK unit tests:
pnpm --filter linkora-sdk test
# or:
pnpm --filter @linkora/sdk test

# Run SDK E2E tests:
pnpm --filter linkora-sdk test:e2e

# Run bundle size and tree-shaking check:
pnpm --filter linkora-sdk check:bundle
```

#### 3. Web Application (`apps/web`)

```bash
# Run Jest unit and component tests:
pnpm --filter apps-web test
# or:
pnpm --filter web test

# Run Playwright E2E tests headlessly:
pnpm --filter apps-web test:e2e
# or:
pnpm --filter web e2e

# Run Playwright with interactive UI mode:
pnpm --filter apps-web test:e2e:ui

# Run Playwright in headed mode:
pnpm --filter apps-web test:e2e:headed
```

#### 4. Mobile Application (`apps/mobile`)

```bash
# Run mobile unit tests with Jest:
pnpm --filter @linkora/mobile test
# or:
pnpm --filter mobile test

# Run TypeScript typecheck:
pnpm --filter @linkora/mobile typecheck
```

#### 5. Indexer Service (`services/indexer`)

```bash
# Run indexer unit tests:
pnpm --filter @linkora/indexer test
# or:
pnpm --filter indexer test

# Run TypeScript typecheck:
pnpm --filter @linkora/indexer typecheck
```

#### 6. Monorepo Root Suite

```bash
# Run all unit tests across the entire monorepo using Turborepo:
pnpm test

# Run all TypeScript typechecks across the monorepo:
pnpm typecheck

# Run linter across all workspaces:
pnpm lint
```

---

### Mocking Patterns for Stellar RPC in Tests

Unit tests in `@linkora/sdk` and `apps/web` must not make real network calls to Stellar RPC nodes. Instead, mock `@stellar/stellar-sdk/rpc` and `@stellar/stellar-base` using Jest mocks.

#### Example: Mocking RPC Simulation and Transaction Building

```typescript
import { LinkoraClient } from "../client";
import { Server, Api, assembleTransaction } from "@stellar/stellar-sdk/rpc";

const mockSimulateTransaction = jest.fn();
const mockAssembleBuild = jest.fn();

jest.mock("@stellar/stellar-sdk/rpc", () => ({
  Server: jest.fn(() => ({
    simulateTransaction: mockSimulateTransaction,
  })),
  Api: {
    isSimulationError: jest.fn((res) => res._isError === true),
    isSimulationSuccess: jest.fn((res) => res._isSuccess === true),
  },
  assembleTransaction: jest.fn(() => ({
    build: mockAssembleBuild,
  })),
}));

jest.mock("@stellar/stellar-base", () => ({
  Contract: jest.fn(() => ({
    call: jest.fn(),
    address: () => ({ toScAddress: () => ({ _scAddress: true }) }),
  })),
  nativeToScVal: jest.fn((val) => ({ _type: "scval", _val: val })),
  scValToNative: jest.fn((scVal) => scVal._val),
  TransactionBuilder: jest.fn(() => ({
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    setSorobanData: jest.fn().mockReturnThis(),
    build: jest.fn(),
  })),
  Operation: {
    invokeHostFunction: jest.fn(),
  },
  Keypair: {
    random: jest.fn(() => ({ publicKey: () => "GWRITEKEYMOCK1234567890" })),
  },
}));

describe("LinkoraClient RPC simulation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("handles simulation success correctly", async () => {
    mockSimulateTransaction.mockResolvedValueOnce({
      _isSuccess: true,
      minResourceFee: "100",
      results: [{ auth: [], retval: { _val: 42 } }],
    });

    // Invoke client method and assert expected result
  });
});
```

---

### Playwright E2E Setup for Web

The web application uses Playwright for end-to-end browser testing (`apps/web/playwright.config.ts`).

1. **Install Browser Dependencies**:

   ```bash
   pnpm exec playwright install --with-deps
   ```

2. **Configuration Overview**:
   - `testDir`: `./tests/e2e`
   - `baseURL`: `http://127.0.0.1:3000`
   - `webServer`: Automatically starts `pnpm start --hostname 127.0.0.1` on port 3000 with a 120s startup timeout.
   - `timeout`: 15,000ms default assertion timeout to prevent flakiness under CI resource constraints.

3. **Running with Mock Backend**:
   Before running E2E tests locally or in CI, start the lightweight mock server:

   ```bash
   # Start mock server
   node apps/web/e2e-mocks/server.js &

   # Build web app
   pnpm --filter apps-web build

   # Run tests
   pnpm --filter apps-web test:e2e
   ```

4. **Debugging E2E Tests**:
   - Inspect failed test artifacts in `apps/web/playwright-report/`.
   - Open test report in browser: `npx playwright show-report apps/web/playwright-report`.

---

### Jest Configuration for Mobile (Expo)

The mobile application uses `jest-expo` to run React Native component and unit tests in a simulated Node environment (`apps/mobile/jest.config.js`).

Key configuration settings:

- **Preset**: `jest-expo` provides preconfigured mocks for Expo modules.
- **Transform Ignore Patterns**: Customized to ensure ESM React Native packages inside the pnpm virtual store (`.pnpm/`) are properly transpiled by Babel:
  ```javascript
  transformIgnorePatterns: [
    "node_modules/(?!.pnpm/|(?:.pnpm/[^/]+/node_modules/)?(jest-)?react-native|(?:.pnpm/[^/]+/node_modules/)?@react-native(-community)?/|(?:.pnpm/[^/]+/node_modules/)?@react-native[/+]js-polyfills|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|lucide-react-native)",
  ];
  ```
- **Module Mappers**:
  - `expo-router` is mapped to `<rootDir>/jest.expo-router-mock.js`.
  - `@stellar/wallet-kit` is mapped to `<rootDir>/jest.wallet-kit-mock.js`.
  - `linkora-sdk` points to source `<rootDir>/../../packages/sdk/src/index.ts` to test uncompiled TypeScript.
- **Running in CI**:
  Always use `--forceExit --passWithNoTests` to cleanly terminate pending timer handles in React Native tests:
  ```bash
  cd apps/mobile && pnpm exec jest --forceExit --passWithNoTests
  ```

---

### Migration Test Harness (`tests/migrations/test-migrations.sh`)

The indexer database migrations must be verifiably safe, backward-compatible, and idempotent. We provide an automated test harness in [`tests/migrations/test-migrations.sh`](./tests/migrations/test-migrations.sh).

#### What the Harness Verifies

1. **Clean Forward Application**: Every SQL migration in `services/indexer/migrations/` applies cleanly on a fresh PostgreSQL instance.
2. **Schema Snapshot Parity**: The resulting schema matches `services/indexer/migrations/schema.snapshot.sql` byte-for-byte.
3. **Structural Invariants**: Runs `tests/migrations/verify-schema.sql` to verify indexes, foreign keys, and column constraints.
4. **Idempotency & Data Survival**: Inserts seed data (`tests/migrations/seed-data.sql`), re-runs all migrations, and verifies that the seed data survives unmodified.
5. **Rollback & Resilience**: Simulates interrupted migration runs to ensure no partial state corrupts the database.
6. **Concurrent Migration Locks**: Verifies that concurrent migration processes do not collide or produce race conditions.

#### Running Migration Tests Locally

Prerequisites: Docker with Compose v2 installed and running.

```bash
# Execute the migration test suite:
bash tests/migrations/test-migrations.sh
```

The script manages its own throwaway container (`docker-compose.migrations.yml`) on project `linkora-migrations` and cleans up on exit.

> **Modifying Indexer Migrations**: If your PR intentionally changes the indexer database schema, you must update the committed schema snapshot. See [`services/indexer/migrations/README.md`](./services/indexer/migrations/README.md) for the snapshot refresh workflow.

---

## Branch Naming

| Prefix   | Use for                             |
| -------- | ----------------------------------- |
| `feat/`  | New features                        |
| `fix/`   | Bug fixes                           |
| `docs/`  | Documentation changes               |
| `test/`  | Adding or updating tests            |
| `chore/` | Tooling, config, dependency updates |

Example: `feat/add-repost-function`, `fix/tip-cooldown-overflow`, `docs/testing-conventions-coverage`

Always branch from `main`:

```bash
git checkout main && git pull
git checkout -b feat/your-feature-name
```

---

## Commit Message Format

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]

[optional footer: Closes #issue]
```

**Types:** `feat`, `fix`, `docs`, `test`, `chore`, `refactor`, `ci`

**Examples:**

```
feat(contracts): add repost function with author attribution
fix(contracts): prevent tip cooldown bypass on deleted posts
docs(contributing): document testing conventions and coverage targets
test(mobile): add jest tests for wallet connection flow
```

---

## Pull Request Checklist

Before opening a PR, ensure:

- [ ] All tests pass locally (`pnpm test`, `cargo test`, `pnpm --filter contracts test`)
- [ ] New behaviour is covered by tests matching coverage targets
- [ ] Code formatting passes (`pnpm format` and `cargo fmt`)
- [ ] TypeScript type checks pass (`pnpm typecheck`)
- [ ] If contract functions or events were added/modified, `docs/CONTRACT_API.md` and `README.md` are updated
- [ ] If indexer migrations were added, `bash tests/migrations/test-migrations.sh` passes
- [ ] Commit messages follow Conventional Commits format
- [ ] PR branch is rebased on latest upstream `main`
- [ ] PR description links the target issue (e.g. `Closes #1720`)

---

## Code Review Expectations

**As an author:**

- Keep PRs small and focused — one clear concern per PR makes reviews faster.
- Respond to review feedback constructively.
- Do not force-push after a review has started; push incremental commits.
- Mark conversations as resolved only after addressing the reviewer's comment.

**As a reviewer:**

- Provide actionable feedback within 2–3 business days.
- Distinguish blocking change requests from non-blocking suggestions.
- Verify test coverage and CI status before approving.

---

## Getting Help

- 💬 **Telegram Community**: [t.me/+13csp8G4ccRhY2Zk](https://t.me/+13csp8G4ccRhY2Zk)
- 🐛 **GitHub Issues**: [Epta-Node/Linkora-social/issues](https://github.com/Epta-Node/Linkora-social/issues)
- 🔒 **Security Disclosures**: Please see [`SECURITY.md`](./SECURITY.md) for private reporting.
