# Linkora Contracts

## Project Structure

```text
.
├── contracts
│   └── linkora-contracts
│       ├── src
│       │   ├── lib.rs
│       │   └── test.rs
│       ├── Cargo.toml
│       └── EVENTS.md
├── src
│   └── index.ts      ← typed TypeScript client
├── Cargo.toml
├── package.json
└── README.md
```

The `linkora-contracts` package is the core Soroban smart contract for the Linkora social protocol, located at `contracts/linkora-contracts`.

## Building

```bash
stellar contract build
```

Or via the Makefile inside the contract directory:

```bash
make build
```

## Running Tests

```bash
cargo test
```

## Events

See [`contracts/linkora-contracts/EVENTS.md`](./contracts/linkora-contracts/EVENTS.md) for the canonical event schema used by indexers and clients.

## Integration Tests

End-to-end integration tests live in [`tests/integration/`](../../tests/integration/).

## Generating TypeScript Bindings

After building the contract WASM, regenerate the typed TypeScript client with:

```bash
pnpm --filter contracts generate:bindings
```

This runs `stellar contract bindings typescript` against the compiled WASM and writes the output to `src/`.

The client is exported from `packages/contracts/src/index.ts` and can be imported by the web package:

```ts
import { LinkoraClient } from "contracts";

const client = new LinkoraClient({
  rpcUrl: "https://soroban-testnet.stellar.org",
  contractId: "C...",
  networkPassphrase: "Test SDF Network ; September 2015",
});

const profile = await client.getProfile("G...");
const following = await client.getFollowing("G...", 0, 20);
```
