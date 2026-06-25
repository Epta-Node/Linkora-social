# ADR-006: Storage Rent Lifecycle Management

## Status

**Accepted** — 2026-06-23

## Context

Soroban persistent storage entries expire when their Time-To-Live (TTL) reaches zero. While Linkora calls `Self::bump()` on every read/write to keep active user entries alive, this passive approach leaves three major issues unresolved:
1. **Ghost Follows:** If an index entry such as `FollowersIdx(user, seq)` expires before the corresponding counter key `FollowingCount(user)`, retrieval functions (e.g., `get_followers`) read a stale counter and silently return fewer results with no error propagation.
2. **No Deposit Model:** There is no mechanism for users to pre-pay rent for long-lived profile data. Highly popular but inactive profiles can expire if contract admins do not actively bump them.
3. **No Expiry Detection:** Clients calling `get_profile` receive `None` and cannot differentiate between a user who never registered and a user whose profile expired due to unpaid rent.

## Decision Drivers

- Contracts must distinguish expired entries from never-registered profiles on `get_profile` queries.
- Users must be able to fund their own storage rent in a pre-pay deposit model using SEP-41 tokens.
- Follow operations must be protected by atomic consistency guards to prevent write-corruption (e.g., writing to partially expired social graph sets).
- Admin utilities must exist to batch-bump user graph keys safely.

---

## Soroban TTL Mechanics

Soroban storage entries are split into three categories, each with distinct TTL characteristics:
- **Temporary Storage:** Cheapest; expires and is permanently deleted. Cannot be restored. Used for short-term data (e.g., `TipCooldown`).
- **Persistent Storage:** More expensive; expires and is archived (removed from active state). Can be restored via `RestoreFootprint` transactions. Used for profiles, posts, and social graph edges.
- **Instance Storage:** Shared contract configuration/state. Shared lifecycle with the contract instance.

Every persistent entry has a remaining TTL (measured in ledger sequences). When the TTL reaches 0, the entry is archived. The host provides the following functions to query and extend TTL:
- `env.storage().persistent().get_ttl(&key)`: Returns remaining TTL (in ledgers) for an active key.
- `env.storage().persistent().extend_ttl(&key, threshold, max_ttl)`: Bumps the entry's TTL to `max_ttl` if the remaining TTL is below `threshold`.

---

## Entry Size Estimation

To calculate the cost model and formulate a deposit strategy, we estimate the size of each `StorageKey` variant (excluding XDR framing overhead):

| StorageKey Variant | Data Type | Size (Bytes) | Storage Type |
|---|---|---|---|
| `Post(u64)` | `Post` struct (content, author, etc.) | ~360 B | Persistent |
| `Profile(Address)` | `Profile` struct (username, token, etc.) | ~100 B | Persistent |
| `Following(Address)` | `Vec<Address>` (Legacy) | ~3.2 KB | Persistent |
| `Followers(Address)` | `Vec<Address>` (Legacy) | ~3.2 KB | Persistent |
| `Pool(Symbol)` | `Pool` struct (token, balance, admins) | ~400 B | Persistent |
| `Like(u64, Address)` | `bool` | 1 B | Persistent |
| `AuthorPosts(Address)` | `Vec<u64>` (up to 500 post IDs) | ~4 KB | Persistent |
| `Blocks(Address)` | `Map<Address, ()>` (up to 30 blocked) | ~1 KB | Persistent |
| `UsernameIndex(String)` | `Address` | 32 B | Persistent |
| `TipCooldown(u64, Address)`| `u64` (ledger sequence) | 8 B | Temporary |
| **Social Graph (ADR-001)** | | | |
| `Edge(Address, Address)` | `bool` | 1 B | Persistent |
| `FollowingCount(Address)` | `u32` | 4 B | Persistent |
| `FollowersCount(Address)` | `u32` | 4 B | Persistent |
| `FollowingIdx(Address, u32)`| `Address` | 32 B | Persistent |
| `FollowersIdx(Address, u32)`| `Address` | 32 B | Persistent |
| `FollowingPos(Ad, Ad)` | `u32` | 4 B | Persistent |
| `FollowersPos(Ad, Ad)` | `u32` | 4 B | Persistent |
| `GraphMigrated(Address)` | `bool` | 1 B | Persistent |
| `DmPublicKey(Address)` | `BytesN<32>` (X25519 public key) | 32 B | Persistent |

