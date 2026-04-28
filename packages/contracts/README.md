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
├── Cargo.toml
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
