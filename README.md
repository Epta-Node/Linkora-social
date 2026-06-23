# Linkora

[![CI](https://github.com/ijayabby/Linkora-social/actions/workflows/ci.yml/badge.svg)](https://github.com/ijayabby/Linkora-social/actions/workflows/ci.yml)

Linkora-socials is an early-stage open source SocialFi project built on Stellar with Soroban smart contracts. The current repository is focused on the protocol foundation: a Rust contract workspace that models creator profiles, follow relationships, social posts, token tipping, and community pools.

Linkora is an open-source SocialFi platform built on Stellar and Soroban. It combines social networking with on-chain financial primitives — creator profiles, follow graphs, posts, token tipping, community pools, and a mini app ecosystem — for creators, communities, and investors.

---

## Status

The project spans multiple packages at different stages of maturity:

| Package              | Status                                                                |
| -------------------- | --------------------------------------------------------------------- |
| `packages/contracts` | ✅ Implemented — core social + DeFi primitives, unit tested           |
| `packages/sdk`       | 🔧 In progress — typed contract client for browser and Node.js        |
| `apps/web`           | 🔧 In progress — Next.js web frontend                                 |
| `apps/mobile`        | 🔧 In progress — Expo / React Native mobile app                       |
| `services/indexer`   | 🔧 In progress — off-chain event indexer with PostgreSQL + search API |
| `examples/mini-apps` | ✅ Example mini apps available                                        |

---

## What Linkora Implements

### Smart Contracts (`packages/contracts`)

- Profile registration and updates
- Follow / unfollow relationships with block support
- On-chain post creation, deletion, and likes
- Tipping posts with SEP-41 compatible tokens (protocol fee applied)
- Community pool deposits and M-of-N admin withdrawals
- Block / unblock events

### Web App (`apps/web`)

- Next.js 15 frontend with Tailwind CSS
- Freighter wallet integration
- Onboarding flow (install → connect → fund → profile)
- Explore page with post search
- Input validation and sanitisation on all forms

### Mobile App (`apps/mobile`)

- Expo / React Native app with Expo Router file-based navigation
- Bottom tab navigation: Feed, Explore, Pools, Mini Apps, Profile
- Freighter and WalletConnect wallet support
- Mini app browser with sandboxed bridge API
- Deep link handling (`linkora://post/:id`, `linkora://pool/:id`, `linkora://profile/:address`)

### Indexer (`services/indexer`)

- Subscribes to Soroban contract events via Stellar RPC
- Indexes post content into PostgreSQL for full-text search
- Exposes a REST search API consumed by the web and mobile frontends

### SDK (`packages/sdk`)

- Typed `LinkoraClient` for browser and Node.js
- Methods aligned with the contract ABI (`getProfile`, `getPost`, `getFollowing`, etc.)

### Mini Apps (`examples/mini-apps`)

- Sandboxed web apps running inside the Linkora mobile client
- Bridge API: `wallet.getAddress`, `wallet.sign`, `wallet.signTransaction`, `profile.get`
- Example: Creator Token dashboard and tip flow

---

## Documentation

- **[System Architecture](./docs/ARCHITECTURE.md)** — Components, data flows, and technology choices
- **[Design System](./docs/design/README.md)** — UI/UX specifications and brand identity
- **[Mobile UI Spec](./docs/design/MOBILE_SPEC.md)** — Screen inventory, components, tokens, accessibility
- **[Mobile Developer Guide](./docs/mobile/DEVELOPER_GUIDE.md)** — Expo setup, simulators, EAS builds
- **[Indexer Design](./docs/indexer/INDEXER_DESIGN.md)** — Event indexing strategy and search API design
- **[Mini Apps Developer Guide](./docs/mini-apps/DEVELOPER_GUIDE.md)** — Build and submit a Linkora mini app
- **[Mini Apps Bridge API](./docs/mini-apps/BRIDGE_API.md)** — Bridge method reference with types and examples
- **[Event Schema](./packages/contracts/contracts/linkora-contracts/EVENTS.md)** — Contract event definitions for indexers and clients
- **[Security Policy](./SECURITY.md)** — Vulnerability disclosure guidance

---

## Documentation

- **[System Architecture](./docs/ARCHITECTURE.md)** — High-level overview of system components, data flows, and technology choices
- **[Design System](./docs/design/README.md)** — UI/UX specifications and brand identity
- **[Indexer Design](./docs/indexer/INDEXER_DESIGN.md)** — Event indexing strategy and API design

## Repository Structure

```text
.
├── Makefile
├── package.json
├── pnpm-workspace.yaml
└── turbo.json
```

---

## Tech Stack

| Layer           | Technology                                                  |
| --------------- | ----------------------------------------------------------- |
| Smart contracts | Rust, Soroban SDK, Stellar                                  |
| Web frontend    | Next.js 15, React 19, Tailwind CSS 4                        |
| Mobile          | Expo (React Native), Expo Router, EAS Build                 |
| Wallet (web)    | Stellar Freighter API                                       |
| Wallet (mobile) | Freighter, WalletConnect (via `@walletconnect/sign-client`) |
| Indexer         | Node.js, TypeScript, Express, PostgreSQL                    |
| SDK             | TypeScript, `@stellar/stellar-sdk`                          |
| Monorepo        | pnpm workspaces, Turborepo                                  |
| Build tooling   | Cargo workspace, `stellar-cli`                              |

### Data Models

- `Profile`: stores a user address, username, and creator token address
- `Post`: stores post id, author, content, total tips, timestamp, and like count
- `Pool`: stores a pool token address and tracked balance

### Contract API Reference

| Function                                                        | Purpose                                                                                                                                                                        | Required signer           | Inputs                                                                                                                                                                                                                                                                                                  | Returns             |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `initialize(admin, treasury, fee_bps)`                          | One-time contract setup. Panics if called more than once.                                                                                                                      | `admin`                   | `admin: Address` — contract administrator<br>`treasury: Address` — fee recipient<br>`fee_bps: u32` — protocol fee in basis points (0–10 000)                                                                                                                                                            | `()`                |
| `set_profile(user, username, creator_token)`                    | Register or update a creator profile.                                                                                                                                          | `user`                    | `user: Address` — account being registered<br>`username: String` — display name (3–32 alphanumeric or `_` characters)<br>`creator_token: Address` — SEP-41 token the creator has deployed (pass own address if none)                                                                                    | `()`                |
| `get_profile(user)`                                             | Fetch a profile by address.                                                                                                                                                    | None                      | `user: Address`                                                                                                                                                                                                                                                                                         | `Option<Profile>`   |
| `get_profile_count()`                                           | Return the total number of profiles ever created. This counter is never decremented — it tracks total unique registrations, not currently active profiles.                     | None                      | None                                                                                                                                                                                                                                                                                                    | `u64`               |
| `get_address_by_username(username)`                             | Resolve a username to the owner's address using the reverse index. Returns `None` if the username is not registered.                                                           | None                      | `username: String`                                                                                                                                                                                                                                                                                      | `Option<Address>`   |
| `set_tip_cooldown_window(cooldown_ledgers)`                     | Set the per-tipper-per-post tip cooldown in ledgers. Only callable by the contract admin.                                                                                      | contract `admin`          | `cooldown_ledgers: u32` — number of ledgers (must be > 0)                                                                                                                                                                                                                                               | `()`                |
| `get_tip_cooldown_window()`                                     | Return the current tip cooldown window in ledgers.                                                                                                                             | None                      | None                                                                                                                                                                                                                                                                                                    | `u32`               |
| `follow(follower, followee)`                                    | Record a follow relationship. Duplicate follows are ignored. Panics if `followee` has blocked `follower`.                                                                      | `follower`                | `follower: Address` — account initiating the follow<br>`followee: Address` — account being followed                                                                                                                                                                                                     | `()`                |
| `unfollow(follower, followee)`                                  | Remove a follow relationship. No-op if the relationship does not exist.                                                                                                        | `follower`                | `follower: Address` — account removing the follow<br>`followee: Address` — account being unfollowed                                                                                                                                                                                                     | `()`                |
| `get_following(user, offset, limit)`                            | Return a page of accounts followed by a user. `limit` is capped at 50; panics with "limit exceeded" if violated. Returns an empty vec when `offset` is beyond the list length. | None                      | `user: Address`<br>`offset: u32` — zero-based start index<br>`limit: u32` — page size (max 50)                                                                                                                                                                                                          | `Vec<Address>`      |
| `get_followers(user, offset, limit)`                            | Return a page of accounts that follow a user. `limit` is capped at 50; panics with "limit exceeded" if violated. Returns an empty vec when `offset` is beyond the list length. | None                      | `user: Address`<br>`offset: u32` — zero-based start index<br>`limit: u32` — page size (max 50)                                                                                                                                                                                                          | `Vec<Address>`      |
| `block_user(blocker, blocked)`                                  | Add an account to the caller's block list, preventing them from following.                                                                                                     | `blocker`                 | `blocker: Address` — account initiating the block<br>`blocked: Address` — account being blocked                                                                                                                                                                                                         | `()`                |
| `unblock_user(blocker, blocked)`                                | Remove an account from the caller's block list.                                                                                                                                | `blocker`                 | `blocker: Address` — account removing the block<br>`blocked: Address` — account being unblocked                                                                                                                                                                                                         | `()`                |
| `is_blocked(blocker, blocked)`                                  | Check whether `blocker` has blocked `blocked`.                                                                                                                                 | None                      | `blocker: Address`<br>`blocked: Address`                                                                                                                                                                                                                                                                | `bool`              |
| `create_post(author, content)`                                  | Publish a new on-chain post. Post IDs are assigned sequentially starting at 1.                                                                                                 | `author`                  | `author: Address` — post creator<br>`content: String` — post body (1–280 characters)                                                                                                                                                                                                                    | `u64` — new post ID |
| `get_post_count()`                                              | Return the total number of posts created so far. Returns `0` when no posts exist.                                                                                              | None                      | None                                                                                                                                                                                                                                                                                                    | `u64`               |
| `get_post(id)`                                                  | Fetch a post by ID.                                                                                                                                                            | None                      | `id: u64`                                                                                                                                                                                                                                                                                               | `Option<Post>`      |
| `delete_post(author, post_id)`                                  | Delete a post. Only the original author may delete their own post.                                                                                                             | `author`                  | `author: Address` — post owner<br>`post_id: u64` — ID of the post to delete                                                                                                                                                                                                                             | `()`                |
| `get_posts_by_author(author, offset, limit)`                    | Return a page of post IDs created by an author, in insertion order. `limit` is capped at 50; panics with "limit exceeded" if violated.                                         | None                      | `author: Address`<br>`offset: u32` — zero-based start index<br>`limit: u32` — page size (max 50)                                                                                                                                                                                                        | `Vec<u64>`          |
| `like_post(user, post_id)`                                      | Like a post. Duplicate likes from the same user are ignored.                                                                                                                   | `user`                    | `user: Address` — account liking the post<br>`post_id: u64` — target post                                                                                                                                                                                                                               | `()`                |
| `get_like_count(post_id)`                                       | Return the number of likes on a post.                                                                                                                                          | None                      | `post_id: u64`                                                                                                                                                                                                                                                                                          | `u64`               |
| `has_liked(user, post_id)`                                      | Check whether a user has liked a specific post.                                                                                                                                | None                      | `user: Address`<br>`post_id: u64`                                                                                                                                                                                                                                                                       | `bool`              |
| `tip(tipper, post_id, token, amount)`                           | Transfer SEP-41 tokens to a post's author, applying the protocol fee, and increment the post's `tip_total`.                                                                    | `tipper`                  | `tipper: Address` — sender<br>`post_id: u64` — target post<br>`token: Address` — SEP-41 token contract<br>`amount: i128` — token units to transfer (must be > 0)                                                                                                                                        | `()`                |
| `create_pool(admin, pool_id, token, initial_admins, threshold)` | Create a named community pool with an M-of-N admin set. Requires contract admin auth.                                                                                          | contract `admin`          | `admin: Address` — caller (must be contract admin)<br>`pool_id: Symbol` — unique pool identifier<br>`token: Address` — SEP-41 token for the pool<br>`initial_admins: Vec<Address>` — admin set<br>`threshold: u32` — minimum signatures required to withdraw (must be > 0 and ≤ `initial_admins.len()`) | `()`                |
| `pool_deposit(depositor, pool_id, token, amount)`               | Deposit tokens into a named community pool. `amount` must be greater than zero.                                                                                                | `depositor`               | `depositor: Address` — token sender<br>`pool_id: Symbol` — pool identifier<br>`token: Address` — SEP-41 token contract (must match pool token)<br>`amount: i128` — token units to deposit (must be > 0)                                                                                                 | `()`                |
| `pool_withdraw(signers, pool_id, amount, recipient)`            | Withdraw tokens from a community pool. Requires at least `threshold` valid admin signatures from the pool's admin set.                                                         | each address in `signers` | `signers: Vec<Address>` — admin addresses authorising the withdrawal<br>`pool_id: Symbol` — pool identifier<br>`amount: i128` — token units to withdraw (must be > 0 and ≤ pool balance)<br>`recipient: Address` — token receiver                                                                       | `()`                |
| `get_pool(pool_id)`                                             | Fetch the current state of a pool.                                                                                                                                             | None                      | `pool_id: Symbol`                                                                                                                                                                                                                                                                                       | `Option<Pool>`      |
| `get_pool_admins(pool_id)`                                      | Return the current admin list for a pool.                                                                                                                                      | None                      | `pool_id: Symbol`                                                                                                                                                                                                                                                                                       | `Vec<Address>`      |
| `add_pool_admin(signers, pool_id, new_admin)`                   | Add a new admin to a pool. Requires threshold signatures from existing admins.                                                                                                 | each address in `signers` | `signers: Vec<Address>` — admin addresses authorising the addition<br>`pool_id: Symbol` — pool identifier<br>`new_admin: Address` — admin to add                                                                                                                                                        | `()`                |
| `remove_pool_admin(signers, pool_id, admin)`                    | Remove an admin from a pool. Requires threshold signatures from existing admins.                                                                                               | each address in `signers` | `signers: Vec<Address>` — admin addresses authorising the removal<br>`pool_id: Symbol` — pool identifier<br>`admin: Address` — admin to remove                                                                                                                                                          | `()`                |
| `update_pool_threshold(signers, pool_id, threshold)`            | Update the signature threshold for a pool. Requires threshold signatures from existing admins.                                                                                 | each address in `signers` | `signers: Vec<Address>` — admin addresses authorising the update<br>`pool_id: Symbol` — pool identifier<br>`threshold: u32` — new threshold (must be > 0 and ≤ admin count)                                                                                                                             | `()`                |
| `set_fee(fee_bps)`                                              | Update the protocol fee. Only callable by the contract admin.                                                                                                                  | contract `admin`          | `fee_bps: u32` — new fee in basis points (0–10 000)                                                                                                                                                                                                                                                     | `()`                |
| `set_treasury(treasury)`                                        | Update the treasury address that receives protocol fees. Only callable by the contract admin.                                                                                  | contract `admin`          | `treasury: Address` — new fee recipient                                                                                                                                                                                                                                                                 | `()`                |
| `get_fee_bps()`                                                 | Return the current protocol fee in basis points.                                                                                                                               | None                      | None                                                                                                                                                                                                                                                                                                    | `u32`               |
| `get_treasury()`                                                | Return the current treasury address.                                                                                                                                           | None                      | None                                                                                                                                                                                                                                                                                                    | `Option<Address>`   |
| `upgrade(new_wasm_hash)`                                        | Upgrade the contract WASM. Only callable by the contract admin.                                                                                                                | contract `admin`          | `new_wasm_hash: BytesN<32>` — hash of the new WASM blob                                                                                                                                                                                                                                                 | `()`                |

## Storage Layout

Linkora-socials uses Soroban's state storage to manage its data. All persistent storage keys are typed variants of the `StorageKey` enum defined with `#[contracttype]`, which provides compile-time key consistency and eliminates raw `Symbol` tuple keys.

### Storage Namespaces

- **Instance Storage**: Used for contract-wide configuration and small, frequently updated counters (e.g., admin address, post counter).
- **Persistent Storage**: Used for all user-generated data like profiles, posts, and social relationships. This data is subject to TTL extensions to remain on-chain.

### StorageKey Enum

```rust
#[contracttype]
pub enum StorageKey {
    Post(u64),              // persistent: post_id -> Post
    Profile(Address),       // persistent: user -> Profile
    Following(Address),     // persistent: user -> Vec<Address> they follow
    Followers(Address),     // persistent: user -> Vec<Address> following them
    Pool(Symbol),           // persistent: pool_id -> Pool
    Like(u64, Address),     // persistent: (post_id, user) -> bool
    AuthorPosts(Address),   // persistent: author -> Vec<u64> of post IDs
    Blocks(Address),        // persistent: blocker -> Map<Address, ()>
    UsernameIndex(String),  // persistent: username -> owner Address
    TipCooldown(u64, Address), // temporary: (post_id, tipper) -> last-tip ledger
}
```

### Key Mapping

| Key           | StorageKey variant                      | Namespace  | Purpose                                                                                                                                 |
| ------------- | --------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Profile       | `StorageKey::Profile(Address)`          | Persistent | Stores user `Profile` data keyed by the owner's address.                                                                                |
| UsernameIndex | `StorageKey::UsernameIndex(String)`     | Persistent | Reverse index — maps each username to its owner `Address`, enforcing uniqueness.                                                        |
| Following     | `StorageKey::Following(Address)`        | Persistent | Stores a `Vec<Address>` of accounts that the given address follows.                                                                     |
| Followers     | `StorageKey::Followers(Address)`        | Persistent | Stores a `Vec<Address>` of accounts following the given address.                                                                        |
| Blocks        | `StorageKey::Blocks(Address)`           | Persistent | Stores a `Map<Address, ()>` of accounts blocked by the given address.                                                                   |
| Post          | `StorageKey::Post(u64)`                 | Persistent | Stores individual `Post` objects by their incremental ID.                                                                               |
| Like          | `StorageKey::Like(u64, Address)`        | Persistent | Records whether a specific user has liked a specific post.                                                                              |
| AuthorPosts   | `StorageKey::AuthorPosts(Address)`      | Persistent | Stores a `Vec<u64>` of post IDs created by the given author.                                                                            |
| Pool          | `StorageKey::Pool(Symbol)`              | Persistent | Stores `Pool` data for named community pools.                                                                                           |
| TipCooldown   | `StorageKey::TipCooldown(u64, Address)` | Temporary  | Records the last-tip ledger sequence for `(post_id, tipper)`, enforcing the per-tipper-per-post cooldown window. Expires automatically. |
| `PROF_CT`     | `Symbol("PROF_CT")`                     | Instance   | Tracks the **total** profiles ever created (never decremented). See `get_profile_count`.                                                |
| `POST_CT`     | `Symbol("POST_CT")`                     | Instance   | Tracks the total posts ever created (used for ID generation, never decremented).                                                        |
| `ADMIN`       | `Symbol("ADMIN")`                       | Instance   | Stores the contract administrator's address.                                                                                            |
| `TREASURY`    | `Symbol("TREASURY")`                    | Instance   | Stores the treasury address that receives protocol fees.                                                                                |
| `FEE_BPS`     | `Symbol("FEE_BPS")`                     | Instance   | Stores the protocol fee in basis points (0–10 000).                                                                                     |
| `TIP_CD_W`    | `Symbol("TIP_CD_W")`                    | Instance   | Configurable tip cooldown window in ledgers (default ≈ 1 day).                                                                          |
| `INIT`        | `Symbol("INIT")`                        | Instance   | Boolean flag indicating if the contract has been initialized.                                                                           |

> [!NOTE]
> This storage layout is designed for the prototype phase and has not been optimized for large-scale data or minimal footprint.

## Prerequisites

Install the following before working on the project:

- **Node.js** 18+
- **pnpm** 9+ — `npm install -g pnpm`
- **Rust toolchain** — `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
- **Wasm target** — `rustup target add wasm32-unknown-unknown`
- **Stellar CLI** — `cargo install --locked stellar-cli`
- **PostgreSQL** 14+ (for the indexer)
- **Expo CLI** (for mobile) — `npm install -g expo-cli`

---

## Getting Started

### One-command setup

```bash
./scripts/setup.sh
```

The script checks prerequisites, installs JS dependencies, and builds the contracts. It is idempotent — safe to re-run after pulling changes.

### Manual setup

### One-command setup

The fastest way to get started is the setup script. It checks all prerequisites, installs JS dependencies, and builds the contracts:

```bash
./scripts/setup.sh
```

The script is idempotent — safe to run again after pulling new changes. It will print clear error messages for any missing tools and a next-steps summary on success.

### Manual setup

### 1. Install JavaScript Workspace Dependencies

```bash
pnpm install
```

#### 2. Build the contracts

```bash
pnpm build:contracts
```

#### 3. Run contract tests

```bash
pnpm --filter contracts test
# or
cd packages/contracts && cargo test
```

#### 4. Start the web frontend

```bash
cd apps/web
pnpm dev
# Opens http://localhost:3000
```

#### 5. Start the mobile app

```bash
cd apps/mobile
pnpm start
# Then press 'a' for Android emulator or 'i' for iOS simulator
```

See [docs/mobile/DEVELOPER_GUIDE.md](./docs/mobile/DEVELOPER_GUIDE.md) for full simulator setup and EAS build instructions.

#### 6. Start the indexer

```bash
cd services/indexer
cp .env.example .env   # fill in DATABASE_URL and SOROBAN_RPC_URL
pnpm dev
```

See [docs/indexer/INDEXER_DESIGN.md](./docs/indexer/INDEXER_DESIGN.md) for PostgreSQL schema and environment variables.

---

## Available Scripts

From the repository root:

| Script                 | Description                            |
| ---------------------- | -------------------------------------- |
| `pnpm dev`             | Start all services in development mode |
| `pnpm build`           | Build all packages                     |
| `pnpm build:contracts` | Build Soroban contracts only           |
| `pnpm lint`            | Run lint across all packages           |
| `pnpm test`            | Run all test suites                    |
| `pnpm format`          | Format all source files                |

---

## Smart Contract API Reference

## Makefile Targets

The repository root also includes a `Makefile` with thin wrappers around the existing workspace scripts:

- `make dev` runs the full local development stack.
- `make build` builds the workspace.
- `make lint` runs lint checks.
- `make test` runs the test suite.
- `make format` formats the workspace.

## Testing

### Data Models

- `Profile` — address, username, creator token address
- `Post` — id, author, content, tip total, timestamp, like count
- `Pool` — token address, balance, admin set, threshold

### Key Functions

Sandbox-backed integration tests with real transaction signing are available under `tests/integration`.

Run them from repository root:

```bash
pnpm test:integration
```

See `tests/README.md` for setup details and CI guidance.

## Frontend Features

### Accessibility

All core flows (Feed, Profile, Pools, Explore) have undergone a comprehensive accessibility audit.

- Implemented `axe-core` and `jest-axe` for automated CI checks.
- Zero critical or serious accessibility violations.
- Key improvements include ARIA labeling, improved keyboard navigation, focus trapping, and semantic HTML structure.

### Playwright Testing

We use Playwright for end-to-end (E2E) testing of critical user flows. Tests are located in `packages/web/tests/e2e/`.

- **Feed Flow**: Wallet connection and post creation verification.
- **Profile Flow**: Profile navigation and user follow interactions.
- **Pool Flow**: Pool details and transaction mock flows.

Tests run automatically on PRs affecting the `packages/web` directory via the `.github/workflows/frontend-e2e.yml` GitHub action. To run tests locally:

```bash
cd packages/web
pnpm test:e2e
```

### SDK Client Usage

The `packages/sdk` module provides a fully typed `LinkoraClient` for both browser and Node.js environments. It exposes strongly-typed methods aligned with the smart contract ABI (e.g. `getProfile`, `getPost`, `getFollowing`).

```typescript
import { LinkoraClient } from "sdk";

const client = new LinkoraClient({
  contractId: process.env.NEXT_PUBLIC_CONTRACT_ID,
  rpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL,
});

const profile = await client.getProfile("GABC...");
```

### Transaction Notifications

A global context-driven notification system is available in `packages/web`. It handles transaction states seamlessly with:

- Pending status with spinners.
- Success and Error states with auto-dismiss after 4 seconds.
- Integrated Stellar Expert transaction links.
- Full ARIA live region support for accessibility.

## Documentation

- [Event Schema](packages/contracts/contracts/linkora-contracts/EVENTS.md) — canonical event definitions for indexers and clients
- [Indexer Design](docs/indexer/INDEXER_DESIGN.md) — how to consume events off-chain to build a queryable social graph
- [UI Design Spec](docs/design/SPEC.md) — layout and component design tokens

## Contributor Guide

Full API table in the [Contract API Reference](#) section of the upstream README.

---

## Deployment

Deploy to Stellar Testnet:

## Security

Please review `SECURITY.md` for vulnerability disclosure guidance and scope.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to [conduct@linkora.social](mailto:conduct@linkora.social).

## Troubleshooting

### Common Setup Issues

- **`pnpm` command not found**: Install pnpm globally using `npm install -g pnpm`. Linkora uses pnpm workspaces for managing multiple packages.
- **`stellar` command not found**: Install the Stellar CLI with `cargo install --locked stellar-cli`. Ensure `~/.cargo/bin` is in your system PATH.
- **`cargo test` failing**: Make sure you are running it from inside `packages/contracts`. If you are at the repository root, use `pnpm test` instead.
- **Outdated dependencies**: Always run `pnpm install` from the root directory after pulling new changes to ensure your `node_modules` and Turborepo cache are synchronized.
- **Rust build errors**: Ensure the Wasm target is installed: `rustup target add wasm32-unknown-unknown`.

### Command Reference

| Task                     | Root Directory         | `packages/contracts` |
| ------------------------ | ---------------------- | -------------------- |
| **Install dependencies** | `pnpm install`         | -                    |
| **Build Contracts**      | `pnpm build:contracts` | `pnpm build`         |
| **Run Tests**            | `pnpm test`            | `cargo test`         |

## Deployment

A deployment script for Stellar Testnet is included at `scripts/deploy_testnet.sh`. It builds the contract WASM, deploys it to Testnet, and calls `initialize`.

### Required environment variables

| Variable           | Description                                                  |
| ------------------ | ------------------------------------------------------------ |
| `ADMIN_SECRET`     | Secret key (`S...`) of the deployer / contract admin account |
| `TREASURY_ADDRESS` | Public address (`G...`) that receives protocol fees          |
| `FEE_BPS`          | Protocol fee in basis points (0–10 000). Defaults to `0`.    |

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

> Fund the deployer account first: [Stellar Testnet Friendbot](https://friendbot.stellar.org)

- Pool withdrawal uses M-of-N admin authorization; more advanced governance may be needed for production.
- Contract storage layout has not been optimized for scale.
- No deployment scripts, frontend client, or backend service are included yet.
- Security review and audit work remain outstanding.

## Roadmap

1. **Contract hardening** — security review, edge-case coverage, upgrade path
2. **SDK completion** — full typed client aligned with contract ABI
3. **Indexer production-readiness** — pagination, rate limiting, event replay
4. **Mobile feature parity** — Pools screen, Post detail, Profile detail, compose flow
5. **Web feature parity** — Feed, profile pages, tip modal, compose modal
6. **Mini app registry** — on-chain or off-chain registry for third-party mini apps
7. **Mainnet deployment** — governance, treasury, and fee configuration

---

## Contributing

Contributions are welcome in all areas:

- Contract hardening and security review
- Event design and indexing strategy
- Mobile and web feature implementation
- SDK client improvements
- Documentation and developer tooling

### How to contribute

1. Fork the repository and clone it locally
2. Create a branch: `git checkout -b feature/your-task-name`
3. Make your changes and commit clearly: `git commit -m "feat: short description"`
4. Push and open a Pull Request with a clear description

### Community

Join the Linkora community on Telegram: [https://t.me/+13csp8G4ccRhY2Zk](https://t.me/+13csp8G4ccRhY2Zk)

---

## Testing

| Suite                 | Command                            |
| --------------------- | ---------------------------------- |
| Contract unit tests   | `pnpm --filter contracts test`     |
| SDK tests             | `pnpm --filter sdk test`           |
| Indexer tests         | `cd services/indexer && pnpm test` |
| Mobile snapshot tests | `cd apps/mobile && pnpm test`      |
| Web E2E (Playwright)  | `cd apps/web && pnpm test:e2e`     |
| Integration tests     | `pnpm test:integration`            |

---

## Security

See [SECURITY.md](./SECURITY.md) for vulnerability disclosure guidance and scope.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). Report unacceptable behavior to [conduct@linkora.social](mailto:conduct@linkora.social).

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

 
 
