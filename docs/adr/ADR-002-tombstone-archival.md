# ADR-002: Storage Archival Strategy for Tombstoned Content

- **Status:** Proposed
- **Date:** 2026-10-17
- **Scope:** `packages/contracts/contracts/linkora-contracts`
- **Related:** ADR-001 (adjacency-set social graph, referenced in `lib.rs`)

## Context

Deleting content in the contract is lazy. Deleting a post or profile removes the primary entry and writes a tombstone. The index entries that point at the content (likes, reports, tip cooldowns, follow edges, authored-post lists) are removed later, in bounded batches, by permissionless cleanup calls.

| Storage key                          | Written by                                                 | Removed by                                              |
| ------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------- |
| `Post(id)`                           | `create_post`, `batch_create_post`                         | `delete_post`, `batch_cleanup_profile` (authored posts) |
| `DeletedPost(id)` (tombstone)        | `delete_post`, `batch_cleanup_profile`                     | `batch_cleanup_post`, once all post indexes are empty   |
| `DeletedProfile(user)` (tombstone)   | `delete_profile`                                           | `batch_cleanup_profile`, once all user indexes are empty |
| Like / report / tip-cooldown indexes | `like_post`, `report_post`, `tip`                          | `batch_cleanup_post`, `batch_cleanup_profile`           |
| Follow edges and index entries       | `follow`                                                   | `batch_cleanup_profile`, `block_user`                   |

Storage on Soroban is rent-bearing. Entries carry a TTL that is extended by `pay_rent`, which transfers the rent token to the treasury and extends the TTL of every key the user owns. Left unchecked, tombstones and orphaned index entries keep costing rent after the content they describe is gone.

This ADR records the lifecycle, the permissions, the rent policy, and the id rules, so that cleanup behaviour is deliberate rather than accidental.

## Decision

### 1. Lifecycle

```
Live ──delete_post──▶ Tombstoned (DeletedPost) ──batch_cleanup_post──▶ Removed
Live ──delete_profile──▶ Tombstoned (DeletedProfile) ──batch_cleanup_profile──▶ Removed
                                  │
                                  └── authored posts become Tombstoned (DeletedPost)
```

- A tombstone is only removed after every index that references it is empty. `batch_cleanup_post` and `batch_cleanup_profile` both enforce this order, so a partially cleaned entry is never orphaned.
- A tombstone is an assertion that the id once existed. It is not a value that must be retained for correctness. Reads of a deleted id return `None` whether or not the tombstone exists.

### 2. Who may trigger cleanup

| Call                                 | Auth required     | Why                                                                                         |
| ------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------- |
| `delete_post`, `delete_profile`      | Owner (`require_auth`) | Only the owner can start a deletion.                                                   |
| `batch_cleanup_post`                 | None              | Cleanup only reclaims state that is already tombstoned. It is idempotent and bounded by `max_entries`. |
| `batch_cleanup_profile`              | None              | Same reasoning. The tombstone must already exist.                                           |

Cleanup is permissionless by design. Anyone, including a relayer or indexer, can finish a deletion the owner started. The cost is that the caller pays the transaction fee for work that benefits the network, and nothing can be reclaimed for the caller.

### 3. Rent accounting

- **No refunds.** The contract does not pay refunds to users when entries are removed. `pay_rent` is a per-user prepayment, not a per-entry deposit, so there is no per-entry balance to return.
- **Rent stops on removal.** Once an entry is removed it no longer needs its TTL extended, so the user's future `pay_rent` calls stop covering it.
- **Expired entries are not re-created.** An entry whose TTL lapses is treated as absent. Callers must check `get_rent_expiry` and pay rent before the expiry ledger, as before.
- **Cleanup is not a rent event.** `batch_cleanup_*` emits no `RentPaidEvent`. Indexers should treat removal events as the signal.

Refunds are out of scope for v1. A future change that introduces per-entry deposits would require a new ADR.

### 4. Re-creation of ids

- **Post ids are never reused.** `POST_CT` only increases, and `create_post` allocates `POST_CT + 1`. Removing a tombstone therefore cannot cause an id to be recycled.
- **Profiles can be re-registered.** `set_profile` for an address that was deleted creates a new profile under the same address. See open issue A below for the interaction with a pending cleanup.

## Open issues

These were found while writing this ADR. They are documented here and are not fixed by this change.

**A. Profile re-registration during cleanup.** `set_profile` does not check for `DeletedProfile(user)`. If a user deletes a profile, re-registers, and follows someone before `batch_cleanup_profile` completes, the cleanup will remove the new follow edges and any new authored posts. Proposed fix: reject `set_profile` while the `DeletedProfile` tombstone exists, or have cleanup refuse to run once a new `Profile(user)` exists.

**B. Post tombstones left by profile cleanup.** `batch_cleanup_profile` writes `DeletedPost(id)` for each authored post and removes the post's indexes, but it does not remove those tombstones. They persist until someone calls `batch_cleanup_post(id)`, which is permissionless but not triggered automatically. Proposed fix: either call the post-tombstone removal inline when the post's indexes are empty, or have `batch_cleanup_profile` return the ids that still need cleanup.

## Consequences

- Cleanup stays bounded and permissionless. Storage is reclaimed without requiring the owner to be online.
- Rent is never refunded, so users should not expect a return on deleted content.
- Until issues A and B are resolved, the storage footprint after a profile deletion can be larger than the lifecycle table suggests.

## Implementation references

- `delete_post`, `batch_cleanup_post`: `src/lib.rs`
- `delete_profile`, `batch_cleanup_profile`: `src/lib.rs`
- `pay_rent`, `get_rent_expiry`: `src/lib.rs`
- ID allocation: `create_post`, `insert_post` in `src/lib.rs`
