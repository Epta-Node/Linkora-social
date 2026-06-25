# Linkora Contract Events Schema

This document defines the on-chain event schema for the Linkora smart contract, enabling indexers to track state changes and engagement signals.

## Event Versioning

All events are currently `v1`. Breaking schema changes will bump the major version and be announced in the changelog.

---

## ProfileSetEvent (v1)

**Topics:**

- `user: Address` (indexed)

**Data:**

- `username: String`

**Emitted by:** `set_profile()`

**Example filter:**

```bash
stellar events --topic-filter 'user' --contract-id <contract-addr>
```

---

## FollowEvent (v1)

**Topics:**

- `follower: Address` (indexed)
- `followee: Address` (indexed)

**Emitted by:** `follow()`

---

## UnfollowEvent (v1)

**Topics:**

- `follower: Address` (indexed)
- `followee: Address` (indexed)

**Emitted by:** `unfollow()`

---

## PostCreatedEvent (v1)

**Topics:**

- `id: u64` (indexed)
- `author: Address` (indexed)

**Emitted by:** `create_post()`

---

## PostDeleted (v1)

**Topics:**

- `post_id: u64` (indexed)
- `author: Address` (indexed)

**Emitted by:** `delete_post()`

---

## LikePostEvent (v1)

**Topics:**

- `user: Address` (indexed)
- `post_id: u64` (indexed)

**Emitted by:** `like_post()`

**Behavior:** Emitted only on the first like; duplicate likes (idempotent calls) do not emit an event.

**Example filter:**

```bash
stellar events --topic-filter 'user,post_id' --contract-id <contract-addr>
```

---

## TipEvent (v1)

**Topics:**

- `tipper: Address` (indexed)
- `post_id: u64` (indexed)

**Data:**

- `amount: i128` (tip amount in smallest units)
- `fee: i128` (fee retained by treasury)

**Emitted by:** `tip()`

---

## PoolDepositEvent (v1)

**Topics:**

- `depositor: Address` (indexed)
- `pool_id: Symbol` (indexed)

**Data:**

- `amount: i128` (deposit amount in smallest units)

**Emitted by:** `pool_deposit()`

**Example filter:**

```bash
stellar events --topic-filter 'pool_id' --data-filter 'amount' --contract-id <contract-addr>
```

---

## PoolWithdrawEvent (v1)

**Topics:**

- `recipient: Address` (indexed)
- `pool_id: Symbol` (indexed)

**Data:**

- `amount: i128` (withdrawal amount in smallest units)

**Emitted by:** `pool_withdraw()`

**Example filter:**

```bash
stellar events --topic-filter 'pool_id' --contract-id <contract-addr>
```

---

## ContractUpgraded (v1)

**Data:**

- `new_wasm_hash: BytesN<32>`

**Emitted by:** `upgrade()`

---

## PostReportedEvent (v1)

**Topics:**

- `post_id: u64` (indexed)
- `reporter: Address` (indexed)

**Data:**

- `stake_amount: i128` (stake locked by reporter in smallest token units)

**Emitted by:** `report_post()`

**Behavior:** Emitted on every successful report submission. Duplicate reports by the same reporter for the same post are rejected before this event fires.

**Example filter:**

```bash
stellar events --topic-filter 'post_id,reporter' --contract-id <contract-addr>
```

---

## PostRemovedByModerationEvent (v1)

**Topics:**

- `post_id: u64` (indexed)
- `reporter: Address` (indexed)

**Emitted by:** `review_report()` when `verdict = Upheld`

**Behavior:** Emitted when moderators uphold a report and delete the post. The reporter's stake is refunded. If the post was already deleted before the review call, the event is still emitted and the stake is still refunded. The author's creator token balance is slashed only if the Linkora contract has a sufficient `burn_from` allowance (pre-approved by the author via `token.approve()`).

---

## ReportDismissedEvent (v1)

**Topics:**

- `post_id: u64` (indexed)
- `reporter: Address` (indexed)

**Emitted by:** `review_report()` when `verdict = Dismissed`

**Behavior:** Emitted when moderators dismiss a report. The reporter's stake is forfeited and transferred to the protocol treasury.

---

## Notes

- All amounts are in the token's smallest unit (usually stroop for Stellar assets).
- Topics enable efficient filtering and indexing; data fields are available but not indexed.
- Indexers should track event versioning and handle schema migrations when major version bumps occur.
- The moderation pool used by `review_report` is the pool with symbol ID `mods`. Indexers should be aware that `review_report` will not function unless this pool has been created via `create_pool`.
