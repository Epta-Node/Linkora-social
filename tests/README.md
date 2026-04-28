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
- `stellar` CLI **v22.8.1** in `PATH`

Install the required version:

```bash
cargo install --locked stellar-cli --version 22.8.1
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

Integration tests are kept separate from unit tests because they require Docker and a running sandbox.

The dedicated workflow is at [`.github/workflows/integration.yml`](../.github/workflows/integration.yml). It:

- Triggers on `workflow_dispatch` (manual) and on a **nightly schedule** (02:00 UTC).
- Installs Rust, `stellar-cli`, and verifies Docker availability before running the suite.
- Is intentionally separate from the unit-test CI workflow so standard PRs are not blocked by sandbox requirements.

To trigger the integration run manually, go to **Actions → Integration Tests → Run workflow** in the GitHub UI.

Unit tests continue to run in their own workflow on every push/PR:

```yaml
- name: Run unit tests
  run: pnpm --filter contracts test
```
