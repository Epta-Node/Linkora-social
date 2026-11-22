# Analytics oracle design

`services/analytics-oracle` computes per-creator analytics over a window of
ledgers, signs each result with an Ed25519 oracle key, and submits it on chain
to `verify_analytics_attestation` in the Linkora contract. It also serves the
signed attestations over HTTP, so clients can check them without re-reading the
chain.

This document covers the attestation flow, signing key management and rotation,
submission retries, caching, and rate limiting. It also lists open issues found
while writing it (section 10). Read that section before relying on the oracle in
a deployment.

Related code:

- `services/analytics-oracle/src/index.ts`: the scheduler and HTTP app
- `services/analytics-oracle/src/db.ts`: creator statistics query
- `services/analytics-oracle/src/codec.ts`: report encoding and hashing
- `services/analytics-oracle/src/signer.ts`, `src/secrets.ts`: signing key
- `services/analytics-oracle/src/submitter.ts`: transaction submission and retries
- `services/analytics-oracle/src/attestation-cache.ts`: attestation cache
- `services/analytics-oracle/src/middleware/rate-limiter.ts`: rate limiting
- `services/analytics-oracle/src/routes/admin.ts`: key rotation and manual attest
- `packages/contracts/contracts/linkora-contracts/src/lib.rs`: on-chain verification

---

## 1. Roles

| Party          | Responsibility                                                       |
| -------------- | -------------------------------------------------------------------- |
| Oracle service | Computes stats, signs reports, submits attestations, serves results  |
| Contract       | Holds each oracle's public key, checks signatures, prevents replays  |
| Operator       | Owns the key material, the admin secret, and the on-chain admin role |
| Client         | Reads `GET /attestations/:creator` and can verify the signature      |

The contract is the authority. An attestation counts only once the contract
accepts it. The HTTP cache is a convenience for clients.

---

## 2. Attestation generation flow

### 2.1 Scheduler

On startup the oracle does one tick immediately, then one tick every
`WINDOW_LEDGERS × 5000` ms. With the default `WINDOW_LEDGERS=1000`, that is one
tick every 5000 seconds (about 83 minutes).

Each tick:

1. Reads the latest ledger sequence `currentLedger` from Soroban RPC.
2. Sets the window:
   - `windowStart = currentLedger − WINDOW_LEDGERS` on the first run, or
     `lastWindowEnd + 1` afterwards;
   - `windowEnd = currentLedger`.
3. If `windowEnd <= windowStart`, does nothing.
4. Runs `runWindow(windowStart, windowEnd)`, with up to three attempts
   (section 6).
5. On success, sets `lastWindowEnd = windowEnd`. On failure, leaves it unchanged
   so the next tick retries the same window start.

Shutdown waits for the tick in flight (section 9).

### 2.2 Computing the report

`runWindow` calls `fetchCreatorStats(db, windowStart, windowEnd)`. The query
groups by post author (`p.author`) over posts created in the window:

| Field           | Source                                                       |
| --------------- | ------------------------------------------------------------ |
| `totalTips`     | `SUM(tips.amount)` over the author's posts                   |
| `postCount`     | `COUNT(DISTINCT posts.id)`                                   |
| `followerDelta` | Follows of the author whose `created_at` falls in the window |
| `uniqueTippers` | `COUNT(DISTINCT tips.tipper)`                                |

If the query returns no creators, the window is skipped without error.

For each creator the oracle:

1. Converts the Stellar address to its 32-byte raw public key. An invalid address
   is logged and skipped.
2. Builds the report:

   ```text
   { version: 1, creator, windowStart, windowEnd, totalTips, postCount,
     followerDelta, uniqueTippers }
   ```

3. Encodes it as CBOR (`encodeReport` in `codec.ts`).
4. Computes `reportHash = SHA-256(reportCbor)`.
5. Signs the hash: `signature = Ed25519.sign(reportHash, seed)`, 64 bytes.
6. Submits the attestation (section 6).
7. On a confirmed submission, stores the result in the attestation cache (section 7).

The contract recomputes `sha256(report_cbor)` and checks the signature against the
registered public key for `oracle_name`.

### 2.3 Submitting the transaction

