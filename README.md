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
- `Post`: stores post id, author, content, total tips, timestamp, and like count
- `Pool`: stores a pool token address and tracked balance

### Contract API Reference

| Function | Purpose | Required signer | Inputs | Returns |
|---|---|---|---|---|
| `set_profile(user, username, creator_token)` | Register or update a creator profile. | `user` | `user: Address` — account being registered<br>`username: String` — display name<br>`creator_token: Address` — SEP-41 token the creator has deployed (pass own address if none) | `()` |
| `get_profile(user)` | Fetch a profile by address. | None | `user: Address` | `Option<Profile>` |
| `follow(follower, followee)` | Record a follow relationship. Duplicate follows are ignored. | `follower` | `follower: Address` — account initiating the follow<br>`followee: Address` — account being followed | `()` |
| `get_following(user)` | Return all accounts followed by a user. | None | `user: Address` | `Vec<Address>` |
| `create_post(author, content)` | Publish a new on-chain post. Post IDs are assigned sequentially starting at 1. | `author` | `author: Address` — post creator<br>`content: String` — post body | `u64` — new post ID |
| `get_post_count()` | Return the total number of posts created so far. Returns `0` when no posts exist. | None | None | `u64` |
| `get_post(id)` | Fetch a post by ID. | None | `id: u64` | `Option<Post>` |
| `tip(tipper, post_id, token, amount)` | Transfer SEP-41 tokens directly to a post's author and increment the post's `tip_total`. | `tipper` | `tipper: Address` — sender<br>`post_id: u64` — target post<br>`token: Address` — SEP-41 token contract<br>`amount: i128` — token units to transfer | `()` |
| `pool_deposit(depositor, pool_id, token, amount)` | Deposit tokens into a named community pool. `amount` must be greater than zero. | `depositor` | `depositor: Address` — token sender<br>`pool_id: Symbol` — pool identifier<br>`token: Address` — SEP-41 token contract<br>`amount: i128` — token units to deposit (must be > 0) | `()` |
| `pool_withdraw(recipient, pool_id, amount)` | Withdraw tokens from a community pool to the caller. `amount` must be greater than zero and must not exceed the pool balance. | `recipient` | `recipient: Address` — token receiver<br>`pool_id: Symbol` — pool identifier<br>`amount: i128` — token units to withdraw (must be > 0) | `()` |
| `get_pool(pool_id)` | Fetch the current state of a pool. | None | `pool_id: Symbol` | `Option<Pool>` |

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

## Troubleshooting

### Common Setup Issues

- **`pnpm` command not found**: Install pnpm globally using `npm install -g pnpm`. Linkora uses pnpm workspaces for managing multiple packages.
- **`stellar` command not found**: Install the Stellar CLI with `cargo install --locked stellar-cli`. Ensure `~/.cargo/bin` is in your system PATH.
- **`cargo test` failing**: Make sure you are running it from inside `packages/contracts`. If you are at the repository root, use `pnpm test` instead.
- **Outdated dependencies**: Always run `pnpm install` from the root directory after pulling new changes to ensure your `node_modules` and Turborepo cache are synchronized.
- **Rust build errors**: Ensure the Wasm target is installed: `rustup target add wasm32-unknown-unknown`.

### Command Reference

| Task | Root Directory | `packages/contracts` |
|---|---|---|
| **Install dependencies** | `pnpm install` | - |
| **Build Contracts** | `pnpm build:contracts` | `pnpm build` |
| **Run Tests** | `pnpm test` | `cargo test` |

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
