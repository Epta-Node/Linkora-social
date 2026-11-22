# Troubleshooting

This guide covers the setup failures most often seen after running
`./scripts/setup.sh`. Run commands from the repository root unless noted.

## Rust toolchain or WASM target

**Symptoms:** `rustc` is missing, the compiler is too old, or a contract build
reports that `wasm32-unknown-unknown` is unavailable.

```bash
rustup update stable
rustup default stable
rustup target add wasm32-unknown-unknown
rustc --version
rustup target list --installed
```

If the repository pins a toolchain in `rust-toolchain.toml`, let `rustup`
install that version instead of forcing a different compiler. On CI, make sure
the Rust cache key includes the toolchain file.

## Soroban CLI problems

**Symptoms:** `stellar`/`soroban` is not found, the CLI rejects a command, or
the installed CLI cannot build the workspace.

```bash
stellar --version
which stellar                 # use `where stellar` on Windows
stellar contract build --package linkora-contracts
```

Install the CLI from the current Stellar documentation and ensure its `bin`
directory is on `PATH`. If a command was renamed between CLI releases, use the
equivalent command shown by `stellar --help`; do not mix an old CLI with a new
Soroban SDK lockfile. Re-run the build after `cargo clean` if stale WASM
artifacts are being picked up.

## pnpm workspace issues

**Symptoms:** `pnpm` is missing, a filter cannot be resolved, or packages use
different lockfile versions.

```bash
corepack enable
corepack prepare pnpm@9.15.9 --activate
pnpm --version
pnpm install --frozen-lockfile
pnpm -r list --depth 0
```

Run workspace commands from the root, for example:

```bash
pnpm --filter @linkora/indexer dev
pnpm --filter @linkora/indexer test
```

Do not run `npm install` in an individual workspace: it can create a second
lockfile and leave workspace links unresolved. If dependencies are corrupted,
remove only generated `node_modules` directories and repeat the frozen pnpm
install.

## PostgreSQL connection errors

**Symptoms:** `ECONNREFUSED`, authentication failures, or the indexer starts
but cannot apply migrations.

Start the local service and check the connection string:

```bash
docker compose up -d postgres-indexer
psql "$DATABASE_URL" -c 'select 1'
```

The indexer normally uses a URL such as:

```text
postgresql://linkora:linkora@localhost:5432/linkora
```

Check that the hostname is `postgres-indexer` from inside Docker Compose but
`localhost` from the host. Apply migrations before starting the indexer:

```bash
bash tests/migrations/test-migrations.sh
```

If the database exists but schema checks fail, take a backup first, inspect the
migration output, and apply the migrations in filename order. Do not delete a
production database to fix a missing migration.
