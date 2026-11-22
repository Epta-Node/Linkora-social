# Integration tests

## E2E posting -> tip -> indexer

`tests/integration/e2e-tipping.test.ts` covers the post/tip flow against the local Soroban + indexer Docker stack.

### What it verifies

- Create post and tip via SDK against local Soroban testnet
- Poll indexer until ingest completes (30s timeout)
- `GET /posts/:id` returns `stats.tip_count === 1`
- `GET /events?type=TipSent` returns the tip event record
- Happy path and a double-tip scenario

### Run locally

1. Start dependencies and run the integration suite:
   - `bash tests/integration/run_e2e.sh`
2. The script starts Docker Compose, deploys contracts, runs Jest e2e tests, and tears down.

### CI

The integration workflow runs this suite in CI against the containerised stack.