---

## Cost Model & Deposit Strategy

### Cost Model per Ledger
In Soroban, persistent rent is calculated by the network fee configuration:
$$\text{Rent Fee} = (\text{Entry Size} + \text{Metadata Size}) \times \text{Fee Rate Per Byte Per Ledger} \times \text{Ledger Count}$$

Assuming a standard Stellar mainnet configuration, persistent rent costs approximately $0.0000002 \text{ XLM}$ per byte per ledger. 

### Deposit Strategy
We introduce a user-funded deposit model:
1. **Payer-funded extension:** A user calls `pay_rent(env, user, token, amount)` where `token` is a SEP-41 token (e.g. XLM or a stablecoin).
2. **Rate conversion:** The paid `amount` (expressed in the token's smallest unit, like stroops) is converted to `ledgers_to_extend` via a configurable `RENT_RATE_BPS`:
   $$\text{ledgers\_to\_extend} = \frac{\text{amount} \times 10000}{\text{RENT\_RATE\_BPS} \times 10^{\text{decimals}}}$$
   For example, if `RENT_RATE_BPS = 100` (representing 1% of a token, i.e., 0.01 tokens per ledger for 7-decimal tokens), a payment of $1.0 \text{ Token}$ ($10^7$ units) extends all user keys by 100 ledgers.
3. **Key extension:** The contract gathers all persistent keys associated with the user and calls `extend_ttl` to bump their lifetimes by `ledgers_to_extend` ledgers.

---

## Detailed Design

### 1. Expiry Guard Layer
To distinguish expired profiles from unregistered profiles, the contract maintains an instance-storage registry `REGISTERED_USERS` of type `Map<Address, bool>`.
- **Registration:** When a profile is created in `set_profile`, the user's address is added to the registry. The counters `FollowingCount` and `FollowersCount` are initialized to `0` so they exist on-chain immediately.
- **De-registration:** When a profile is deleted in `delete_profile`, the user's address is removed from the registry.
- **Querying:** In `get_profile(user)`:
  - If the profile key exists in persistent storage, we return it and bump the key.
  - If the profile key is missing:
    - We look up the user in `REGISTERED_USERS`. If present, it indicates the entry exists but has lapsed (expired), so we panic with a structured contract error `RentError::Expired`.
    - If not present in the registry, it indicates the profile was never registered, so we return `None`.

### 2. User-Funded Rent Deposit
We add the following contract interface functions:
- `pay_rent(env, user: Address, token: Address, amount: i128)`: Collects the token payment to the contract's treasury and extends the TTL of all active user keys (Profile, UsernameIndex, adjacency-set graph keys, AuthorPosts, Blocks) proportionally. Emits `RentPaidEvent`.
- `get_rent_expiry(env, user: Address) -> u32`: Returns the absolute ledger sequence number at which the earliest user key will expire.
- `set_rent_rate_bps(env, rate: u32)` & `get_rent_rate_bps(env) -> u32`: Configures the rent conversion rate.

### 3. Atomic Consistency Guard & Admin Batch Bump
- **Consistency assertion in `follow`:** Before writing any follow graph edges or index entries, the contract asserts that both the follower's and followee's `FollowingCount` and `FollowersCount` keys are not expired (meaning they exist in storage and have a TTL > `LEDGER_THRESHOLD`). If any are expired, it panics with `"graph entry expired — pay rent"`.
- **Admin batch bump:** `batch_bump_user_graph(env, user: Address)` enables administrators to bump up to 50 active user graph keys whose TTL is currently `<= LEDGER_THRESHOLD`, ensuring chunk-safe maintenance of large graphs.
