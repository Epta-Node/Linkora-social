# Linkora

[![CI](https://github.com/ijayabby/Linkora-social/actions/workflows/ci.yml/badge.svg)](https://github.com/ijayabby/Linkora-social/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Telegram](https://img.shields.io/badge/Telegram-Join-blue?logo=telegram)](https://t.me/+13csp8G4ccRhY2Zk)

---

## What is Linkora?

Linkora is an open-source SocialFi platform built on Stellar and Soroban. It combines social networking with on-chain financial primitives — creator profiles, follow graphs, posts, token tipping, community pools, and a mini app ecosystem — for creators, communities, and investors. The protocol is governed on-chain and designed to give creators direct ownership of their audience and revenue.

---

## Status

| Package                     | State                                           |
| --------------------------- | ----------------------------------------------- |
| `packages/contracts`        | ✅ Core social + DeFi primitives, unit tested   |
| `packages/sdk`              | 🔧 In progress — typed contract client          |
| `apps/web`                  | 🔧 In progress — Next.js web frontend           |
| `apps/mobile`               | 🔧 In progress — Expo / React Native mobile app |
| `services/indexer`          | 🔧 In progress — off-chain event indexer        |
| `services/dm-relay`         | 🔧 In progress — E2EE direct-message relay      |
| `services/analytics-oracle` | 🔧 In progress — on-chain analytics oracle      |
| `examples/mini-apps`        | ✅ Example mini apps available                  |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Soroban Smart Contract  (packages/contracts)                   │
│  Profiles · Posts · Tips · Pools · Governance · Moderation      │
└───────────┬────────────────────────┬────────────────────────────┘
            │ contract calls (XDR)   │ events (Stellar RPC)
            ▼                        ▼
┌──────────────────────┐   ┌─────────────────────────────────────┐
│  SDK (packages/sdk)  │   │  Indexer (services/indexer)         │
│  LinkoraClient       │   │  PostgreSQL · full-text search API  │
│  TransactionQueue    │   └─────────────────────────────────────┘
└──────────┬───────────┘                   │  REST / WebSocket
           │                               ▼
           │              ┌────────────────────────────────────┐
           └─────────────►│  Web (apps/web) · Mobile (apps/mobile) │
                          │  Next.js 15 · Expo / React Native  │
                          └────────────────────────────────────┘
```

---

## Quick Start

```bash
# 1. Clone and run the setup script (checks prerequisites, installs deps, builds contracts)
./scripts/setup.sh

# 2. Web frontend
cd apps/web && pnpm dev           # http://localhost:3000

# 3. Mobile app
cd apps/mobile && pnpm start      # press 'a' (Android) or 'i' (iOS)

# 4. Indexer
cd services/indexer
cp .env.example .env              # fill in DATABASE_URL and SOROBAN_RPC_URL
pnpm dev

# 5. Contract tests
pnpm --filter contracts test      # or: cd packages/contracts && cargo test
```

---

## Testing

```bash
# Contract unit tests
pnpm --filter contracts test

# Indexer database migrations (requires Docker + Compose v2)
# Spins up a throwaway PostgreSQL, applies all migrations forward, checks the
# schema against the committed snapshot, verifies idempotency on re-apply, and
# tears the database down. Runs in well under a minute.
bash tests/migrations/test-migrations.sh
```

See [`services/indexer/migrations/README.md`](./services/indexer/migrations/README.md)
for the migration authoring rules, reversibility policy, and how to refresh the
schema snapshot after an intentional change.

---

## Documentation

| Document                                                         | Description                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------- |
| [Contract API Reference](./docs/CONTRACT_API.md)                 | Full function reference, storage layout, and event schema |
| [System Architecture](./docs/ARCHITECTURE.md)                    | Component overview and data flows                         |
| [Design System](./docs/design/README.md)                         | UI/UX specifications and brand identity                   |
| [Mobile UI Spec](./docs/design/MOBILE_SPEC.md)                   | Screen inventory, components, tokens, accessibility       |
| [Mobile Developer Guide](./docs/mobile/DEVELOPER_GUIDE.md)       | Expo setup, simulators, EAS builds                        |
| [Indexer Design](./docs/indexer/INDEXER_DESIGN.md)               | Event indexing strategy and search API                    |
| [Indexer Migrations](./services/indexer/migrations/README.md)    | Migration rules, reversibility policy, and testing        |
| [Mini Apps Developer Guide](./docs/mini-apps/DEVELOPER_GUIDE.md) | Build and submit a Linkora mini app                       |
| [Mini Apps Bridge API](./docs/mini-apps/BRIDGE_API.md)           | Bridge method reference                                   |
| [Security Policy](./SECURITY.md)                                 | Vulnerability disclosure guidance                         |

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to set up your environment, branch conventions, and the PR process.

---

## License

[MIT](./LICENSE)
