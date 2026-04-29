# Web Package

This package bootstraps the Linkora web frontend using Next.js App Router and TypeScript.

## Prerequisites

- Node.js 18+
- pnpm 9+

## Install workspace dependencies

From repository root:

```bash
pnpm install
```

## Run the web app

From repository root:

```bash
pnpm --filter web dev
```

Or from this directory:

```bash
pnpm dev
```

## Build and lint

From repository root:

```bash
pnpm --filter web build
pnpm --filter web lint
```

## Environment Setup

Copy the example file and fill in your values:

```bash
cp .env.example .env.local
```

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | Soroban RPC endpoint (e.g. `https://soroban-testnet.stellar.org`) |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | Stellar network passphrase |
| `NEXT_PUBLIC_CONTRACT_ID` | Deployed Linkora contract ID |

The app will throw an error at startup if any of these variables are missing.

`.env.example` is pre-filled for Testnet. For local sandbox or Mainnet, update the values accordingly. Never commit `.env.local` or any `.env*.local` file.

## Notes

- This scaffold intentionally keeps the first page minimal.
- Contract code and existing contract workspace remain unchanged.