`submitAttestation` builds a transaction that calls
`verify_analytics_attestation(oracle_name, report_cbor, signature, creator,
window_start, window_end)`:

1. Fetches the oracle account from RPC, to get the sequence number.
2. Builds the transaction with fee `1000` stroops and a 30-second timeout.
3. Simulates it. A simulation error is thrown immediately as a non-transient
   error, because the transaction is invalid and retrying cannot help.
4. Summarizes the ledger footprint and logs a warning if it grew since the last
   successful attestation.
5. Assembles the transaction from the simulation result, signs it with the oracle
   Stellar key, and calls `sendTransaction`.
6. Polls with `pollTransaction` for up to 10 attempts. It counts as confirmed only
   when the final status is `SUCCESS`. A transaction that is accepted but never
   lands on chain is an error.

The same seed is used for two things. It is the Ed25519 key that signs reports
(`signReport`), and it is the Stellar account that signs and pays for the
transaction envelope (`Signer.keypair()`, built from the same bytes with
`Keypair.fromRawEd25519Seed`). The on-chain oracle key and the oracle's Stellar
account are therefore one key. Protect it accordingly, and note that rotating it
(section 3.3) also rotates the account that pays fees.

---

## 3. Signing key management

### 3.1 Sources

`SECRETS` selects the keystore (`src/secrets.ts`):

| Value                                  | Behavior                                                                        | Rotation at runtime |
| -------------------------------------- | ------------------------------------------------------------------------------- | ------------------- |
| `file:///path/to/oracle-key.hex`       | Reads a 64-hex-character seed from a file. Trailing whitespace is stripped.     | Supported           |
| `env:ORACLE_PRIVATE_KEY_HEX` (default) | Reads the same format from an environment variable. For local development only. | Refused             |

The file form works with Docker secrets, Kubernetes secret volumes, and secret
managers that mount into a file. Use it in production. Rotation through the admin
API is refused for the env form, because `process.env` cannot change inside a
running process. Refusing is deliberate. A rotation that reports success while
changing nothing would convince an operator that a compromised key is gone.

### 3.2 In-memory handling

- At startup the seed is loaded from the keystore, given to a `Signer`, and the
  keystore's own copy is zeroed. The `Signer` keeps a private copy.
- The signer exposes the public key, its fingerprint, signing, and the Stellar
  `Keypair` used for transactions. The `Keypair` holds the same secret, so code
  that receives it must not log it. The seed itself is never logged.
- The fingerprint is the hex-encoded 32-byte public key. The logs use it, not the
  seed.
- On shutdown, `Signer.dispose()` zeroes the seed.

Zeroing a JavaScript buffer reduces exposure but does not remove copies made by
the runtime. Treat the process memory as sensitive.

### 3.3 Rotation

`POST /admin/rotate-key` with `Authorization: Bearer <ADMIN_SECRET>`:

1. Checks the admin secret with a constant-time comparison. If `ADMIN_SECRET` is
   unset, the route returns `500` and does nothing.
2. Refuses with `400 ROTATION_UNSUPPORTED` if the keystore is not file-backed.
3. Reloads the seed from the file.
4. Calls `Signer.rotate(newSeed)`, which swaps the seed and zeroes the old one.
5. Returns `409 ROTATION_NOOP` if the new fingerprint equals the old one, so a
   stale mount is not reported as a rotation.
6. Clears the attestation cache for the new fingerprint.
7. Returns `200` with `{ oldFingerprint, newFingerprint, source }`.

**Rotation does not update the on-chain key.** The contract verifies signatures
against the key registered for the oracle name, and only the admin can change
it. After a successful rotation, the operator must register the new key:

```text
register_oracle(admin, oracle_name, new_public_key_32_bytes)
```

Until that call confirms, attestations signed with the new key fail the
contract's signature check, and attestations signed with the old key still pass
only if the contract still has the old key registered.

Recommended order for a planned rotation:

1. Write the new seed to the secret source.
2. Call `register_oracle` with the new public key. Confirm it on chain.
3. Call `POST /admin/rotate-key`. Confirm the new fingerprint in the response.
4. Check the next attestation succeeds on chain.

