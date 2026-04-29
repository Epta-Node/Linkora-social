# sdk

Typed TypeScript client for `LinkoraContract`, generated from the compiled contract WASM using `stellar contract bindings typescript`.

## Regenerating the client

Run this after every contract change:

```bash
# 1. Rebuild the contract
pnpm build:contracts

# 2. Regenerate the TypeScript client
bash packages/sdk/generate.sh
```

The generated files are written to `packages/sdk/src/`. Commit them so consumers don't need the Stellar CLI installed.

## Usage

Import the client in the frontend or any other workspace package:

```ts
import { Client } from "sdk";
```

## Prerequisites

- Stellar CLI: `cargo install --locked stellar-cli`
- Contract built: `pnpm build:contracts`
