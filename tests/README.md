# Integration Tests (Sandbox, Real Auth)

This directory contains integration tests that run against a local Stellar sandbox with real transaction signing via `stellar-cli`.

Unlike unit tests in `packages/contracts/contracts/linkora-contracts/src/test.rs`, these tests do **not** use `Env::default()` or `mock_all_auths()`.

## Coverage

The E2E script validates these flows on a running sandbox:

- profile creation
- follow relationship
- post creation
- tipping via token contract interaction
- pool deposit and pool withdraw

## Prerequisites

- Docker
- Rust toolchain
- `stellar` CLI in `PATH`

Install CLI if needed:

```bash
cargo install --locked stellar-cli
```

## Run Locally

From repository root:

```bash
pnpm test:integration
```

Or directly:

```bash
./tests/integration/run_e2e.sh
```

The script will:

1. Start a local sandbox container.
2. Generate/fund test identities.
3. Build and deploy `linkora-contracts` wasm.
4. Deploy a token contract for native asset interactions.
5. Execute signed invocations for profile/follow/post/tip/pool flows.
6. Assert expected state from contract view calls.
7. Stop the sandbox and clean temporary config.

## CI Separation

Keep integration tests separate from unit tests because they require Docker and a running sandbox.

Example CI step:

```yaml
- name: Run unit tests
  run: pnpm --filter contracts test

- name: Run integration tests
  run: pnpm test:integration
```

If your CI environment cannot run Docker, keep unit tests required and run this integration suite in a dedicated job or nightly workflow.
