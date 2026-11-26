# Linkora Monorepo Developer Guide

This document outlines the architecture, package organization, dependency management, and common commands for working in the Linkora monorepo managed with [pnpm workspaces](https://pnpm.io/workspaces).

---

## 1. Workspace Structure

The monorepo uses `pnpm-workspace.yaml` to define package boundaries across three top-level directories:

```yaml
packages:
  - "packages/*"
  - "apps/*"
  - "services/*"
```

### Directory Overview

| Directory                   | Scope                       | Language / Framework               | Description                                                                              |
| --------------------------- | --------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `apps/web`                  | `@linkora/web`              | Next.js 15, React, Tailwind CSS    | The primary web application for desktop and mobile browsers.                             |
| `apps/mobile`               | `@linkora/mobile`           | Expo, React Native                 | Cross-platform mobile app for iOS and Android.                                           |
| `packages/contracts`        | `contracts`                 | Rust, Soroban SDK                  | Soroban smart contracts (`linkora-contracts`, `token-factory`, `linkora-vesting`, etc.). |
| `packages/sdk`              | `@linkora/sdk`              | TypeScript, `@stellar/stellar-sdk` | Client SDK providing typed access, transaction queuing, and simulation.                  |
| `packages/types`            | `@linkora/types`            | TypeScript                         | Shared type definitions across contracts, indexer, web, and mobile.                      |
| `services/indexer`          | `@linkora/indexer`          | Node.js, Express, PostgreSQL       | Off-chain event indexing service with search, REST API, and WebSocket streaming.         |
| `services/dm-relay`         | `@linkora/dm-relay`         | Node.js, WebSocket                 | E2EE direct-messaging relay for private user chats.                                      |
| `services/analytics-oracle` | `@linkora/analytics-oracle` | Node.js, TypeScript                | On-chain oracle publishing attested platform metrics.                                    |

---

## 2. Dependency Management & Shared Packages

### Internal Workspace References

Internal packages depend on each other using the `workspace:*` protocol in `package.json`. For example, in `services/indexer/package.json`:

```json
{
  "dependencies": {
    "@linkora/types": "workspace:*"
  }
}
```

When pnpm installs or builds, it symlinks the internal package directly from the workspace instead of fetching from an external registry.

### Dependency Rules

1. **Shared Types**: Put shared domain models and schemas into `packages/types`. Do not duplicate TypeScript interfaces across `apps/` and `services/`.
2. **Deterministic Locking**: Always use `pnpm install` at the workspace root to update `pnpm-lock.yaml`. Never use `npm` or `yarn`.
3. **Rust Contracts Isolation**: Smart contracts in `packages/contracts` use Cargo workspaces (`Cargo.toml`), independent of Node.js dependencies.

---

## 3. Common pnpm Commands & Filters

The `--filter` (or `-F`) flag allows targeting specific packages or applications from anywhere in the repository.

### Running Commands by Package

```bash
# Build the web application
pnpm --filter @linkora/web build

# Run unit tests in the indexer
pnpm --filter @linkora/indexer test

# Run type checking across the SDK
pnpm --filter @linkora/sdk typecheck

# Start development server for mobile
pnpm --filter @linkora/mobile start

# Run contract tests
pnpm --filter contracts test
```

### Filter Patterns

- `--filter <package-name>`: Targets exact package name from `package.json`.
- `--filter ...<package-name>`: Targets package and all its dependencies.
- `--filter <package-name>...`: Targets package and all packages that depend on it.
- `--filter "./apps/*"`: Targets all packages in `apps/`.
- `--filter "./services/*"`: Targets all packages in `services/`.

### Root Scripts

From the repository root:

```bash
# Install all dependencies across all packages
pnpm install

# Run linting across the monorepo
pnpm lint

# Format code with Prettier
pnpm format
```

---

## 4. How to Add a New Workspace Package

To create a new workspace package (e.g., `packages/ui-components` or `services/notifications`):

1. **Create the Directory**:

   ```bash
   mkdir -p packages/new-package
   ```

2. **Initialize `package.json`**:
   Create `packages/new-package/package.json` with a scoped name:

   ```json
   {
     "name": "@linkora/new-package",
     "version": "0.1.0",
     "private": true,
     "main": "dist/index.js",
     "scripts": {
       "build": "tsc",
       "test": "jest"
     }
   }
   ```

3. **Add Workspace Dependencies**:
   To use `@linkora/types` or other packages:

   ```bash
   pnpm --filter @linkora/new-package add @linkora/types@workspace:*
   ```

4. **Install & Link**:
   Run `pnpm install` at the root. pnpm will automatically detect the new package from `pnpm-workspace.yaml` and wire symlinks.

5. **Consume in Other Packages**:
   In `apps/web/package.json`:
   ```bash
   pnpm --filter @linkora/web add @linkora/new-package@workspace:*
   ```
