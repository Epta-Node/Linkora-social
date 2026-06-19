# ADR-003: Byzantine-Fault-Tolerant Multi-Node Indexer Consensus

## Status

**Accepted** — 2026-06-19

## Context

The Linkora indexer is currently a single-node service. A crash or database
corruption loses the entire off-chain social graph. For a production SocialFi
platform, replicated indexers must tolerate:

1. **Node crashes** — crash fault tolerance
2. **Network partitions** — split-brain scenarios between replicas
3. **Byzantine faults** — a malicious or buggy node producing incorrect state

This ADR evaluates three candidate designs and selects the most appropriate one
given Linkora's event source properties.

---

## Key Insight: Soroban Events Are Totally Ordered

Soroban contract events carry a globally monotone `ledger` sequence assigned by
the Stellar network consensus protocol. This is a fundamentally different
starting point from systems like distributed databases where the total order
must be *established* by the consensus layer.

Because the order is externally determined, designs that re-implement ordering
(like Raft's log) are redundant.

---

## Option 1 — Raft (Leader Election + Log Replication)

### How it works
One node is elected leader; all writes flow through it and are replicated to
followers before being acknowledged. Uses term-based elections on leader failure.

### Analysis for Linkora

| Aspect | Finding |
|---|---|
| Log ordering | **Redundant.** Soroban already provides a total order by ledger sequence; Raft re-establishes it unnecessarily. |
| Write path | Every event requires a quorum round-trip before being committed, adding 1–2 RTT latency per ledger batch. |
| Fault tolerance | Tolerates `f` crash faults with `2f+1` nodes; does **not** tolerate Byzantine faults. |
| Operational complexity | Leader elections, log compaction, and membership changes require significant implementation work. |
| Conclusion | **Not suitable.** Overhead without Byzantine tolerance; the ordering property is not needed. |

---

## Option 2 — PBFT / Tendermint-Style BFT

### How it works
Pre-prepare → Prepare → Commit three-phase protocol. Tolerates `f` Byzantine
faults with `3f+1` nodes.

### Communication overhead analysis

| Cluster size | Messages per consensus round | RTTs |
|---|---|---|
| 3 nodes (f=0) | O(n²) = 9 | 2 |
| 5 nodes (f=1) | O(n²) = 25 | 2 |
| 10 nodes (f=3) | O(n²) = 100 | 2 |

For a social feed indexer with a 5-second ledger close time and an acceptable
latency budget of ~500 ms per ledger batch, the O(n²) message overhead becomes
problematic above ~7 nodes. At 10 nodes, 100 messages per ledger × up to 20
ledgers/minute = 2 000 messages/min, which may saturate links on commodity
cloud instances.

Tendermint reduces this to O(n) with aggregated signatures but requires BLS
key infrastructure.

**Conclusion:** Too heavyweight for Linkora's 3–5 node target. Reserved for
future consideration if the cluster grows beyond 7 nodes.

---

## Option 3 — Optimistic Replication with Cryptographic State Roots ✅ Selected

### How it works

1. Each indexer node independently processes the same Soroban event stream.
2. After finishing each ledger's events, each node computes a deterministic
   `state_root = sha256(posts_root || follows_root || profiles_root || pools_root)`
   where each sub-root is the root of a sorted Merkle tree over all row hashes.
3. Nodes gossip their `(ledger, state_root)` to a configured peer list.
4. On divergence, a binary-search reconciliation finds the first differing
   ledger, and the node replays from that point.
5. If `>= threshold` peers (default: 2 out of 3) agree on a root that differs
   from the local root, the local node self-fences.

### Why this is sufficient given Soroban's determinism

Soroban event processing is **deterministic**: the same ordered event stream
applied to the same initial state must produce the same final state.  Any
divergence between two nodes processing the same ledger sequence is therefore
evidence of a bug or Byzantine behaviour, not a legitimate ordering conflict.
There is no need to elect a leader or run a multi-phase commit; the canonical
truth is the chain itself.

### CAP theorem trade-off

| Property | Choice |
|---|---|
| Consistency | **Eventual.** Nodes may temporarily serve stale data after a ledger they have not yet processed. |
| Availability | **High.** Each node serves reads independently; no quorum needed for reads. |
| Partition tolerance | **Yes.** Nodes continue processing events during a network partition; divergence is detected and reconciled when the partition heals. |

For a social feed, eventual consistency is acceptable: a follower count that is
1–2 ledgers stale (≈5–10 seconds) is imperceptible to users. Self-fencing
ensures a Byzantine node stops serving incorrect data before it misleads clients.

### Failure mode coverage

| Scenario | Response |
|---|---|
| Node crash | Other nodes continue independently; crashed node replays from last saved ledger on restart. |
| Network partition | Each partition processes independently; reconciliation runs on heal. |
| Single Byzantine node (3-node cluster) | 2/3 peers agree; Byzantine node self-fences within one gossip cycle. |
| Database corruption | Detected via state root mismatch; corrupted node self-fences and replays. |

---

## Decision

**Implement Optimistic Replication with Cryptographic State Roots.**

Implementation plan:
- **Phase 2**: State root computation (`services/indexer/src/stateRoot.ts`) +
  `indexer_state` table + `GET /api/state-root` endpoint.
- **Phase 3**: Gossip protocol (`services/indexer/src/gossip.ts`) with
  divergence detection, reconciliation trigger, and self-fencing.
- **CLI**: `services/indexer/src/cli/verify-state.ts` for operator verification.

---

## Consequences

**Positive:**
- Simple to implement (no distributed protocol library required).
- Determinism guarantee means roots must always match if nodes are correct.
- Self-fencing gives strong safety: a faulty node stops serving before clients
  observe incorrect state.

**Negative:**
- Gossip adds HTTP traffic proportional to peer count × ledger rate.
- Reconciliation by replay is write-amplifying; mitigated by binary search to
  minimise replay window.
- Does not provide a BFT *write* guarantee — but Linkora writes are performed
  by the Soroban contract, which provides its own BFT consensus.