For a suspected compromise, do step 2 as soon as possible. The contract's key
change is the control that stops forged attestations.

### 3.4 Manual attestation

`POST /admin/attest` with the same bearer secret takes
`{ creator, windowStart, windowEnd }`, where the window values are decimal
strings. It runs one creator through the same report, sign and submit path. It
returns `{ txHash }`, `404 CREATOR_NOT_FOUND` if the creator has no stats in the
window, or `502` if submission fails.

---

## 4. HTTP API

| Method | Path                                      | Auth           | Purpose                                                            |
| ------ | ----------------------------------------- | -------------- | ------------------------------------------------------------------ |
| `GET`  | `/attestations/:creator`                  | Rate limited   | Latest cached attestation for a creator                            |
| `GET`  | `/analytics/creators/:accountId/earnings` | Rate limited   | Creator earnings view from the database (see `routes/earnings.ts`) |
| `GET`  | `/metrics/cache`                          | Rate limited   | Cache hit, miss and eviction counters                              |
| `POST` | `/admin/rotate-key`                       | `ADMIN_SECRET` | Rotate the signing key (section 3.3)                               |
| `POST` | `/admin/attest`                           | `ADMIN_SECRET` | Submit one attestation (section 3.4)                               |
| `GET`  | `/health`, `/health/*`                    | None           | Liveness, readiness and startup probes; not rate limited           |

`GET /attestations/:creator` returns, when present:

```json
{
  "oracleName": "analytics",
  "signerKey": "<public key hex>",
  "keyVersion": 1,
  "rotationEpoch": 1,
  "reportHash": "<hex>",
  "reportCbor": "<hex>",
  "signature": "<hex>",
  "txHash": "<hex>",
  "submittedAt": 1729320000000,
  "report": {
    "version": 1,
    "creator": "<hex>",
    "windowStart": "...",
    "windowEnd": "...",
    "totalTips": "...",
    "postCount": "...",
    "followerDelta": "...",
    "uniqueTippers": 0
  }
}
```

A client can check the attestation without trusting the oracle. It recomputes
`SHA-256(reportCbor)`, checks it against `reportHash`, and verifies `signature`
against `signerKey`. It should also confirm `signerKey` against the key the
contract has registered, and that `txHash` is a successful on-chain transaction.
An unknown creator, or one with no attestation in the current cache, returns `404`.

---

## 5. Submission retries

There are two retry layers.

### 5.1 Transaction level (`withRetry` in `submitter.ts`)

- Up to 3 retries after the first attempt, so 4 attempts in total.
- Backoff doubles from a 1 s base: 1 s, 2 s, 4 s.
- Each attempt rebuilds the transaction from a fresh account sequence and
  re-simulates, so a stale sequence number or footprint does not carry over.
- Only transient errors are retried. These are network errors (`ECONNRESET`,
  `ETIMEDOUT`, and similar), HTTP `5xx` responses, and messages that mention a
  timeout or network failure. Simulation errors and anything not recognized are
  not retried.

### 5.2 Window level (`scheduleLoop`)

- Up to 3 attempts per tick, with backoff of 100 ms then 200 ms.
- If any creator in the window fails to get a confirmed submission, `runWindow`
  throws and the attempt is retried. After the third failure, `lastWindowEnd` is
  not advanced and the error is thrown out of the tick. The next tick tries the
  same window start again, with a newer `windowEnd`.

Creators whose submission failed are collected. They do not stop the rest of the
window from being processed.

### 5.3 Interaction to be aware of

Window-level retries re-run every creator in the window, not only the failed
ones, and within one tick `windowEnd` does not change. The contract rejects a
report whose hash it has already accepted (`attestation already submitted`).
Creators confirmed in the first attempt therefore fail again on the retry, and
that failure is a simulation error, which is not retried. See section 10.

---

## 6. Caching strategy

Attestations are cached in `AttestationCache`, a bounded LRU with a per-entry TTL.

| Setting            | Default            | Env var                               |
| ------------------ | ------------------ | ------------------------------------- |
| Max entries        | `10000`            | `ATTESTATION_CACHE_MAX_SIZE`          |
| Entry TTL          | `3600000` ms (1 h) | `ATTESTATION_CACHE_TTL_MS`            |
| Stats log interval | `300000` ms        | `ATTESTATION_CACHE_STATS_INTERVAL_MS` |

