# Linkora-socials

[![CI](https://github.com/ijayabby/Linkora-social/actions/workflows/ci.yml/badge.svg)](https://github.com/ijayabby/Linkora-social/actions/workflows/ci.yml)

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
├── Makefile
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
| `initialize(admin, treasury, fee_bps)` | One-time contract setup. Panics if called more than once. | `admin` | `admin: Address` — contract administrator<br>`treasury: Address` — fee recipient<br>`fee_bps: u32` — protocol fee in basis points (0–10 000) | `()` |
| `set_profile(user, username, creator_token)` | Register or update a creator profile. | `user` | `user: Address` — account being registered<br>`username: String` — display name (3–32 alphanumeric or `_` characters)<br>`creator_token: Address` — SEP-41 token the creator has deployed (pass own address if none) | `()` |
| `get_profile(user)` | Fetch a profile by address. | None | `user: Address` | `Option<Profile>` |
| `get_profile_count()` | Return the total number of registered profiles. | None | None | `u64` |
| `follow(follower, followee)` | Record a follow relationship. Duplicate follows are ignored. Panics if `followee` has blocked `follower`. | `follower` | `follower: Address` — account initiating the follow<br>`followee: Address` — account being followed | `()` |
| `unfollow(follower, followee)` | Remove a follow relationship. No-op if the relationship does not exist. | `follower` | `follower: Address` — account removing the follow<br>`followee: Address` — account being unfollowed | `()` |
| `get_following(user, offset, limit)` | Return a page of accounts followed by a user. `limit` is capped at 50; panics with "limit exceeded" if violated. Returns an empty vec when `offset` is beyond the list length. | None | `user: Address`<br>`offset: u32` — zero-based start index<br>`limit: u32` — page size (max 50) | `Vec<Address>` |
| `get_followers(user, offset, limit)` | Return a page of accounts that follow a user. `limit` is capped at 50; panics with "limit exceeded" if violated. Returns an empty vec when `offset` is beyond the list length. | None | `user: Address`<br>`offset: u32` — zero-based start index<br>`limit: u32` — page size (max 50) | `Vec<Address>` |
| `block_user(blocker, blocked)` | Add an account to the caller's block list, preventing them from following. | `blocker` | `blocker: Address` — account initiating the block<br>`blocked: Address` — account being blocked | `()` |
| `unblock_user(blocker, blocked)` | Remove an account from the caller's block list. | `blocker` | `blocker: Address` — account removing the block<br>`blocked: Address` — account being unblocked | `()` |
| `is_blocked(blocker, blocked)` | Check whether `blocker` has blocked `blocked`. | None | `blocker: Address`<br>`blocked: Address` | `bool` |
| `create_post(author, content)` | Publish a new on-chain post. Post IDs are assigned sequentially starting at 1. | `author` | `author: Address` — post creator<br>`content: String` — post body (1–280 characters) | `u64` — new post ID |
| `get_post_count()` | Return the total number of posts created so far. Returns `0` when no posts exist. | None | None | `u64` |
| `get_post(id)` | Fetch a post by ID. | None | `id: u64` | `Option<Post>` |
| `delete_post(author, post_id)` | Delete a post. Only the original author may delete their own post. | `author` | `author: Address` — post owner<br>`post_id: u64` — ID of the post to delete | `()` |
| `get_posts_by_author(author, offset, limit)` | Return a page of post IDs created by an author, in insertion order. `limit` is capped at 50; panics with "limit exceeded" if violated. | None | `author: Address`<br>`offset: u32` — zero-based start index<br>`limit: u32` — page size (max 50) | `Vec<u64>` |
| `like_post(user, post_id)` | Like a post. Duplicate likes from the same user are ignored. | `user` | `user: Address` — account liking the post<br>`post_id: u64` — target post | `()` |
| `get_like_count(post_id)` | Return the number of likes on a post. | None | `post_id: u64` | `u64` |
| `has_liked(user, post_id)` | Check whether a user has liked a specific post. | None | `user: Address`<br>`post_id: u64` | `bool` |
| `tip(tipper, post_id, token, amount)` | Transfer SEP-41 tokens to a post's author, applying the protocol fee, and increment the post's `tip_total`. | `tipper` | `tipper: Address` — sender<br>`post_id: u64` — target post<br>`token: Address` — SEP-41 token contract<br>`amount: i128` — token units to transfer (must be > 0) | `()` |
| `create_pool(admin, pool_id, token, initial_admins, threshold)` | Create a named community pool with an M-of-N admin set. Requires contract admin auth. | contract `admin` | `admin: Address` — caller (must be contract admin)<br>`pool_id: Symbol` — unique pool identifier<br>`token: Address` — SEP-41 token for the pool<br>`initial_admins: Vec<Address>` — admin set<br>`threshold: u32` — minimum signatures required to withdraw (must be > 0 and ≤ `initial_admins.len()`) | `()` |
| `pool_deposit(depositor, pool_id, token, amount)` | Deposit tokens into a named community pool. `amount` must be greater than zero. | `depositor` | `depositor: Address` — token sender<br>`pool_id: Symbol` — pool identifier<br>`token: Address` — SEP-41 token contract (must match pool token)<br>`amount: i128` — token units to deposit (must be > 0) | `()` |
| `pool_withdraw(signers, pool_id, amount, recipient)` | Withdraw tokens from a community pool. Requires at least `threshold` valid admin signatures from the pool's admin set. | each address in `signers` | `signers: Vec<Address>` — admin addresses authorising the withdrawal<br>`pool_id: Symbol` — pool identifier<br>`amount: i128` — token units to withdraw (must be > 0 and ≤ pool balance)<br>`recipient: Address` — token receiver | `()` |
| `get_pool(pool_id)` | Fetch the current state of a pool. | None | `pool_id: Symbol` | `Option<Pool>` |
| `get_pool_admins(pool_id)` | Return the current admin list for a pool. | None | `pool_id: Symbol` | `Vec<Address>` |
| `add_pool_admin(signers, pool_id, new_admin)` | Add a new admin to a pool. Requires threshold signatures from existing admins. | each address in `signers` | `signers: Vec<Address>` — admin addresses authorising the addition<br>`pool_id: Symbol` — pool identifier<br>`new_admin: Address` — admin to add | `()` |
| `remove_pool_admin(signers, pool_id, admin)` | Remove an admin from a pool. Requires threshold signatures from existing admins. | each address in `signers` | `signers: Vec<Address>` — admin addresses authorising the removal<br>`pool_id: Symbol` — pool identifier<br>`admin: Address` — admin to remove | `()` |
| `update_pool_threshold(signers, pool_id, threshold)` | Update the signature threshold for a pool. Requires threshold signatures from existing admins. | each address in `signers` | `signers: Vec<Address>` — admin addresses authorising the update<br>`pool_id: Symbol` — pool identifier<br>`threshold: u32` — new threshold (must be > 0 and ≤ admin count) | `()` |
| `set_fee(fee_bps)` | Update the protocol fee. Only callable by the contract admin. | contract `admin` | `fee_bps: u32` — new fee in basis points (0–10 000) | `()` |
| `set_treasury(treasury)` | Update the treasury address that receives protocol fees. Only callable by the contract admin. | contract `admin` | `treasury: Address` — new fee recipient | `()` |
| `get_fee_bps()` | Return the current protocol fee in basis points. | None | None | `u32` |
| `get_treasury()` | Return the current treasury address. | None | None | `Option<Address>` |
| `upgrade(new_wasm_hash)` | Upgrade the contract WASM. Only callable by the contract admin. | contract `admin` | `new_wasm_hash: BytesN<32>` — hash of the new WASM blob | `()` |

## Storage Layout

Linkora-socials uses Soroban's state storage to manage its data. All persistent storage keys are typed variants of the `StorageKey` enum defined with `#[contracttype]`, which provides compile-time key consistency and eliminates raw `Symbol` tuple keys.

### Storage Namespaces

- **Instance Storage**: Used for contract-wide configuration and small, frequently updated counters (e.g., admin address, post counter).
- **Persistent Storage**: Used for all user-generated data like profiles, posts, and social relationships. This data is subject to TTL extensions to remain on-chain.

### StorageKey Enum

```rust
#[contracttype]
pub enum StorageKey {
    Post(u64),
    Profile(Address),
    Following(Address),
    Followers(Address),
    Pool(Symbol),
    Like(u64, Address),
    AuthorPosts(Address),
    Blocks(Address),
}
```

### Key Mapping

| Key | StorageKey variant | Namespace | Purpose |
|---|---|---|---|
| `PROFILES` | `(Symbol("PROFILES"), Address)` | Persistent | Stores user `Profile` data. |
| `UNAMES` | `(Symbol("UNAMES"), String)` | Persistent | Maps each username to the owning `Address` so usernames stay unique. |
| `PROF_CT` | `Symbol("PROF_CT")` | Instance | Tracks the total number of registered profiles. |
| Following | `StorageKey::Following(Address)` | Persistent | Stores a `Vec<Address>` of accounts that the given address follows. |
| Followers | `StorageKey::Followers(Address)` | Persistent | Stores a `Vec<Address>` of accounts following the given address. |
| Blocks | `StorageKey::Blocks(Address)` | Persistent | Stores a `Map<Address, ()>` of accounts blocked by the given address. |
| Post | `StorageKey::Post(u64)` | Persistent | Stores individual `Post` objects by their incremental ID. |
| `POST_CT` | `Symbol("POST_CT")` | Instance | Tracks the total number of posts created (used for ID generation). |
| Pool | `StorageKey::Pool(Symbol)` | Persistent | Stores `Pool` data for named community pools. |
| Like | `StorageKey::Like(u64, Address)` | Persistent | Records whether a specific user has liked a specific post. |
| AuthorPosts | `StorageKey::AuthorPosts(Address)` | Persistent | Stores a `Vec<u64>` of post IDs created by the given author. |
| `ADMIN` | `Symbol("ADMIN")` | Instance | Stores the contract administrator's address. |
| `TREASURY` | `Symbol("TREASURY")` | Instance | Stores the treasury address that receives protocol fees. |
| `FEE_BPS` | `Symbol("FEE_BPS")` | Instance | Stores the protocol fee in basis points (0–10 000). |
| `INIT` | `Symbol("INIT")` | Instance | Boolean flag indicating if the contract has been initialized. |

> [!NOTE]
> This storage layout is designed for the prototype phase and has not been optimized for large-scale data or minimal footprint.

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

## Makefile Targets

The repository root also includes a `Makefile` with thin wrappers around the existing workspace scripts:

- `make dev` runs the full local development stack.
- `make build` builds the workspace.
- `make lint` runs lint checks.
- `make test` runs the test suite.
- `make format` formats the workspace.

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

## Documentation

- [Event Schema](packages/contracts/contracts/linkora-contracts/EVENTS.md) — canonical event definitions for indexers and clients
- [Indexer Design](docs/indexer/INDEXER_DESIGN.md) — how to consume events off-chain to build a queryable social graph
- [UI Design Spec](docs/design/SPEC.md) — layout and component design tokens

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

## Security

Please review `SECURITY.md` for vulnerability disclosure guidance and scope.

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

## Deployment

A deployment script for Stellar Testnet is included at `scripts/deploy_testnet.sh`. It builds the contract WASM, deploys it to Testnet, and calls `initialize`.

### Required environment variables

| Variable | Description |
|---|---|
| `ADMIN_SECRET` | Secret key (`S...`) of the deployer / contract admin account |
| `TREASURY_ADDRESS` | Public address (`G...`) that receives protocol fees |
| `FEE_BPS` | Protocol fee in basis points (0–10 000). Defaults to `0`. |

### Usage

```bash
ADMIN_SECRET=S... \
TREASURY_ADDRESS=G... \
FEE_BPS=250 \
./scripts/deploy_testnet.sh
```

The script prints the deployed `contract_id` to stdout on success.

> **Note**: The account identified by `ADMIN_SECRET` must be funded on Testnet before running the script. Use [Stellar Testnet Friendbot](https://friendbot.stellar.org) to fund it.

## Current Limitations

This repository is a prototype and should not be treated as production-ready infrastructure yet.

- Pool withdrawal uses M-of-N admin authorization; more advanced governance may be needed for production.
- Contract storage layout has not been optimized for scale.
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

## 🤝 Contributing
Fork the repository and clone it to your local machine
Create a new branch for your changes
Make and test your updates following the project guidelines
Commit and push your changes to your fork
Open a Pull Request with a clear description

## Contributing Guide


How to Contribute 

• Fork the repository. 

• Clone your fork to your local machine. 

• Create a new branch for your task. 

git checkout -b feature/your-task-name 

• Make your changes. 

• Commit clearly. 

git commit -m "Add: short description" 

• Push your branch. 

git push origin feature/your-task-name 

• Open a Pull Request.
