# Atomic Batches (`LinkoraMulticall`)

Issue: #1767

A Soroban transaction holds exactly one contract invocation, so common
combinations ("follow + tip + join pool") cost one transaction, and one wallet
prompt, each. `LinkoraMulticall` runs a list of calls inside a single
invocation:

- **Atomic** — calls run in order; if any fails, `execute` fails and the host
  rolls back everything the earlier calls did.
- **One signature** — the caller authorizes `execute` once. The `require_auth`
  checks inside the batched calls (`follow(caller, …)`, `tip(caller, …)` and
  the token transfer inside `tip`) are covered by that authorization tree,
  which simulation records for the wallet to sign.
- **Access control** — `execute` requires the caller's authorization, and
  every call still runs the target contract's own checks. A call that acts
  for a different account fails unless that account authorized it too, so a
  batch can only do what the caller could do with separate transactions.
- **No re-entry** — a call may not target the multicall contract itself.

Contract: `packages/contracts/contracts/linkora-multicall`.

## Contract API

```rust
pub struct Call { pub contract_id: Address, pub fn_name: Symbol, pub args: Vec<Val> }

fn execute(caller: Address, calls: Vec<Call>) -> Vec<Val>; // results in call order
fn get_max_calls() -> u32;                                  // 16
```

| Error           | Code | Cause                                  |
| --------------- | ---- | -------------------------------------- |
| `EmptyBatch`    | 1    | `calls` is empty.                      |
| `TooManyCalls`  | 2    | More than `MAX_CALLS` (16) calls.      |
| `ReentrantCall` | 3    | A call targets the multicall contract. |

Event: `batch_executed` — topics `version, caller`, data `call_count`.

## SDK

```ts
const client = new LinkoraClient({ contractId, rpcUrl, multicallContractId });
const { follow, tip, poolDeposit } = client.calls;

const xdr = await client.prepareBatchTx(me, [
  follow(me, creator),
  tip(me, postId, usdc, 5_0000000n),
  poolDeposit(me, "fans", usdc, 10_0000000n), // join a pool
]);
// sign `xdr` once, then submit
```

- `client.calls` — builders for `follow`, `unfollow`, `likePost`,
  `createPost`, `tip`, `poolDeposit`, and `call(method, args, contractId?)`
  for anything else.
- `client.prepareBatchTx(caller, calls)` — simulated, submittable XDR.
- `client.batch(caller, calls)` — unsimulated XDR built with a throwaway
  source (like the other base write methods).
- Standalone: `encodeBatch`, `buildBatchOperation`, `buildBatchTransaction`
  from `linkora-sdk`.

## Gas cost: batch vs separate transactions

Measured by `test_gas_cost_batch_vs_separate` against the compiled Linkora
WASM (`cargo test -p linkora-multicall gas_cost -- --nocapture`), for follow +
tip + like:

|                               | CPU instructions | Ledger entries read | Entries written | Resource fee (stroops) |
| ----------------------------- | ---------------: | ------------------: | --------------: | ---------------------: |
| 3 separate transactions (sum) |        8,337,578 |                  39 |              21 |             11,135,750 |
| 1 batched transaction         |        8,382,281 |                  27 |              18 |              8,534,339 |
| Difference                    |            +0.5% |                −31% |            −14% |               **−23%** |

- Compute is about the same: the calls do the same work, plus a small
  dispatch overhead in the multicall contract.
- The saving comes from shared ledger entries — the Linkora contract instance
  and code, the token contract and the caller's balance — which a batch reads
  and writes once instead of once per transaction.
- The host only meters the invocation. Each separate transaction also pays its
  own inclusion fee (≥ 100 stroops), signature verification and envelope
  bytes, none of which is counted above, so the real saving is larger.
- Fee estimates use the SDK's 2024-12 pubnet fee snapshot; treat them as
  relative, not absolute.

## Tests

`packages/contracts/contracts/linkora-multicall/src/test.rs` (15 tests):
follow + tip in one transaction against the real Linkora WASM, the single
authorization tree, an explicit auth tree without mocks, rejecting calls on
behalf of accounts that did not sign, rollback wherever the failing call sits,
result ordering, the batch limits, re-entry and the gas comparison.
