# Linkora API Reference

> **Scope note.** This document covers indexer HTTP authentication and the Soroban contract
> storage layout. Contract function and event details are documented alongside the contract
> implementation in `packages/contracts/contracts/linkora-contracts/src/lib.rs`.

---

## Table of Contents

1. [Stellar HTTP Authentication (v1)](#1-stellar-http-authentication-v1)
2. [Soroban Storage Layout](#2-soroban-storage-layout)
   - [Contract Error Codes](#contract-error-codes)
3. [The Signed Message](#3-the-signed-message)
4. [Canonical Path](#4-canonical-path)
5. [Body Hash](#5-body-hash)
6. [The Authorization Header](#6-the-authorization-header)
7. [Verification Order and Error Codes](#7-verification-order-and-error-codes)
8. [Worked Example](#8-worked-example)
9. [Protected Endpoints](#9-protected-endpoints)
10. [Known Limitations of v1](#10-known-limitations-of-v1)

---

## 2. Soroban Storage Layout

The contract uses typed `StorageKey` values for persistent and temporary domain data. Instance
storage is reserved for counters, configuration, roles, pause flags, and contract state.

```text
┌──────────────────────── Instance storage ────────────────────────┐
│ POST_CT  PROFILE_CREATED_CT  ADMIN  TREASURY  FEE_BPS  INIT     │
│ TIP_CD_W  R_USERS  RENT_BPS  MOD_SL_B  CT_STATE  ROLES          │
│ PAUSED  P_MASK  APL_CFG  APL_CT  upgrade state in CT_STATE      │
└─────────────────────────────────────────────────────────────────┘
                                   │
        ┌──────────────────────────┴──────────────────────────┐
        ▼                                                     ▼
┌── Persistent Storage ──┐                         ┌─ Temporary Storage ─┐
│ Post/profile records   │                         │ Tip cooldown ledger │
│ Governance and appeals │                         │ sequences           │
│ Social graph/indexes   │                         └─────────────────────┘
│ Reports, moderation    │
│ Credentials and DMs    │
└────────────────────────┘
```

### 2.1 `StorageKey` variants

| Variant                                  | Key format                                 | Value type                        |
| ---------------------------------------- | ------------------------------------------ | --------------------------------- |
| `Post(u64)`                              | `(Post, post_id)`                          | `Post`                            |
| `Profile(Address)`                       | `(Profile, user)`                          | `Profile`                         |
| `Following(Address)`                     | `(Following, user)`                        | `Vec<Address>` legacy             |
| `Followers(Address)`                     | `(Followers, user)`                        | `Vec<Address>` legacy             |
| `Pool(Symbol)`                           | `(Pool, pool_id)`                          | `Pool`                            |
| `Like(u64, Address)`                     | `(Like, post_id, user)`                    | `bool`                            |
| `AuthorPosts(Address)`                   | `(AuthorPosts, author)`                    | `Vec<u64>`                        |
| `Blocks(Address)`                        | `(Blocks, blocker)`                        | `Map<Address, ()>`                |
| `UsernameIndex(String)`                  | `(UsernameIndex, username)`                | `Address`                         |
| `TipCooldown(u64, Address, Address)`     | `(TipCooldown, post_id, tipper, token)`    | `u32` last tip ledger             |
| `Edge(Address, Address)`                 | `(Edge, follower, followee)`               | `bool`                            |
| `FollowingCount(Address)`                | `(FollowingCount, user)`                   | `u32`                             |
| `FollowersCount(Address)`                | `(FollowersCount, user)`                   | `u32`                             |
| `FollowingIdx(Address, u32)`             | `(FollowingIdx, user, sequence)`           | `Address`                         |
| `FollowersIdx(Address, u32)`             | `(FollowersIdx, user, sequence)`           | `Address`                         |
| `FollowingPos(Address, Address)`         | `(FollowingPos, follower, followee)`       | `u32`                             |
| `FollowersPos(Address, Address)`         | `(FollowersPos, followee, follower)`       | `u32`                             |
| `GraphMigrated(Address)`                 | `(GraphMigrated, user)`                    | `bool`                            |
| `DmPublicKey(Address)`                   | `(DmPublicKey, user)`                      | `BytesN<32>` X25519 key           |
| `CredentialRoot(Address)`                | `(CredentialRoot, user)`                   | `BytesN<32>`                      |
| `NullifierSet(Address, u32, BytesN<32>)` | `(NullifierSet, user, epoch, nullifier)`   | `bool`                            |
| `CredentialEpoch(Address)`               | `(CredentialEpoch, user)`                  | `u32`                             |
| `CredentialAuthority`                    | `(CredentialAuthority)`                    | `BytesN<32>` Ed25519 authority    |
| `GovProposal(u64)`                       | `(GovProposal, proposal_id)`               | `GovProposal`                     |
| `GovVote(u64, Address)`                  | `(GovVote, proposal_id, voter)`            | `bool`                            |
| `GovConfig`                              | `(GovConfig)`                              | `GovConfig`                       |
| `GovProposalCount`                       | `(GovProposalCount)`                       | `u64`                             |
| `GovDelegation(Address)`                 | `(GovDelegation, delegator)`               | `Address`                         |
| `OracleKey(Symbol)`                      | `(OracleKey, oracle_name)`                 | `BytesN<32>` Ed25519 key          |
| `AttestationNullifier(BytesN<32>)`       | `(AttestationNullifier, report_hash)`      | `bool`                            |
| `Report(u64, Address)`                   | `(Report, post_id, reporter)`              | `Report`                          |
| `ReportCount(u64)`                       | `(ReportCount, post_id)`                   | `u32`                             |
| `ReporterReputation(Address)`            | `(ReporterReputation, reporter)`           | `i32`                             |
| `DeletedPost(u64)`                       | `(DeletedPost, post_id)`                   | `bool`                            |
| `DeletedProfile(Address)`                | `(DeletedProfile, user)`                   | `bool`                            |
| `PostLikersCount(u64)`                   | `(PostLikersCount, post_id)`               | `u32`                             |
| `PostLikersIdx(u64, u32)`                | `(PostLikersIdx, post_id, sequence)`       | `Address`                         |
| `PostReportersIdx(u64, u32)`             | `(PostReportersIdx, post_id, sequence)`    | `Address`                         |
| `PostTipCooldownsCount(u64)`             | `(PostTipCooldownsCount, post_id)`         | `u32`                             |
| `PostTipCooldownsIdx(u64, u32)`          | `(PostTipCooldownsIdx, post_id, sequence)` | `(Address, Address)` tipper/token |
| `PostContentHash(u64)`                   | `(PostContentHash, post_id)`               | `BytesN<32>`                      |
| `CommittedPost(u64)`                     | `(CommittedPost, post_id)`                 | `CommittedPost`                   |
| `RemovedPost(u64)`                       | `(RemovedPost, post_id)`                   | `Post`                            |
| `ModerationRecord(u64)`                  | `(ModerationRecord, post_id)`              | `ModerationRecord`                |
| `Appeal(u64)`                            | `(Appeal, post_id)`                        | `Appeal`                          |
| `GovAppeal(u64)`                         | `(GovAppeal, appeal_id)`                   | `GovAppeal`                       |
| `PostGovAppeal(u64)`                     | `(PostGovAppeal, post_id)`                 | `u64` appeal ID                   |
| `GovAppealVote(u64, Address)`            | `(GovAppealVote, appeal_id, voter)`        | `AppealVote`                      |
| `ModerationModerator(u64)`               | `(ModerationModerator, post_id)`           | `Address`                         |
| `ModeratorBond(Address)`                 | `(ModeratorBond, moderator)`               | `ModeratorBond`                   |
| `ModeratorOpenAppeals(Address)`          | `(ModeratorOpenAppeals, moderator)`        | `u32`                             |

Persistent keys are bumped to `LEDGER_THRESHOLD`/`LEDGER_BUMP` on writes and reads.
Temporary tip-cooldown keys use the same lifecycle helpers in temporary storage.

### Contract Error Codes

`ContractError` codes are stable client-facing identifiers. A triggering example is the
smallest call sequence that should be treated as that error class by clients. Some current
validation paths still panic with a string message; map those messages to the closest code
below until they are migrated to typed errors.

| Code | Variant | Triggering example |
| --- | --- | --- |
| 100 | `AlreadyInitialized` | Call `initialize` a second time after the first call sets `INIT`. |
| 101 | `NotInitialized` | Call an admin-only entry point before `initialize`. |
| 102 | `UsernameTaken` | Call `set_profile` with a username already owned by another address. |
| 103 | `UsernameTooShort` | Call `set_profile` with a two-character username. |
| 104 | `UsernameTooLong` | Call `set_profile` with a 33-character username. |
| 105 | `ContentTooLong` | Call `create_post` with 281 characters of content. |
| 106 | `ContentEmpty` | Call `create_post` with an empty content string. |
| 107 | `Blocked` | Call `follow`, `tip_post`, or `like_post` across an existing block edge. |
| 108 | `NotBlocked` | Call `unblock_user` for a user who was never blocked. |
| 109 | `Unauthorized` | Call a permission-gated entry point without its generic caller permission. |
| 110 | `PostNotFound` | Call `get_post` with an ID that has no `Post` record. |
| 111 | `ProfileNotFound` | Call a profile-dependent entry point for an address with no profile. |
| 112 | `PoolNotFound` | Call `pool_deposit` with an unregistered pool symbol. |
| 113 | `PoolExists` | Call `create_pool` twice with the same symbol. |
| 114 | `InvalidThreshold` | Call `create_pool` with threshold `0` or `3` for two admins. |
| 115 | `InsufficientSigners` | Call `pool_withdraw` with one signer when the pool threshold is two. |
| 116 | `UnauthorizedSigner` | Include an address outside the pool admin set in `pool_withdraw`. |
| 117 | `LowBalance` | Withdraw more from a pool than its token balance. |
| 118 | `WrongToken` | Deposit a token that does not match the pool's registered token. |
| 119 | `AlreadyPaused` | Pause a module that is already paused. |
| 120 | `NotPaused` | Unpause a module that is running. |
| 121 | `ContractPaused` | Call an entry point whose module pause flag is set. |
| 122 | `AlreadyFollowing` | Call `follow` twice for the same follower/followee pair. |
| 123 | `NotFollowing` | Call `unfollow` when no follow edge exists. |
| 124 | `SelfInteractionNotAllowed` | Like, tip, or follow your own post or address. |
| 125 | `InvalidAmount` | Tip with amount `0` or an amount above the protocol maximum. |
| 126 | `TipCooldownActive` | Tip the same post again before the tipper cooldown ledger passes. |
| 127 | `InvalidCooldown` | Configure a governance or tip cooldown outside its allowed range. |
| 128 | `GraphEntryExpired` | Traverse a follow-graph edge whose TTL lapsed before it was bumped. |
| 129 | `UnauthorizedRole` | Call `register_oracle` as an address without `Role::Admin`. |
| 130 | `PoolAdminNotFound` | Remove an address that is not in the pool admin list. |
| 131 | `PoolAdminExists` | Add an address already present in the pool admin list. |
| 132 | `ProposalNotFound` | Call `gov_vote` with an unused proposal ID. |
| 133 | `ProposalExpired` | Vote or execute after the proposal's vote window closes. |
| 134 | `TimeLockNotExpired` | Execute before `created_ledger + vote_window + time_lock`. |
| 135 | `QuorumNotMet` | Execute a proposal with one approval and two rejections at 60% quorum. |
| 136 | `AlreadyVoted` | Call `gov_vote` twice from the same voter on one proposal. |
| 137 | `ReportNotFound` | Resolve a post/reporter pair with no stored report. |
| 138 | `InvalidVerdict` | Resolve a report with `ReportStatus::Pending`. |
| 139 | `InvalidPostId` | Call a post entry point with ID `0`. |
| 140 | `ZeroAddress` | Pass the all-zero account or contract address to a validator. |
| 141 | `CannotRemoveLastAdmin` | Revoke `Role::Admin` from the final admin. |
| 142 | `CannotRemoveLastUpgrader` | Revoke `Role::Upgrader` from the final upgrader. |
| 143 | `MathOverflow` | Convert or multiply an amount past the `i128`/`u32` protocol bound. |

`RentError::Expired` (code `1`) is reserved for the storage-rent guard path when an entry's
TTL lapsed before it could be bumped.

## 1. Stellar HTTP Authentication (v1)

Protected endpoints authenticate the caller by an Ed25519 signature over a message derived
from the request itself. The signature commits to the HTTP method, the request path, and a
hash of the request body, so a credential captured on one endpoint cannot be replayed
against another.

The canonical implementation lives in `packages/types/src/auth.ts` (`buildAuthMessage`,
`canonicalizeAuthPath`) and is shared by the verifier and the first-party clients. External
integrators should implement the format below directly — see the
[migration guide](./MIGRATION_AUTH_V1.md) for a self-contained reference implementation.

### Why the `v1:` prefix

The message begins with a version tag so the scheme can be rotated without a flag day. A
future `v2:` can add fields (a nonce, header binding, the query string) while a server
accepts both prefixes during a transition window, routing each credential to the verifier
that matches its tag. Without the prefix, any change to the layout would require every
client and every server to cut over in the same instant.

The prefix is part of the signed bytes, so it cannot be swapped by an attacker to downgrade
a v2 credential into a v1 one.

---

## 3. The Signed Message

```
v1:{METHOD}:{canonicalPath}:{address}:{timestamp}:{bodyHash}
```

| Field           | Description                                                                |
| --------------- | -------------------------------------------------------------------------- |
| `v1`            | Literal version tag.                                                       |
| `METHOD`        | HTTP method, **upper-cased**: `GET`, `POST`, `PATCH`, `DELETE`.            |
| `canonicalPath` | Request path after canonicalisation — see [§4](#4-canonical-path).         |
| `address`       | Signer's Stellar public key (`G…`), exactly as sent in the header payload. |
| `timestamp`     | Unix epoch in **milliseconds**, as an integer with no separators.          |
| `bodyHash`      | Lowercase hex SHA-256 of the raw body — see [§5](#5-body-hash).            |

Fields are joined with a literal `:`. No field is escaped or length-prefixed. A path _can_
legitimately contain a `:` (`/api/items:batchGet` is a valid URL), so the message is not
unambiguous by construction — it is unambiguous because the last three fields have fixed
shapes (a 56-character base32 address, digits, 64 hex characters), which lets the suffix be
read unambiguously from the right no matter what the path contains.

What gets signed is the **SHA-256 digest of this message**, not the message itself:

```
signature = Ed25519_sign(privateKey, SHA256(message))
```

The digest is signed as 32 raw bytes. The signature is the raw 64-byte Ed25519 output,
base64-encoded for transport.

> **Wallet signers do not do this today.** The rule above is what the server verifies, and it
> is what a signer holding the key directly (`Keypair.sign`) produces. Browser wallets are a
> different matter: Freighter's `signBlob` treats its argument as an opaque **message**, wraps
> it in the SEP-0053 envelope and signs `SHA256("Stellar Signed Message:\n" + blob)` — never
> the 32 raw bytes. It also returns a `Buffer`, not the base64 string its TypeScript signature
> promises. Both facts are verified against a real Freighter 2.0.0 signature. Consequently the
> first-party browser client **does not currently interoperate with this server**, and
> reconciling the two is an open decision, not something this document describes as settled.
> If you sign with a wallet, expect the envelope; if you sign with a library, follow the rule
> above.

---

## 4. Canonical Path

The server canonicalises `req.originalUrl`, which always carries the **full path including
any router mount prefix**. Clients must sign the same absolute path.

The rule, in order:

1. Drop everything from the first `?` onward.
2. Strip all trailing `/`.
3. If the result is empty, use `/`.

| Raw path                 | Canonical path  |
| ------------------------ | --------------- |
| `/api/follows`           | `/api/follows`  |
| `/api/follows/`          | `/api/follows`  |
| `/api/follows//`         | `/api/follows`  |
| `/api/follows?cursor=5`  | `/api/follows`  |
| `/api/follows/?cursor=5` | `/api/follows`  |
| `/`                      | `/`             |
| `//`                     | `/`             |
| `/api//follows`          | `/api//follows` |

Two consequences worth internalising:

- Sign `/api/notifications/preferences`, never the router-relative `/preferences`. Signing
  the relative path produces a different message and the request comes back `401`.
- If your base URL carries a path segment of its own (`https://example.com/indexer`), that
  segment reaches the server as part of `req.originalUrl` but never appears in the path you
  passed to the signer. Keep the base URL an origin only, or include the prefix in the
  signed path.

---

## 5. Body Hash

`bodyHash` is the lowercase hex SHA-256 of the **exact bytes** sent as the request body.

When there is no body, hash the empty string:

```
SHA256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

This is the value used for every `GET`, and for any request sent without a body. The server
reaches the same value either way: a request with no JSON content type never triggers
body-parser's `verify` hook and its absent raw body is hashed as empty, while a JSON request
with an empty body triggers the hook with a zero-length buffer, which hashes to the same
digest.

> **Hash the bytes you send, not the object you serialised.** Serialise once into a
> variable, then use that same variable for both the hash and the request body. Serialising
> separately for each can yield different bytes — key order, whitespace, number
> formatting — and the signature would then commit to a body that was never sent, producing
> a `401` that is very hard to read.

---

## 6. The Authorization Header

```
Authorization: StellarSig <base64(JSON)>
```

The base64 payload decodes to a JSON object with exactly these three fields:

```json
{
  "address": "G...",
  "timestamp": 1735689600000,
  "signature": "<base64 of the raw 64-byte Ed25519 signature>"
}
```

The header value is the literal `StellarSig`, one space, then the base64 payload. The parser
splits on a single space and rejects anything else, so the payload must not contain spaces.

`address` and `timestamp` are sent in the clear **and** covered by the signature — the
server uses the transmitted values to rebuild the message, then checks the signature against
it. Tampering with either produces a message that no longer verifies.

---

## 7. Verification Order and Error Codes

The server checks in this order and returns on the first failure:

| Order | Check                                 | Status | Code                  |
| ----- | ------------------------------------- | ------ | --------------------- |
| 1     | Header present, parsable, all fields  | `400`  | `INVALID_AUTH_HEADER` |
| 2     | `timestamp` is not in the future      | `403`  | `INVALID_TIMESTAMP`   |
| 3     | `timestamp` is at most 30 s old       | `403`  | `EXPIRED_TIMESTAMP`   |
| 4     | Signature matches the rebuilt message | `401`  | `INVALID_SIGNATURE`   |

Errors carry the shape:

```json
{
  "error": {
    "code": "INVALID_SIGNATURE",
    "message": "Invalid signature",
    "requestId": "..."
  }
}
```

**The order matters when diagnosing a replay.** Timestamp checks run before the signature
check, so an expired credential returns `403` regardless of which path it is presented at —
you will not see the `401` that a wrong path would otherwise produce. A credential replayed
against a different path _within_ the tolerance window is what yields `401`.

The tolerance is 30 000 ms, defined by `SIGNATURE_TIMESTAMP_TOLERANCE_MS` in
`services/indexer/src/middleware/stellarAuth.ts`. Clock skew between client and server eats
directly into this budget; a client running more than 30 s fast is rejected outright as
`INVALID_TIMESTAMP`.

---

## 8. Worked Example

Every value below is reproducible — the keypair is seeded with 32 bytes of `0x07`.

```
address     GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57
method      POST
path        /api/follows
timestamp   1735689600000
body        {"followee":"GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H"}
```

Step 1 — hash the body:

```
bodyHash = 420fe3b7b804bb866cbfeb113d913ba1543099424aed7694297cc3f042ee29a9
```

Step 2 — build the message:

```
v1:POST:/api/follows:GDVEU3DD4KOFECV66VIHWEZOYX4ZKR3WV27L464SIIPOU2IUI3JCZA57:1735689600000:420fe3b7b804bb866cbfeb113d913ba1543099424aed7694297cc3f042ee29a9
```

Step 3 — digest it (base64, for inspection):

```
1bWsu8SkJG10Q5vEoWQZdo3ZIbseNrILzJmuOsP2VyM=
```

Step 4 — sign the digest and base64 the signature:

```
evOK1CFjMZSTvHtuXrxhDVImMQi9JByqzurli1avrRrEPyjvhhQHYwyAmJLvicSAgHEnOte0qXFBlafhOHjtAw==
```

Step 5 — assemble the header:

```
Authorization: StellarSig eyJhZGRyZXNzIjoiR0RWRVUzREQ0S09GRUNWNjZWSUhXRVpPWVg0WktSM1dWMjdMNDY0U0lJUE9VMklVSTNKQ1pBNTciLCJ0aW1lc3RhbXAiOjE3MzU2ODk2MDAwMDAsInNpZ25hdHVyZSI6ImV2T0sxQ0ZqTVpTVHZIdHVYcnhoRFZJbU1RaTlKQnlxenVybGkxYXZyUnJFUHlqdmhoUUhZd3lBbUpMdmljU0FnSEVuT3RlMHFYRkJsYWZoT0hqdEF3PT0ifQ==
```

Note that this example's timestamp is long past, so replaying it against a live server
returns `403 EXPIRED_TIMESTAMP`. It is for verifying your message construction, not for
testing a live endpoint.

---

## 9. Protected Endpoints

| Method | Path                             | Body |
| ------ | -------------------------------- | ---- |
| `POST` | `/api/notifications/register`    | JSON |
| `POST` | `/api/notifications/deregister`  | JSON |
| `GET`  | `/api/notifications/preferences` | none |
| `POST` | `/api/notifications/preferences` | JSON |
| `POST` | `/api/messages`                  | JSON |

All other indexer endpoints are public reads and take no `Authorization` header.

---

## 10. Known Limitations of v1

The signature covers the method, the canonical path, and the body. Everything else about the
request — headers, query string, transport — is outside it. Three consequences deserve to be
stated plainly.

### 10.1 The query string is not signed

Canonicalisation strips everything after `?` before signing, so query parameters are **not**
authenticated. A credential captured for `/api/posts?limit=10` is equally valid for
`/api/posts?limit=1000` within the tolerance window.

No currently protected endpoint reads query parameters, so there is nothing to tamper with
today. That is a property of the current route set, not a guarantee of the scheme — **do not
add a query parameter to a protected endpoint** without moving it into the body or extending
the scheme to `v2`.

### 10.2 There is no nonce — identical replay stays possible

The scheme binds a credential to _a_ request shape, not to _one_ delivery of it. Anyone who
observes a request can resend it byte-for-byte — same method, same path, same body — and it
will be accepted until the 30-second window closes. For a non-idempotent endpoint that means
the action happens twice.

The window is the only bound. Defending against identical replay needs a nonce carried in
the signed message plus server-side storage of spent nonces for at least the tolerance
period, which v1 does not have. Until then, TLS is what stands between an observer and a
replayable credential: **these endpoints must not be served over plaintext HTTP.**

### 10.3 A non-JSON body would go unsigned

The server captures the raw body through `express.json({ verify })`, and body-parser only
invokes that hook when the request's `Content-Type` is JSON. For any other content type the
raw body is never captured, `bodyHash` falls back to the hash of the empty string, and the
body travels **entirely outside the signature** — a `multipart/form-data` upload on a
protected route would be freely tamperable while the request still verifies.

Every protected endpoint is JSON-only today, so this is latent rather than live. It becomes a
live vulnerability the moment a protected route accepts another content type. **Any new
protected endpoint must be JSON**, or the raw-body capture in
`services/indexer/src/middleware/rawBody.ts` must be widened to cover its content type first.
