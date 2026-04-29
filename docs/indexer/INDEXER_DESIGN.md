# Indexer Integration Design

## Overview

The Linkora social contract emits `PostCreatedEvent` when posts are created on-chain. An off-chain indexer service monitors these events and builds a searchable index of post content to enable keyword search functionality.

## Architecture

```
Stellar Network → Indexer Service → Search Database → Web Frontend
     ↓               ↓                    ↓              ↓
PostCreatedEvent → Event Processing → Indexed Content → Search API
```

## Event Processing Flow

1. **Event Monitoring**: Indexer subscribes to contract events via Stellar RPC
2. **Event Parsing**: Extract post data from `PostCreatedEvent` 
3. **Content Indexing**: Store post content with full-text search capabilities
4. **API Serving**: Provide search endpoint for frontend queries

## PostCreatedEvent Structure

The contract emits events with this structure:
```rust
pub struct PostCreatedEvent {
    pub id: u64,
    pub author: Address,
}
```

## Required Indexer Components

### Event Subscriber
- Monitor Stellar network for contract events
- Parse `PostCreatedEvent` data
- Fetch full post content using `get_post(id)` contract call

### Search Index
- Full-text search engine (e.g., Elasticsearch, PostgreSQL with tsvector)
- Index post content for keyword matching
- Support pagination and relevance scoring

### API Server
- REST endpoint for search queries
- Rate limiting and input validation
- CORS configuration for web frontend

## Implementation Considerations

- **Event Reliability**: Handle network interruptions and missed events
- **Content Updates**: Posts can be deleted via `delete_post()` - indexer must handle removal
- **Performance**: Implement caching and efficient search algorithms
- **Security**: Validate and sanitize search queries to prevent injection attacks

## Integration Points

The web frontend integrates with the indexer via the search API defined in `API.md`. The indexer operates independently of the web application and can be deployed as a separate service.
# Linkora Indexer Design

This document describes how an off-chain indexer should consume Linkora contract events to build a queryable social graph. It is technology-agnostic: no specific database engine or programming language is assumed.

