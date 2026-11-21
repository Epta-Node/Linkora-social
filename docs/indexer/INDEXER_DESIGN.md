# Indexer design

The indexer consumes Soroban events, projects them into PostgreSQL, and serves
REST and WebSocket readers. It also publishes a cryptographic state root so a
node can prove that its materialized tables agree with another node or with a
trusted offline computation.

## State-root verification

The state root is deterministic for a ledger:

```text
posts root    = MerkleRoot(sorted(hash(post rows)))
follows root  = MerkleRoot(sorted(hash(follow rows)))
profiles root = MerkleRoot(sorted(hash(profile rows)))
pools root   = MerkleRoot(sorted(hash(pool rows)))

state_root = SHA256(posts_root || follows_root || profiles_root || pools_root)
```

Row hashes include the fields that define each projection. The full-scan
implementation is retained in `services/indexer/src/stateRoot.ts` for the
`verify-state` CLI and offline checks. The commit path uses four XOR
accumulators and per-row hashes: it XORs out the previous row hash, XORs in the
new hash, and derives the combined root from the four accumulators. The first
incremental update bootstraps those tables in one serializable transaction.

```mermaid
flowchart LR
  E[Committed Soroban events] --> P[Domain projections]
  P --> A[Per-row SHA-256 hashes]
  A --> X1[Posts accumulator]
  A --> X2[Follows accumulator]
  A --> X3[Profiles accumulator]
  A --> X4[Pools accumulator]
  X1 --> R[SHA-256 of four accumulators]
  X2 --> R
  X3 --> R
  X4 --> R
  R --> DB[(indexer_state)]
```

`indexer_state` stores the root by ledger. `GET /api/state-root?ledger=N`
returns `{ ledger, root, verified: true }` when a root exists; malformed
ledger values, future ledgers, missing roots, and invalid hex roots are
rejected. The `verify-state` CLI can compare a fresh database scan with a
trusted root or a peer:

```bash
cd services/indexer
DATABASE_URL=postgresql://linkora:linkora@localhost:5432/linkora \
  pnpm exec ts-node src/cli/verify-state.ts \
  --ledger 1234 --peer http://indexer-2:3000
```

An equal root means the compared projection state is consistent for the
selected ledger. A mismatch is an operational incident: stop treating the
node as authoritative, preserve its logs/database snapshot, and investigate
before deleting or rebuilding data.

## Gossip reconciliation

Set `INDEXER_PEERS` to a comma-separated list of indexer base URLs. Every
`GOSSIP_INTERVAL_MS` milliseconds (5 seconds by default), a node fetches the
latest local root from each peer at the same ledger. Unreachable peers are
ignored for that cycle; a response with a different root is logged as
`DIVERGENCE_DETECTED`.

When at least `DIVERGENCE_THRESHOLD` peers (2 by default) agree that the local
root differs, the node logs `SELF_FENCED` and stops serving normal API traffic.
With replay dependencies configured, it binary-searches for the first
diverging ledger, replays the missing Stellar event range, and then unfences.
Without replay dependencies it remains fenced and emits the manual replay
ledger in `RECONCILIATION_REQUIRES_REPLAY`.

This is gossip-based reconciliation, not consensus: a peer response is an
independent observation and the threshold limits accidental single-peer
false positives. Operators should still validate the repaired node with the
`verify-state` CLI and review the `DIVERGENCE_DETECTED`, `SELF_FENCED`, and
reconciliation logs.
