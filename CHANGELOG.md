# Changelog

All notable changes to the Linkora monorepo are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> For the full release workflow — including how to cut a release, bump versions,
> and publish the SDK — see [`docs/RELEASE_PROCESS.md`](docs/RELEASE_PROCESS.md).

---

## [Unreleased]

### Added

- Docs: `docs/RELEASE_PROCESS.md` — full release workflow, versioning strategy,
  contract versioning guidance, and npm publish steps (#1721)
- Docs: `CHANGELOG.md` — initial changelog following Keep a Changelog format (#1721)

---

## [0.1.0] - 2026-10-19

### Added

- **Soroban smart contracts** (`packages/contracts`) — Linkora on-chain social
  graph: profile registration, follow/unfollow, post, tip, and governance modules
- **TypeScript SDK** (`packages/sdk`, `linkora-sdk@0.1.0`) — typed client for all
  Linkora contract entrypoints; ships dual CJS + ESM builds with full type
  declarations; Ledger hardware-wallet support via optional peer dependencies
- **Code generation** (`packages/codegen`) — automated generation of SDK bindings
  from compiled contract WASM; run via `pnpm codegen`
- **Web app** (`apps/web`) — Next.js social feed, profile pages, DM inbox,
  governance voting UI, and analytics dashboard
- **Mobile app** (`apps/mobile`) — React Native companion app with push
  notifications and Ledger wallet support
- **Off-chain services**:
  - `services/indexer` — Soroban event indexer with REST + WebSocket API,
    adaptive polling, Redis-backed rate limiting
  - `services/dm-relay` — transport-only E2EE direct-message relay; zero
    message persistence
  - `services/analytics-oracle` — Ed25519 attestation oracle for on-chain
    analytics scores
- **Deployment infrastructure** — Docker Compose and Kubernetes manifests;
  documented in `docs/deployment.md`
- **Testnet deployment** — initial contract deployed on Stellar Testnet;
  contract ID and ledger recorded in `docs/deployment.md`
- **Documentation**:
  - `docs/deployment.md` — production deployment guide for all services
  - `docs/CONTRACT_API.md` — full contract ABI reference
  - `docs/MIGRATION_AUTH_V1.md` — auth migration guide
  - `docs/adr/` — architectural decision records

### Changed

- N/A (initial release)

### Fixed

- N/A (initial release)

---

[Unreleased]: https://github.com/Epta-Node/Linkora-social/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Epta-Node/Linkora-social/releases/tag/v0.1.0