**Related documents**
- Event schema: [`packages/contracts/contracts/linkora-contracts/EVENTS.md`](../../packages/contracts/contracts/linkora-contracts/EVENTS.md)
- Contract API: [`README.md`](../../README.md#contract-api-reference)

---

## 1. Events to Subscribe To

All Linkora events share the topic prefix `(Linkora, <name>, v1)`. An indexer should subscribe to the following topic filters against the deployed contract ID:

| Topic filter | Event | Why index it |
|---|---|---|
| `Linkora, profile, v1` | `ProfileSet` | Builds the profile registry; required to resolve addresses to usernames. |
| `Linkora, follow, v1` | `Follow` | Adds directed edges to the follow graph. |
| `Linkora, unfollow, v1` | `Unfollow` | Removes directed edges from the follow graph. |
| `Linkora, post, v1` | `PostCreated` | Records post existence and authorship. |
| `Linkora, post_del, v1` | `PostDeleted` | Marks posts as deleted; must be reflected in queries. |
| `Linkora, like, v1` | `Like` | Tracks per-user like state and aggregate counts. |
| `Linkora, tip, v1` | `Tip` | Records tip amounts, fees, and links tips to posts and tippers. |
| `Linkora, deposit, v1` | `PoolDeposit` | Tracks inflows to community pools. |
| `Linkora, withdraw, v1` | `PoolWithdraw` | Tracks outflows from community pools. |
| `Linkora, upgraded, v1` | `ContractUpgraded` | Signals a WASM upgrade; the indexer should verify its event decoder is still compatible. |

Subscribe to all ten filters from the same contract ID so a single event stream covers the full social graph.

---

## 2. Suggested Data Models

The models below are expressed as field lists. Map them to tables, collections, or documents as appropriate for your storage layer.

### 2.1 Profile

```
profile
  address        string   PK   — Stellar account address
  username       string        — display name (3–32 chars)
  creator_token  string        — SEP-41 token address (may equal address)
  updated_ledger u64           — ledger sequence of the last ProfileSet event
```

`ProfileSet` is an upsert: if a record for `address` already exists, overwrite `username`, `creator_token`, and `updated_ledger`.

### 2.2 Follow

```
follow
  follower  string   PK part  — address of the follower
  followee  string   PK part  — address being followed
  ledger    u64               — ledger sequence when the follow was recorded
```

`Follow` inserts a row; `Unfollow` deletes it. The composite `(follower, followee)` is the natural key.

### 2.3 Post

```
post
  id           u64      PK   — sequential post ID assigned by the contract
  author       string        — address of the post creator
  deleted      bool          — true after a PostDeleted event
  tip_total    i128          — running sum of net tips received (gross − fee)
  like_count   u64           — running count of Like events
  created_ledger u64         — ledger sequence of PostCreated
  deleted_ledger u64 | null  — ledger sequence of PostDeleted, if applicable
```

`PostCreated` inserts the row with `deleted = false`. `PostDeleted` sets `deleted = true` and records `deleted_ledger`. Deleted posts should be retained in the index (soft delete) so that historical tip and like records remain consistent.

### 2.4 Like

```
like
  post_id  u64      PK part  — target post
  user     string   PK part  — address of the liker
  ledger   u64               — ledger sequence
```

The contract ignores duplicate likes, so the indexer can safely upsert on `(post_id, user)`. Increment `post.like_count` on each new insert.

### 2.5 Tip

```
tip
  id       u64      PK   — auto-assigned by the indexer (e.g. sequential)
  tipper   string        — address of the sender
  post_id  u64           — target post
  amount   i128          — gross amount transferred
  fee      i128          — portion sent to treasury
  ledger   u64           — ledger sequence
  tx_hash  string        — transaction hash for auditability
```

On each `Tip` event, insert a row and add `(amount − fee)` to `post.tip_total`.

### 2.6 Pool

```
pool
  pool_id  string   PK   — Symbol identifier
  token    string        — SEP-41 token address
  balance  i128          — running balance (deposits − withdrawals)
  updated_ledger u64     — ledger sequence of the last deposit or withdrawal
```

`PoolDeposit` adds `amount` to `balance`; `PoolWithdraw` subtracts `amount`. The contract enforces that withdrawals cannot exceed the on-chain balance, so the indexer balance should stay non-negative under normal operation.

### 2.7 Indexer Cursor

```
cursor
  key          string   PK   — e.g. "latest"
  ledger_seq   u64           — last fully processed ledger
  event_cursor string        — opaque cursor returned by the RPC node (if using cursor-based pagination)
```

Persist the cursor after each batch so the indexer can resume without replaying from genesis.

---

## 3. Handling Re-orgs and Missed Events

### 3.1 Soroban ledger finality

Stellar uses a BFT consensus protocol (SCP). Once a ledger is closed and confirmed by a quorum, it is final and cannot be rolled back. True chain re-orgs (as seen in proof-of-work chains) do not occur on Stellar.

However, an indexer can still encounter consistency issues:

- **Node lag / missed ledgers**: the RPC node may be behind or temporarily unavailable, causing gaps in the event stream.
- **Cursor expiry**: Soroban RPC nodes retain event history for a limited window. If the indexer falls too far behind, older events may no longer be queryable from that node.
- **Duplicate delivery**: network retries or restarts can cause the same event to be delivered more than once.

### 3.2 Recommended mitigations

**Idempotent writes** — All write operations should be upserts keyed on the natural identifier (e.g. `(follower, followee)` for follows, `(post_id, user)` for likes). This makes replaying events safe.

**Ledger-sequence watermark** — Record the last fully processed ledger in the cursor table. On restart, resume from `watermark + 1` rather than from the beginning.

**Gap detection** — After each batch, verify that the returned ledger sequences are contiguous. If a gap is detected, fetch the missing range before advancing the watermark.

**Backfill from an archive node** — If the primary RPC node no longer holds the required history, replay from a Stellar archive or a secondary full-history node. Stellar Horizon and community-run archive nodes retain full ledger history.

**Soft deletes** — Never hard-delete indexed records. Mark posts as deleted, keep tip and like rows. This preserves referential integrity when replaying events out of order.

---

## 4. Polling vs. Streaming

Soroban RPC does not currently provide a persistent push-based event stream (e.g. WebSocket subscriptions). The recommended approach is **ledger-by-ledger polling**.

### 4.1 Polling (recommended)

```
loop:
  latest_ledger = rpc.getLatestLedger()
  if latest_ledger > cursor.ledger_seq:
    events = rpc.getEvents(startLedger=cursor.ledger_seq + 1,
                           filters=[contract_id + topic_filters])
    process(events)
    cursor.ledger_seq = latest_ledger
  sleep(poll_interval)
```

- **Poll interval**: Stellar closes a ledger roughly every 5 seconds. A poll interval of 5–10 seconds is a reasonable starting point.
- **Batch size**: fetch events in ledger-range batches (e.g. 100 ledgers per request) to reduce the number of RPC calls during initial sync.
- **Back-pressure**: if processing falls behind, increase the batch size rather than the poll frequency.

### 4.2 Streaming (future / experimental)

Some Stellar ecosystem tooling (e.g. Horizon's SSE endpoint for transactions, or community indexer frameworks) offers server-sent event streams. If a streaming interface becomes available for Soroban contract events, it can replace the polling loop while keeping the same event-processing logic. Design the processor to be transport-agnostic so switching is straightforward.

### 4.3 Initial sync

On first run (or after a full re-index), start from the ledger at which the contract was deployed and process all ledgers up to the current tip. Use large batches during this catch-up phase, then switch to the normal poll interval once the indexer is within a few ledgers of the tip.

---

## 5. Event Version Handling

All events carry a version symbol (`v1`, `v2`, …) as the third topic. When the contract is upgraded and a new event version is introduced:

1. The `ContractUpgraded` event will be emitted first.
2. New event versions will appear in subsequent ledgers.
3. The indexer should check the version topic before decoding the data payload and skip (or route to a separate handler for) versions it does not recognise.
4. Old and new versions may coexist briefly if the upgrade is rolled out incrementally.

Maintain a version compatibility table in the indexer configuration so that adding support for a new version requires only a configuration change and a new decoder, not a full re-index.
