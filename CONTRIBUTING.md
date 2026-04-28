# Contributing to Linkora-socials

First, thank you for considering contributing to Linkora-socials! We welcome contributions to help build out the social primitives, tooling, and ecosystem on Soroban.

This document outlines the development workflow, branching conventions, testing practices, and how to add new contract functions.

## Development Workflow

### Prerequisites

To get started with local development, ensure you have the following installed:

- **Node.js** 18+ (recommended)
- **pnpm** 9+
- **Rust toolchain** (latest stable)
- **Stellar CLI** with Soroban support
- **Docker** (required for integration tests)

You can install the Stellar CLI using Cargo:

```bash
cargo install --locked stellar-cli
```

*(Note: Depending on your tooling version, `soroban-cli` may also be valid).*

### Local Setup

Clone the repository and install the JavaScript workspace dependencies:

```bash
git clone git@github.com:Epta-Node/Linkora-social.git
cd Linkora-social
pnpm install
```

### Building Contracts

You can build the Soroban smart contracts from the repository root:

```bash
pnpm build:contracts
```

Alternatively, from within the contracts package:

```bash
cd packages/contracts
pnpm build
```

## Testing

We maintain two test suites: unit tests and integration tests.

### Running Unit Tests

Unit tests are lightweight, do not require a running network, and often use mocked authorization (`mock_all_auths()`). They cover core contract logic and state changes.

Run from the repository root:

```bash
pnpm --filter contracts test
```

Or using Cargo directly:

```bash
cd packages/contracts
cargo test
```

### Running Integration Tests

Integration tests run against a local Stellar sandbox and use real transaction signing via the CLI. They ensure end-to-end flows (e.g., cross-contract calls, real auth) work as expected.

Run from the repository root:

```bash
pnpm test:integration
```

For more details on sandbox setup, see the [Integration Tests README](tests/README.md).

## Adding a New Contract Function

When adding a new feature or function to the Linkora contracts, follow these guidelines:

1. **Focus:** Ensure the function has a single, clear purpose and falls within the scope of the project.
2. **Access Control:** Carefully consider who should be able to call the function and implement the necessary `require_auth()` checks.
3. **Tests:** Every new contract function must be covered by unit tests. If the function introduces a major flow, consider adding or updating an integration test.
4. **Events:** New state-changing functions should emit appropriate events to facilitate indexing. Review our event design strategy in [EVENTS.md](EVENTS.md).
5. **Documentation:** Add a Rust docstring explaining the inputs, outputs, and authorization rules. Update the API Reference table in the root `README.md`.

## Pull Request Guidelines

We use a standard GitHub flow. Please follow these branching and PR conventions:

1. Create a branch from `main` using a descriptive name (e.g., `feat/add-xyz`, `fix/bug-name`, `docs/update-readme`).
2. Keep changes focused and prefer small pull requests.
3. Make sure all tests pass locally before opening the PR.
4. Fill out the [Pull Request Template](.github/pull_request_template.md) completely.

## Contract Versioning Policy

The contract crate version in `packages/contracts/contracts/linkora-contracts/Cargo.toml` must stay in sync with `CHANGELOG.md`.

- Patch bump (`x.y.Z`): internal fixes that do not change contract interface or behavior expected by integrators.
- Minor bump (`x.Y.z`): backward-compatible additions such as new read functions or optional flows.
- Major bump (`X.y.z`): breaking changes to function signatures, auth model, storage assumptions, or event contracts.

When a PR changes contract behavior, include a changelog entry and update the crate version in the same PR.

### PR Checklist

Before submitting or requesting a review, verify the following (as found in our PR template):

- [ ] Tests added or updated for changed behavior
- [ ] Existing tests pass (`cargo test` and `pnpm test:integration`)
- [ ] Changes are focused — one concern per PR
- [ ] If a contract function was added or changed, the README API table is updated
- [ ] No unresolved merge conflicts

## Branch Protection Policy

The `main` branch is protected. The following rules are enforced:

- **CI must pass**: All pull requests must pass the `CI / Unit Tests` workflow before they can be merged. This gate exists because unreviewed merges have previously introduced duplicate imports and broken function bodies into `main`.
- **Review required**: At least one approving review from a repository collaborator is required before merge.
- **No direct pushes**: Direct pushes to `main` are restricted to repository administrators. All changes must go through a pull request.
- **No force-pushes**: Force-pushing to `main` is disabled to preserve commit history.

These rules are enforced at the repository level and cannot be bypassed by contributors. If CI fails on your PR, investigate and fix the root cause rather than asking for a merge exemption.

### What counts as a CI failure?

The `CI / Unit Tests` job runs `cargo test` inside `packages/contracts`. Your PR will be blocked if:

- Any unit test panics or returns an unexpected result.
- The code does not compile (including `wasm32v1-none` target).

The integration test suite (`integration.yml`) runs on a nightly schedule and on manual dispatch; it is not a required check for PRs but failures there should still be investigated promptly.