Eviction happens in three ways:

1. **TTL.** Entries older than the TTL are treated as misses and removed on
   access. A background sweep runs every `max(TTL / 4, 5 minutes)`.
2. **LRU.** When the cache is full, the least recently used entry is removed.
3. **Invalidation.** The whole cache is cleared when:
   - the signing key changes (`setSignerId`, on rotation);
   - the window changes (`beginWindow`, at the start of each tick).

In practice the window invalidation matters most. `windowEnd` is the latest ledger, so
it changes on every tick, and the cache is emptied then and refilled with
attestations from the new window. An entry therefore lives for one tick, which
is much shorter than the 1-hour TTL. The TTL acts as a backstop. It is not what
limits staleness in normal operation.

Each entry stores the signature, report bytes, report hash, transaction hash and
the key fingerprint, so a cache hit returns the same material the chain accepted.

`GET /metrics/cache` reports hits, misses, evictions, size and the configured
limits. The stats are also logged every 5 minutes.

Creators with no attestation in the current window get `404`, even if an earlier
attestation exists on chain. Clients that need history should read the chain or a
database, not this cache.

---

## 7. Rate limiting

Implemented in `middleware/rate-limiter.ts`. It is a sliding window per key.

| Setting                     | Default     | Env var                                          |
| --------------------------- | ----------- | ------------------------------------------------ |
| Window                      | `60000` ms  | `ORACLE_RATE_LIMIT_WINDOW_MS`                    |
| Requests per key per window | `10`        | `ORACLE_RATE_LIMIT_MAX_REQUESTS`                 |
| Bypass list                 | empty       | `ORACLE_RATE_LIMIT_BYPASS_IPS` (comma-separated) |
| In-memory key cap           | `100000`    | `ORACLE_RATE_LIMIT_MAX_ENTRIES`                  |
| In-memory sweep interval    | `300000` ms | `ORACLE_RATE_LIMIT_CLEANUP_INTERVAL_MS`          |
| Shared store                | unset       | `REDIS_URL`                                      |

- **Key.** The client IP, from `getClientIP`. `X-Forwarded-For` is honored only
  when the direct peer is in `TRUSTED_PROXIES`. The default trusted ranges are
  loopback and RFC 1918. Set `TRUSTED_PROXIES` to your load balancer's range in
  production, so clients cannot choose their own IP.
- **Scope.** The limiter is mounted globally after the health router. It covers
  `/attestations`, `/analytics`, `/metrics` and the admin routes. Health probes
  are not limited.
- **Response.** `429` with `Retry-After` in seconds and a `RATE_LIMITED` error
  code.
- **Store.** With `REDIS_URL`, state is a sorted set per key in Redis, updated
  with one `MULTI`/`EXEC` pipeline per request, so all replicas share one
  counter. Without it, each process has its own counter and the effective limit
  is multiplied by the replica count. `NODE_ENV=production` requires `REDIS_URL`
  unless `ALLOW_IN_MEMORY_RATE_LIMIT` is set.
- **Memory.** The in-memory store is bounded by the key cap, evicts the least
  recently used key when full, and removes expired keys on a timer.

`/health` reports the active store as `{ store, shared }`, so an operator can
see whether limits are shared.

---

## 8. Configuration

