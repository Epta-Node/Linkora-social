# Linkora-socials

Linkora-socials is an early-stage open source SocialFi project built on Stellar with Soroban smart contracts. The current repository is focused on the protocol foundation: a Rust contract workspace that models creator profiles, follow relationships, social posts, token tipping, and community pools.

This project is intended to serve as a starting point for contributors exploring social and creator-economy primitives on Stellar.

## Status

Linkora-socials is in the foundation stage.

- The repository currently contains the Soroban contracts workspace.
- Core social and token interaction primitives are implemented and covered by unit tests.
- Frontend, indexing, and backend services are not yet included in this repository.

If you are submitting this project to a Stellar open source contribution platform, this repository should be presented as a protocol prototype rather than a complete end-user application.

## What Linkora-socials Implements Today

The main contract in `packages/contracts/contracts/linkora-contracts` currently supports:

- Profile registration and updates
- Follow relationships between accounts
- On-chain post creation
- Tipping posts with SEP-41 compatible tokens
- Community pool deposits and withdrawals

These primitives provide a minimal base for experimenting with social-financial interactions on Soroban.

## Repository Structure

```text
.
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── packages
    └── contracts
        ├── Cargo.toml
        ├── package.json
        └── contracts
            └── linkora-contracts
                ├── Cargo.toml
                ├── Makefile
                └── src
                    ├── lib.rs
                    └── test.rs
```

## Tech Stack

- Stellar Soroban smart contracts
- Rust
- `soroban-sdk`
- Cargo workspace
- `pnpm` workspaces
- Turborepo for task orchestration

## Smart Contract Overview

The primary contract is `LinkoraContract`.

### Data Models

- `Profile`: stores a user address, username, and creator token address
- `Post`: stores post id, author, content, total tips, and timestamp
- `Pool`: stores a pool token address and tracked balance

### Public Functions

- `set_profile(user, username, creator_token)`
  Registers or updates a creator profile.
- `get_profile(user)`
  Returns profile data for a user if it exists.
- `follow(follower, followee)`
  Records a follow relationship.
- `get_following(user)`
  Returns the accounts followed by a user.
- `create_post(author, content)`
  Creates a new on-chain post and returns its id.
- `get_post(id)`
  Returns a post by id if it exists.
- `tip(tipper, post_id, token, amount)`
  Transfers SEP-41 tokens to the post author and updates the post tip total.
- `pool_deposit(depositor, pool_id, token, amount)`
  Deposits tokens into a community pool tracked by `pool_id`.
- `pool_withdraw(recipient, pool_id, amount)`
  Withdraws tokens from a pool to an authorized recipient.
- `get_pool(pool_id)`
  Returns pool state if it exists.

## Prerequisites

Install the following before working on the project:

- Node.js 18+ recommended
- `pnpm` 9+
- Rust toolchain
- Stellar CLI with Soroban support

Example installation for the Stellar CLI:

```bash
cargo install --locked stellar-cli
```

If your environment uses the older package naming, `soroban-cli` may also be valid depending on the installed tooling version.

## Getting Started

### 1. Install JavaScript Workspace Dependencies

```bash
pnpm install
```

### 2. Build the Contracts

From the repository root:

```bash
pnpm build:contracts
```

Or from the contracts package:

```bash
cd packages/contracts
pnpm build
```

### 3. Run the Contract Tests

From the repository root:

```bash
pnpm --filter contracts test
```

Or:

```bash
cd packages/contracts
cargo test
```

## Available Scripts

At the repository root:

- `pnpm dev`
- `pnpm build`
- `pnpm build:contracts`
- `pnpm lint`
- `pnpm test`
- `pnpm format`

Inside `packages/contracts`:

- `pnpm build`
- `pnpm test`
- `pnpm dev`
- `pnpm format`

## Testing

The contract test suite currently covers:

- profile creation
- follow graph updates
- post creation
- tipping flow with token transfers
- community pool deposit and withdrawal flow

Tests are located in `packages/contracts/contracts/linkora-contracts/src/test.rs`.

Sandbox-backed integration tests with real transaction signing are available under `tests/integration`.

Run them from repository root:

```bash
pnpm test:integration
```

See `tests/README.md` for setup details and CI guidance.

## Contributor Guide

Contributions are welcome, especially in these areas:

- contract hardening and security review
- event design and indexing strategy
- access control and governance for pool withdrawals
- better storage layout and scalability improvements
- frontend and API integration work
- documentation and developer tooling

When contributing:

- keep changes focused and reviewable
- prefer small pull requests
- add or update tests for behavior changes
- document any new contract method or breaking interface change

## Current Limitations

This repository is a prototype and should not be treated as production-ready infrastructure yet.

- Pool withdrawal authorization is minimal and should be replaced with stronger governance or role-based control.
- Contract storage layout has not been optimized for scale.
- There are no emitted events yet for indexers or analytics pipelines.
- No deployment scripts, frontend client, or backend service are included yet.
- Security review and audit work remain outstanding.

## Roadmap

Planned next steps include:

1. Strengthen contract authorization and safety checks
2. Add events and indexer-friendly contract patterns
3. Introduce deployment and environment tooling
4. Build application-facing SDK or client helpers
5. Add web and backend components around the contract layer

## Why This Project Matters

Linkora-socials explores how Stellar can support more than payments by combining social interaction with programmable asset flows. The goal is to make creator economies, community incentives, and lightweight SocialFi mechanics easier to build on Soroban.

## License

This repository is licensed under the MIT License.
