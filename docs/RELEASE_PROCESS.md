# Linkora Release Process

This document describes how releases are cut for the Linkora monorepo, covering
versioning strategy, changelog generation, and the step-by-step checklist for
shipping contracts, the SDK, and the web/mobile apps.

---

## Table of Contents

1. [Repository Layout](#1-repository-layout)
2. [Semantic Versioning Strategy](#2-semantic-versioning-strategy)
3. [Contract Versioning](#3-contract-versioning)
4. [Conventional Commits & Changelog Generation](#4-conventional-commits--changelog-generation)
5. [Cutting a Release](#5-cutting-a-release)
6. [Release Checklist](#6-release-checklist)
7. [npm Publish Workflow (`linkora-sdk`)](#7-npm-publish-workflow-linkora-sdk)
8. [Hotfix Releases](#8-hotfix-releases)
9. [Tooling Reference](#9-tooling-reference)

---

## 1. Repository Layout

```
Linkora-social/
├── apps/
│   ├── web/          # Next.js web frontend
│   └── mobile/       # React Native mobile app
├── packages/
│   ├── contracts/    # Soroban smart contracts (Rust / Cargo workspace)
│   ├── sdk/          # linkora-sdk — TypeScript client published to npm
│   ├── codegen/      # @linkora/codegen — code-generation tooling
│   └── types/        # @linkora/types — shared TypeScript types
├── services/
│   ├── indexer/      # Off-chain Soroban event indexer
│   ├── dm-relay/     # E2EE direct-message relay
│   └── analytics-oracle/
├── scripts/
│   └── release.sh    # Automated version-bump & tag script
└── CHANGELOG.md
```

Each layer has its own release cadence and versioning rules (see §2).

---

## 2. Semantic Versioning Strategy

All packages in this monorepo follow **Semantic Versioning 2.0.0** (`MAJOR.MINOR.PATCH`).

| Component | Package / Path | npm name | Independent? |
|---|---|---|---|
| Smart contracts | `packages/contracts/` | _(not published)_ | ✅ independent |
| SDK | `packages/sdk/` | `linkora-sdk` | ✅ independent |
| codegen | `packages/codegen/` | `@linkora/codegen` | ✅ independent |
| types | `packages/types/` | `@linkora/types` | tied to SDK minor |
| Web app | `apps/web/` | _(deployed)_ | tied to monorepo |
| Mobile app | `apps/mobile/` | _(deployed)_ | tied to monorepo |
| Services | `services/*/` | _(deployed)_ | tied to monorepo |

### Bump rules

| Change type | Contracts | SDK | Apps / Services |
|---|---|---|---|
| Breaking on-chain API change | `MAJOR` | `MAJOR` | `MAJOR` |
| New feature / new contract entrypoint | `MINOR` | `MINOR` | `MINOR` |
| Bug fix, gas optimisation, internal refactor | `PATCH` | `PATCH` | `PATCH` |
| Docs-only, CI, tooling | no bump | no bump | no bump |

> **Rule of thumb:** if consuming code must change to stay compatible, it is a
> `MAJOR`/breaking bump. If consuming code _can_ stay as-is but gains new
> capability, it is a `MINOR` bump.

### Root `package.json` version

The root `package.json` version tracks the **monorepo umbrella release** (used
by `scripts/release.sh` and git tags). It should stay in sync with the highest
version among contracts + SDK unless an independent release is performed.

---

## 3. Contract Versioning

Soroban contracts have special constraints that do not apply to ordinary npm
packages.

### 3.1 Immutability vs. upgradeability

| Deployment pattern | When to use |
|---|---|
| **Immutable** (default) — contract is deployed once; `contract_id` is permanent | Testnet, and production contracts that intentionally opt out of upgrades |
| **Upgradeable** — the contract stores its own WASM hash and an admin key may call `upgrade(new_wasm_hash)` | Production contracts that need bug-fix upgrades without migrating user state |

Linkora currently uses the **immutable** pattern for production. A new
`MAJOR` version therefore means a **new deployment** with a new
`contract_id`, not an in-place upgrade.

### 3.2 Contract version fields

The authoritative contract version lives in:

```
packages/contracts/contracts/linkora-contracts/Cargo.toml
```

```toml
[package]
name = "linkora-contracts"
version = "0.1.0"   # <-- bump this
```

`scripts/release.sh` reads and writes this field automatically.

### 3.3 Deployed contract IDs

Every production and testnet deployment must be recorded in
[`docs/deployment.md`](deployment.md). After a new contract deployment, update
the table there with:

- Network (testnet / mainnet)
- Contract ID (`C…` address)
- Deployed ledger sequence
- WASM hash
- Release tag (e.g. `contracts-v0.2.0`)

### 3.4 Contract-only releases

If only the contracts change (no SDK surface change), create a contract-scoped
tag:

```
contracts-vMAJOR.MINOR.PATCH
```

If the SDK must be updated to match, cut a full monorepo release.

---

## 4. Conventional Commits & Changelog Generation

Linkora uses [Conventional Commits](https://www.conventionalcommits.org/) to
produce machine-readable commit history that maps directly to `CHANGELOG.md`
entries.

### 4.1 Commit format

```
<type>(<scope>): <short summary>

[optional body]

[optional footer(s)]
```

| Type | Changelog section | Version bump |
|---|---|---|
| `feat` | **Added** | `MINOR` |
| `fix` | **Fixed** | `PATCH` |
| `perf` | **Changed** | `PATCH` |
| `refactor` | **Changed** | `PATCH` |
| `docs` | — (no entry) | none |
| `chore` | — (no entry) | none |
| `test` | — (no entry) | none |
| `build` | — (no entry) | none |
| `ci` | — (no entry) | none |
| `BREAKING CHANGE` footer | **Breaking Changes** | `MAJOR` |

**Scopes in use:**

| Scope | Area |
|---|---|
| `contracts` | Soroban smart contracts |
| `sdk` | `packages/sdk` |
| `web` | `apps/web` |
| `mobile` | `apps/mobile` |
| `indexer` | `services/indexer` |
| `dm-relay` | `services/dm-relay` |
| `oracle` | `services/analytics-oracle` |
| `codegen` | `packages/codegen` |
| `docs` | Documentation |
| `ci` | GitHub Actions / tooling |

**Examples:**

```
feat(sdk): add batch-transaction builder
fix(contracts): guard overflow in tip distribution
feat(contracts)!: replace profile storage layout

BREAKING CHANGE: existing profile entries are incompatible with the new schema.
Run the migration script before deploying.
```

### 4.2 Generating CHANGELOG.md

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/) format.
`scripts/release.sh` inserts a new version block automatically; you then
populate the subsections from your commit log.

To view commits since the last tag:

```bash
# All commits since the last release tag
git log $(git describe --tags --abbrev=0)..HEAD --oneline

# Filter by type
git log $(git describe --tags --abbrev=0)..HEAD --oneline --grep="^feat\|^fix\|^perf"
```

To generate a draft changelog with [`git-cliff`](https://git-cliff.org/)
(optional, install separately):

```bash
git-cliff --unreleased --prepend CHANGELOG.md
```

---

## 5. Cutting a Release

### 5.1 Prerequisites

- You are on the `main` branch with a clean working tree.
- All CI checks are green.
- PR for the release has been reviewed and merged.

### 5.2 Create a release branch

```bash
git checkout main
git pull origin main
git checkout -b release/vX.Y.Z
```

### 5.3 Run the release script

```bash
bash scripts/release.sh
```

The script will:

1. Validate the working tree is clean.
2. Display current versions (root `package.json` + `Cargo.toml`).
3. Prompt for the new version (semver format `X.Y.Z`).
4. Validate the new version is greater than the current one and that the tag
   does not already exist.
5. Write the new version to:
   - `packages/contracts/contracts/linkora-contracts/Cargo.toml`
   - Root `package.json`
6. Insert a new `## [X.Y.Z] - YYYY-MM-DD` block in `CHANGELOG.md`.
7. Create a signed git commit and annotated tag `vX.Y.Z`.

### 5.4 Edit CHANGELOG.md

Open `CHANGELOG.md` and populate the empty bullet points under **Added**,
**Changed**, and **Fixed** using the commit list from §4.2.

### 5.5 Push and open a PR

```bash
git push origin release/vX.Y.Z
```

Open a pull request from `release/vX.Y.Z` → `main` titled
`chore: release vX.Y.Z`. The PR description should link to the CHANGELOG entry.

### 5.6 Merge and push tags

After approval:

```bash
git checkout main
git merge --no-ff release/vX.Y.Z
git push origin main
git push origin --tags   # pushes vX.Y.Z
```

### 5.7 Create a GitHub Release

1. Go to **Releases → Draft a new release**.
2. Select tag `vX.Y.Z`.
3. Set the title to `vX.Y.Z`.
4. Paste the relevant CHANGELOG section as the release body.
5. Attach any compiled WASM artefacts if applicable.
6. Publish the release.

---

## 6. Release Checklist

Work through every item **in order** before marking a release complete.

### Pre-release

- [ ] All feature PRs merged and linked issues closed
- [ ] `main` CI pipeline green (lint, typecheck, test, build)
- [ ] `pnpm codegen:check` passes (generated SDK files are up to date)
- [ ] Contract integration tests pass: `pnpm test:integration`
- [ ] Bundle size budget unchanged: `pnpm check:bundle`
- [ ] `CHANGELOG.md` populated with accurate entries
- [ ] `docs/deployment.md` updated if new contracts are being deployed

### Contracts

- [ ] Soroban WASM compiled for release profile:
  ```bash
  cd packages/contracts && cargo build --release --target wasm32-unknown-unknown
  ```
- [ ] Contract deployed to **testnet** and smoke-tested
- [ ] New `contract_id` and ledger recorded in `docs/deployment.md`
- [ ] If mainnet deploy: multi-sig / admin key ceremony completed
- [ ] New `contract_id` updated in all affected environment configs

### SDK

- [ ] SDK built: `pnpm --filter linkora-sdk build`
- [ ] SDK unit and e2e tests pass:
  ```bash
  pnpm --filter linkora-sdk test
  pnpm --filter linkora-sdk test:e2e
  ```
- [ ] `package.json` version bumped (handled by `scripts/release.sh`)
- [ ] npm publish dry-run passes: `npm publish --dry-run` (see §7)
- [ ] Published to npm: `npm publish --access public`

### Apps & Services

- [ ] Web app deployed to staging and smoke-tested
- [ ] Mobile app build passes (Expo / EAS)
- [ ] `services/indexer` deployed, pointing to new contract ID
- [ ] `services/dm-relay` deployed
- [ ] `services/analytics-oracle` deployed
- [ ] Health-check endpoints return 200 for all services (see `docs/deployment.md §6`)

### Post-release

- [ ] Git tag `vX.Y.Z` pushed to origin
- [ ] GitHub Release published
- [ ] Release announcement posted (Discord / social)
- [ ] Monitoring dashboards checked for anomalies 30 min after deploy

---

## 7. npm Publish Workflow (`linkora-sdk`)

The SDK is published under the package name `linkora-sdk`.

### 7.1 One-time setup

```bash
npm login          # authenticate with your npm account
# Ensure you have publish rights to the linkora-sdk package
npm access list packages
```

### 7.2 Build and verify

```bash
cd packages/sdk

# Build both CJS and ESM outputs
pnpm build

# Run the full test suite
pnpm test
pnpm test:e2e

# Inspect the files that will be published
npm pack --dry-run
```

The tarball should include only `dist/` and `README.md` (controlled by the
`"files"` field in `package.json`).

### 7.3 Publish

```bash
# Dry run first (strongly recommended)
npm publish --dry-run

# Publish to the public npm registry
npm publish --access public
```

> **Note:** `peerDependencies` (`@ledgerhq/hw-*`) are optional and not required
> for publish. Consumers opt in to Ledger support by installing those packages.

### 7.4 Verify the published package

```bash
npm view linkora-sdk
npm view linkora-sdk versions --json
```

### 7.5 Deprecating old versions

If a release contains a critical bug, deprecate before shipping a patch:

```bash
npm deprecate linkora-sdk@"<= X.Y.Z" "Critical bug — upgrade to X.Y.(Z+1)"
```

---

## 8. Hotfix Releases

For urgent fixes that cannot wait for the next planned release:

```bash
# Branch from the latest release tag, not main
git checkout vX.Y.Z
git checkout -b hotfix/vX.Y.(Z+1)

# Apply the minimal fix
# ... edit files ...

git add -A
git commit -m "fix(<scope>): <description>"

# Run the release script (it will prompt for X.Y.(Z+1))
bash scripts/release.sh

git push origin hotfix/vX.Y.(Z+1) --tags
```

Open a PR back to **both** `main` and the hotfix branch. After merging to
`main`, ensure `main` is tagged as well if it has diverged.

---

## 9. Tooling Reference

| Tool | Purpose | Install |
|---|---|---|
| `scripts/release.sh` | Version bump, CHANGELOG scaffold, git tag | in repo |
| `pnpm` | Monorepo package manager | `npm i -g pnpm` |
| `turbo` | Monorepo task runner | in repo devDependencies |
| `git-cliff` | Automated CHANGELOG generation from conventional commits | `cargo install git-cliff` |
| `cargo` | Rust / Soroban contract build | via rustup |
| `stellar-cli` | Contract deployment & invocation | [docs.stellar.org](https://developers.stellar.org/docs/tools/developer-tools/cli/install-stellar-cli) |

### Useful one-liners

```bash
# Show all release tags
git tag -l 'v*' | sort -V

# Show commits between two tags
git log v0.1.0..v0.2.0 --oneline

# Check the current root version
node -p "require('./package.json').version"

# Check SDK version
node -p "require('./packages/sdk/package.json').version"
```