| Variable                                                                                               | Default                      | Purpose                                                                         |
| ------------------------------------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                         | required                     | Source of creator statistics                                                    |
| `SOROBAN_RPC_URL`                                                                                      | required                     | Ledger polling and transaction submission                                       |
| `CONTRACT_ID`                                                                                          | required                     | Linkora contract address                                                        |
| `ORACLE_NAME`                                                                                          | `default`                    | Symbol the contract stores the key under. Must match the `register_oracle` name |
| `NETWORK_PASSPHRASE`                                                                                   | Test SDF Network             | Must match the RPC network                                                      |
| `WINDOW_LEDGERS`                                                                                       | `1000`                       | Ledgers per window, and tick interval (× 5 s)                                   |
| `PORT`                                                                                                 | `4000`                       | HTTP port                                                                       |
| `SECRETS`                                                                                              | `env:ORACLE_PRIVATE_KEY_HEX` | Keystore source (section 3.1)                                                   |
| `ADMIN_SECRET`                                                                                         | unset                        | Bearer token for admin routes. Admin disabled if unset                          |
| `REDIS_URL`                                                                                            | unset                        | Shared rate-limit store                                                         |
| `ALLOW_IN_MEMORY_RATE_LIMIT`                                                                           | unset                        | Opt-out for single-replica production                                           |
| `TRUSTED_PROXIES`                                                                                      | loopback and RFC 1918        | Proxy ranges allowed to set `X-Forwarded-For`                                   |
| `SHUTDOWN_DRAIN_TIMEOUT_MS`                                                                            | `30000`                      | Drain window before forced exit                                                 |
| `DB_POOL_MAX`, `DB_POOL_IDLE_TIMEOUT_MS`, `DB_POOL_CONNECTION_TIMEOUT_MS`, `DB_POOL_STATS_INTERVAL_MS` | `20`, `10000`, `5000`, `0`   | PostgreSQL pool                                                                 |
| Cache and rate-limit variables                                                                         | see sections 5 and 7         |                                                                                 |

Source of truth: `services/analytics-oracle/src/config.ts`, `src/index.ts`, and
`.env.example`.

---

## 9. Shutdown

On `SIGTERM` or `SIGINT`:

1. Stop the stats log and the poll timer, so no new tick starts.
2. Stop accepting HTTP connections and drain existing ones.
3. Wait for the in-flight tick to finish. A submission already sent to the
   network is allowed to complete.
4. Close the database pool.
5. Dispose the signer, which zeroes the seed.
6. Exit `0`.

A forced exit with code `1` happens after `SHUTDOWN_DRAIN_TIMEOUT_MS`. During
shutdown the readiness probe fails, so the load balancer stops routing to the
instance.

---

## 10. Open issues

These were found while writing this document. Each is stated as an observation
from the code. Confirm it against a testnet deployment before acting on it.

**10.1 Units of the window.** The oracle sets `windowStart` and `windowEnd` from
ledger sequence numbers (`info.sequence`). The contract checks the window against
the ledger's timestamp: `attestation outside time window` asserts that
`ledger.timestamp()` is between `window_start` and `window_end`. The contract's own
tests use timestamps (`set_timestamp(500)` with window `100..600`). If the oracle
passes sequence numbers, the current timestamp (about 1.7 × 10⁹) is far larger
than any realistic sequence number, so the upper bound check should fail. Confirm this,
then either convert the oracle to timestamps or change the contract's check.

**10.2 Retries re-submit confirmed creators.** Section 5.3. Within one tick the
window end is fixed, so a retry of a partly failed window resubmits identical
reports for creators already confirmed. The contract's nullifier rejects them. A
retry can therefore fail for reasons unrelated to the current attempt. A fix
would track confirmed creators per window and skip them on retry.

**10.3 Rotation is not atomic with the chain.** Section 3.3. A successful
`/admin/rotate-key` does not change the on-chain key. Until `register_oracle` runs,
the oracle signs with a key the contract does not accept. Operators need to be
told to do both steps. A check that compares the signer fingerprint with the
registered key before submitting would catch the gap.

**10.4 Cache lifetime is set by ticks.** Section 6. The 1-hour TTL is rarely the
limit. The cache is emptied at every tick.

**10.5 Single-process key handling.** The seed is held in process memory for the
life of the process. There is no HSM or remote signer. Compromise of the process
means compromise of the key.

---

## 11. Operational checklist

- [ ] `SECRETS` points at a file, not an env var.
- [ ] `ADMIN_SECRET` is set from a secret manager, and is high-entropy.
- [ ] `REDIS_URL` is set if more than one replica runs.
- [ ] `TRUSTED_PROXIES` lists only the load balancer's range.
- [ ] `ORACLE_NAME` matches the name used in `register_oracle`.
- [ ] The oracle's public key is registered on chain and the fingerprint matches
      `/health` or the first `Oracle starting` log line.
- [ ] Open issue 10.1 is resolved for the deployed contract version.
