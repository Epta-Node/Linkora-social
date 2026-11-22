# DM relay design

This document describes how `services/dm-relay` works: the WebSocket protocol,
how requests are authenticated, how messages are stored and fetched, how
retries are made idempotent, and how rate limits are applied. It describes the
production path, `src/server.ts` with `src/routes.ts`, which is the image the
Dockerfile runs.

For the cryptographic specification (key agreement, the conversation key, the
message envelope and receipts), see [`PROTOCOL.md`](./PROTOCOL.md). For the
multi-device model, see [`MULTI-DEVICE.md`](./MULTI-DEVICE.md). This document
covers the service itself.

> **Status.** The design below is the intended behavior. Parts of it are not
> yet compiled into a working `main` build. See section 9, "Current status of
> the implementation", before relying on a particular feature.

---

## 1. Goals and non-goals

**Goals**

- Relay end-to-end encrypted direct messages between Stellar accounts.
- Deliver messages in real time to recipients who are online, over WebSocket.
- Keep messages available for a bounded retention period so offline recipients
  can fetch them over HTTP.
- Make client retries safe, so a retried send never creates a duplicate.
- Authenticate every request and every WebSocket connection with the account's
  Stellar Ed25519 key.

**Non-goals**

- The server never decrypts. It stores and forwards opaque `ciphertext_b64`
  values.
- The server does not keep a permanent archive. Messages are deleted after the
  retention period.
- The server does not replay missed real-time pushes. Clients catch up over
  HTTP.

**Trust model in one line.** The relay can see metadata (sender, recipient,
conversation ID, `message_index`, timestamp, ciphertext size, and when things
happen). It cannot see plaintext or session keys.

---

## 2. Components

| Module                          | Responsibility                                                                |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `src/server.ts`                 | HTTP and WebSocket server, graceful shutdown, mounts routes                   |
| `src/routes.ts`                 | REST routes, WebSocket frame handling, push fan-out, receipts                 |
| `src/routes/health.ts`          | `/health`, `/health/live`, `/health/ready`, `/health/startup`                 |
| `src/auth.ts`                   | Signature verification, replay cache, challenge helpers                       |
| `src/middleware/auth.ts`        | Per-route auth: message signature, address ownership, conversation membership |
| `src/middleware/idempotency.ts` | `X-Idempotency-Key` claim, replay, and conflict detection                     |
| `src/middleware/rateLimit.ts`   | Per-sender and per-conversation rate limiting                                 |
| `src/validation.ts`             | Zod schemas for bodies, queries, and cursors                                  |
| `src/database.ts`               | Storage: messages, idempotency keys, retention deletes                        |
| `src/cleanup.ts`                | Daily cron that runs the retention deletes                                    |
| `src/typing-rate-limit.ts`      | Bounded throttle for typing notifications                                     |
| `src/ws-shutdown.ts`            | Closes live WebSocket connections during shutdown                             |
| `src/migrate.ts`                | Applies `migrations/*.sql` in filename order                                  |

---

## 3. Authentication

Three signed payloads are used. Each is an Ed25519 signature made with the
account's Stellar secret key and verified against the `G...` public key. In
every case the signature is over the SHA-256 digest of a text string, not the
raw string.

### 3.1 Message submission (`POST /api/messages`)

The signed string has this layout:

```text
v2:{recipient}:{message_index}:{timestamp}:{sha256_hex(ciphertext_b64)}
```

- `ciphertext_b64` is hashed as the UTF-8 bytes of the base64 string exactly as
  it appears on the wire, not the decoded bytes.
- The digest is `SHA-256(string)`. The signature is
  `Ed25519.sign(digest)`, encoded as 128 lowercase hex characters, and sent as
  the `signature` field of the body.
- The version prefix `v2` is part of the signed string. Bump it when the layout
  changes, so an old signature is rejected cleanly rather than reinterpreted.

The `ciphertext_b64` hash binds the signature to the payload. A relay operator or
a middlebox cannot swap the ciphertext on a captured request and keep the
original sender's signature.

### 3.2 Address ownership (REST reads and WebSocket handshake)

```text
signed string = "{address}:{timestamp}"
signature     = Ed25519.sign(SHA-256(signed string)), hex
```

- REST reads send it in the header
  `Authorization: Stellar <address> <signature> <timestamp>`. The parser requires
  exactly four space-separated parts.
- The WebSocket handshake sends the same three values as query parameters:
  `address`, `timestamp`, and `signature`.

### 3.3 Freshness and replay

- **Clock skew.** `timestamp` must be within `MAX_TIMESTAMP_SKEW` seconds of the
  server's clock (default 300). Both directions are checked.
- **Replay cache.** Each accepted signature is recorded in an in-process map
  until its skew window passes. A second use of the same signature is rejected
  with `Replayed signature`. This applies to both message submission and
  address-ownership proofs.
- **Limitation.** The replay cache is per process. With several replicas, a
  captured request can be replayed once against each replica within the skew
  window. A shared store (Redis) would close that gap. Until one is wired in,
  treat the replay guard as single-replica protection.

### 3.4 Authorization

- `POST /api/messages`: the body's `sender` is the key the signature is checked
  against. A body that names a `sender` who did not sign it fails verification
  with `401`.
- `GET /api/messages/:address`: the signed address must equal `:address`,
  otherwise `403`.
- `GET /api/messages/conversation/...`: the signed address must be a participant
  in the conversation, meaning it appears as `sender` or `recipient` in at least
  one stored message. A conversation ID alone grants nothing. Anyone can compute
  the ID from two addresses. Unknown conversations return `403`.

---

## 4. REST API

All REST routes are mounted under `/api`. Responses use the shared error
envelope from `@linkora/types`. Success bodies are JSON.

| Method | Path                                                | Auth              | Purpose                                 |
| ------ | --------------------------------------------------- | ----------------- | --------------------------------------- |
| `POST` | `/api/messages`                                     | Message signature | Submit one encrypted message            |
| `GET`  | `/api/messages/:address`                            | Address ownership | Inbox for the recipient                 |
| `GET`  | `/api/messages/conversation/:conversationId`        | Participant       | Messages in one conversation            |
| `GET`  | `/api/messages/conversation/:conversationId/search` | Participant       | Returns messages for client-side search |

Health endpoints sit at the root, outside `/api`: `/health`, `/health/live`,
`/health/ready`, and `/health/startup`. The Dockerfile health check uses
`/health/ready`.

### 4.1 Send

`POST /api/messages`

Headers: `Content-Type: application/json`, `X-Idempotency-Key: <UUID>`.

Body:

```json
{
  "sender": "G...",
  "recipient": "G...",
  "ciphertext_b64": "base64 ChaCha20-Poly1305 output",
  "message_index": 42,
  "timestamp": 1729320000,
  "signature": "<128 hex chars>"
}
```

Validation:

- `sender` and `recipient` must be valid Stellar Ed25519 public keys.
- `ciphertext_b64` is non-empty base64, and its decoded size must be at most
  `MAX_MESSAGE_BYTES` (default 64 KiB).
- `message_index` is an integer from 0 to 2147483647.
- `timestamp` is a positive integer, in seconds.
- `signature` is 64 bytes of hex.

Responses:

| Status | Meaning                                                                                             |
| ------ | --------------------------------------------------------------------------------------------------- |
| `201`  | Stored. Body: `{ success, message_id, conversation_id, ack }`                                       |
| `400`  | Missing or invalid `X-Idempotency-Key`, or a body that fails validation                             |
| `401`  | Signature invalid, timestamp outside skew, or replayed signature                                    |
| `409`  | `message_index` already used for this pair, or the idempotency key was reused with a different body |
| `429`  | Rate limited (see section 7)                                                                        |
| `500`  | Unexpected failure, sanitized                                                                       |

`message_id` is the database ID of the row. `ack` is the same ACK frame the
sender receives over WebSocket, so HTTP-only clients get the same confirmation.

Side effects on `201`:

1. The message is stored (section 5).
2. The message is tracked so receipts can be routed back to the sender for up to
   24 hours (in memory).
3. An `ack` frame goes to the sender's open WebSocket connections, if any.
4. A `new_message` frame goes to the recipient's open WebSocket connections, if
   any. It contains the ciphertext.

### 4.2 Inbox

`GET /api/messages/:address?limit=50&cursor=<token>`

- `limit` is 1 to 100, default 50.
- `cursor` is opaque. It encodes the `(created_at, id)` of the last row on the
  previous page, and the server rejects malformed cursors with `400`.
- Results are newest first, ordered by `(created_at DESC, id DESC)`.
- The response includes `next_cursor` when there are more rows.

The inbox lists rows where `recipient = :address`. Messages the account sent
are not included.

### 4.3 Conversation and search

`GET /api/messages/conversation/:conversationId` takes the same `limit` and
`cursor` parameters and returns messages where `conversation_id` matches,
newest first.

`GET /api/messages/conversation/:conversationId/search?q=...` is a metadata
stub. The server cannot decrypt or index content, so it returns a page of the
conversation's messages with the same envelope as the conversation route, plus
a `search` field that records the design decision. The client decrypts locally
and filters. `q` is 1 to 500 characters, `limit` defaults to 20.

---

## 5. Storage and retrieval

### 5.1 Tables

The production code uses two tables. Both are created by the migrations in
`services/dm-relay/migrations/`, applied in filename order by `src/migrate.ts`.

**`dm_messages`** (`000_dm_messages.sql`)

| Column            | Type               | Notes                                |
| ----------------- | ------------------ | ------------------------------------ |
| `id`              | `UUID` primary key | `gen_random_uuid()`                  |
| `conversation_id` | `VARCHAR(64)`      | `sha256(sorted(A)+sorted(B))`, hex   |
| `sender`          | `VARCHAR(56)`      | Stellar `G...` address               |
| `recipient`       | `VARCHAR(56)`      |                                      |
| `ciphertext_b64`  | `TEXT`             | Opaque to the server                 |
| `message_index`   | `INTEGER`          | Client-chosen counter for the pair   |
| `timestamp`       | `BIGINT`           | Client-supplied, seconds             |
| `created_at`      | `TIMESTAMPTZ`      | Server time. Drives ordering and TTL |

Constraints and indexes:

- `UNIQUE (sender, recipient, message_index)`. A duplicate index for the same
  ordered pair is rejected and surfaces as `409`.
- Indexes on `(conversation_id, created_at DESC)`, `created_at`, and `timestamp`.

**`message_idempotency`** (`001_message_idempotency.sql`, then
`002_scope_idempotency_by_sender.sql`)

| Column                | Notes                                            |
| --------------------- | ------------------------------------------------ |
| `sender_address`      | Primary key part, from the verified signature    |
| `idempotency_key`     | Primary key part, the `X-Idempotency-Key` UUID   |
| `request_fingerprint` | SHA-256 of the canonical JSON request body       |
| `response_status`     | `0` while in progress, otherwise the HTTP status |
| `response_body`       | JSONB response to replay                         |
| `created_at`          | Drives retention                                 |

The primary key is `(sender_address, idempotency_key)`, so two senders who pick
the same key do not collide.

**Legacy tables.** `001_messages.sql` creates `messages` and `idempotency_keys`,
and `index.ts` (a separate prototype entrypoint, described in section 9) uses
`messages`. Production code does not read or write them. Their presence is a
known source of confusion, and they should be dropped once nothing depends on
them.

### 5.2 Write path

`insertMessage` runs one `INSERT` into `dm_messages` and returns the generated
`id`. A unique violation on `(sender, recipient, message_index)` becomes
`Message with this index already exists...`, which maps to `409`.

The `conversation_id` is computed from the two addresses in sorted order, so
both directions of a conversation share one ID:

```text
conversation_id = hex(SHA-256(min(A, B) + max(A, B)))
```

### 5.3 Read path

- Inbox and conversation reads are keyset-paginated on `(created_at, id)`. The
  composite key avoids skipping rows that share a timestamp.
- Participant checks run a single-row `EXISTS`-style query on the conversation
  ID, limited to one result.

### 5.4 Retention

Retention is enforced by a daily cron job in `src/cleanup.ts`, scheduled for
`0 2 * * *` in UTC.

- **Messages.** Rows in `dm_messages` with `created_at` older than
  `MESSAGE_TTL_DAYS` (default `7`) are deleted. Deletes run in batches of 1000
  rows, oldest first, with a 25 ms pause between batches. Batching keeps each
  statement short, so live traffic is not stalled by one long lock.
- **Idempotency keys.** Rows in `message_idempotency` older than
  `IDEMPOTENCY_TTL_HOURS` (default `24`) are deleted with the same batching.

The retention guarantee is therefore "up to `MESSAGE_TTL_DAYS` days, then gone",
not "never persisted". The CHANGELOG's description of the relay as having "zero
message persistence" is out of date: ciphertext is stored for the TTL.

A second purge job exists in `src/jobs/purgeTtl.ts` and is started by the
prototype `src/index.ts`. It deletes from the legacy `messages` table, not
`dm_messages`, so it does not apply retention to production data.

---

## 6. WebSocket protocol

### 6.1 Connecting

```text
wss://<host>/ws?address=<G...>&timestamp=<unix seconds>&signature=<128 hex>
```

The server rejects the handshake in this order, each with a close code:

| Check                                              | Close code | Reason                                    |
| -------------------------------------------------- | ---------- | ----------------------------------------- |
| Per-IP rate limit exceeded                         | `1008`     | `Rate limit exceeded`                     |
| Any of `address`, `timestamp`, `signature` missing | `1008`     | `Missing required query params...`        |
| Per-address reconnect rate limit exceeded          | `1008`     | `Reconnect rate limit exceeded...`        |
| `timestamp` not numeric                            | `1008`     | `Invalid timestamp`                       |
| Address ownership proof fails (section 3.2)        | `1008`     | `Authentication failed`                   |
| Already 5 open connections for this address        | `1008`     | `Maximum connections per address reached` |

The per-IP and per-address reconnect limits are part of the design. Section 9
explains their current status.

After a successful handshake, the socket is registered under the address. An
address may hold up to 5 connections at once. The counts are per process.

The client IP is read from the first entry of `X-Forwarded-For` when present, so
the server must sit behind a proxy that overwrites that header.

### 6.2 Frame size

Frames larger than `MAX_MESSAGE_BYTES` are rejected with close code `1009`
(`Message too large`). The socket's `maxPayload` is set to the same limit.

### 6.3 Server to client

| `type`          | Sent to   | Payload                                                    |
| --------------- | --------- | ---------------------------------------------------------- |
| `new_message`   | Recipient | `{ id, sender, ciphertext_b64, message_index, timestamp }` |
| `ack`           | Sender    | `{ messageId }`. Sent right after the message is stored.   |
| `delivered`     | Sender    | `{ messageId }`. Forwarded from the recipient.             |
| `read`          | Sender    | `{ messageId, readAt }`. Forwarded from the recipient.     |
| `typing_status` | Recipient | `{ sender }`                                               |

Pushes are best effort. They go only to sockets that are open at the moment of
the send. A push is never stored or replayed. A client that was offline, or
whose socket dropped, must fetch missed messages over REST.

### 6.4 Client to server

| `type`          | Fields                              | Effect                                                  |
| --------------- | ----------------------------------- | ------------------------------------------------------- |
| `delivered`     | `messageId`                         | Forwarded to the original sender as a `delivered` frame |
| `read`          | `messageId`, optional `readAt` (ms) | Forwarded as `read`. `readAt` defaults to server time   |
| `typing_status` | `recipient`, optional `sender`      | Pushed to the recipient as `typing_status`              |

Rules:

- `delivered` and `read` need a non-empty string `messageId`. Otherwise the
  frame is dropped and a warning is logged.
- Receipts are routed by the in-memory `messageId → sender` map. A receipt for an
  unknown ID, or for a sender who is not connected, is dropped silently.
- `typing_status` may include `sender`, but it must equal the authenticated
  address. A mismatch is dropped and logged as possible abuse. The recipient
  must be a valid Stellar address.
- Typing notifications are throttled to one per `(sender, recipient)` pair every
  3 seconds. The throttle map is capped at 50,000 pairs.
- Frames that are not valid JSON are ignored without a response.

### 6.5 Closing

On shutdown the server sends close code `1001` to every client, then waits for
the WebSocket server to finish closing before exiting. See section 8.

---

## 7. Rate limiting

There are two layers. Both are keyed per sender or per IP, and both return
`429` with `Retry-After`.

### 7.1 Per-sender and per-conversation (message submission)

| Limit                              | Default     | Env var                                            |
| ---------------------------------- | ----------- | -------------------------------------------------- |
| Messages per sender                | 60 per 60 s | `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`           |
| Messages per `(sender, recipient)` | 20 per 60 s | `CONV_RATE_LIMIT_MAX`, `CONV_RATE_LIMIT_WINDOW_MS` |

The sender limit is checked first. A `429` from it returns code
`RATE_LIMIT_SENDER`. The conversation limit returns `RATE_LIMIT_CONVERSATION`.

The limiter runs after auth, so it keys on the verified sender. The defaults and
env vars above are the ones configured in the prototype `src/index.ts`. The
production route wiring for this limiter is missing from `main`; see section 9.

### 7.2 WebSocket

- Per-IP and per-address reconnect limits (section 6.1), backed by the same
  store as the HTTP limiters.
- Typing throttle (section 6.4).

### 7.3 Shared store

`src/config.ts` requires `REDIS_URL` when `NODE_ENV=production`, unless
`ALLOW_IN_MEMORY_RATE_LIMIT` is set. Without a shared store, each replica counts
separately, so the effective limit is the configured limit times the number of
replicas. The check runs through `resolveRateLimitEnv` in `@linkora/types`.

The in-memory limiter in `middleware/rateLimit.ts` is process local.

---

## 8. Shutdown and in-flight work

`SIGTERM` or `SIGINT` starts a graceful shutdown with these steps:

1. Stop accepting new HTTP connections.
2. Wait for in-flight database writes that were started from WebSocket frames
   (currently, typing notifications, which are counted by `InflightCounter`), up
   to `SHUTDOWN_DRAIN_TIMEOUT_MS` (default 30 s).
3. Send close code `1001` to every WebSocket client and wait for the server to
   close.
4. Stop the cleanup cron, close the rate limiters, close the database pool, and
   exit with code `0`.

A hard timer forces `exit(1)` after the drain timeout plus 5 seconds. Shutdown
is therefore bounded.

---

## 9. Current status of the implementation

This section records what does and does not work on `main` as of this writing.
Check it before you rely on the sections above.

**Does not compile.** `npx tsc --noEmit` in `services/dm-relay` fails:

- `src/routes.ts` declares `CLOSE_MESSAGE_TOO_LARGE`, `TYPING_RATE_LIMIT_*`,
  `wsClients`, `typingRateLimitMap`, and `getTypingRateLimitMapSizeForTests`
  twice. The second block is a copy of the first.
- `src/routes.ts` imports `rateLimitMiddleware` from `./middleware/rateLimit`,
  which does not export it. The file exports only `buildRateLimitMiddleware`.
- `src/server.ts` imports `initRateLimiters`, `closeRateLimiters`,
  `isWsIpRateLimited`, and `isWsAddressRateLimited` from the same module. None of
  them exist there.
- `src/routes/health.ts` imports `getRateLimitStoreStatus` from it as well.

**Two entrypoints.** `Dockerfile` runs `src/server.ts`. `package.json` `dev` and
`main` point at `src/index.ts`, a small prototype that writes to the legacy
`messages` table, applies its own rate limiter, and has no WebSocket server.
Keep the two separate. Production behavior is described by `server.ts` and
`routes.ts`.

**Missing rate-limit wiring.** The WebSocket limiters and the shared-store
initialization are not present in the module the code imports from, so the
design in section 7 is not yet enforced by the production build.

**Unused helpers.** `AuthService.createWsChallenge` and `verifyWsChallenge`
implement a nonce-based challenge. The live handshake uses the timestamp-based
proof in section 3.2 instead.

Fixing these is tracked separately from this document. This document describes
the intended design.

---

## 10. Configuration

| Variable                                                                                               | Default                    | Purpose                                              |
| ------------------------------------------------------------------------------------------------------ | -------------------------- | ---------------------------------------------------- |
| `PORT`                                                                                                 | `3001`                     | HTTP and WebSocket port                              |
| `DATABASE_URL`                                                                                         | required                   | PostgreSQL connection string                         |
| `REDIS_URL`                                                                                            | unset                      | Shared rate-limit store. Required in production      |
| `ALLOW_IN_MEMORY_RATE_LIMIT`                                                                           | unset                      | Explicit opt-out for single-replica production       |
| `CORS_ORIGIN`                                                                                          | `http://localhost:3000`    | Comma-separated allowed origins                      |
| `MESSAGE_TTL_DAYS`                                                                                     | `7`                        | Retention for stored messages                        |
| `IDEMPOTENCY_TTL_HOURS`                                                                                | `24`                       | Retention for idempotency keys                       |
| `MAX_TIMESTAMP_SKEW`                                                                                   | `300`                      | Allowed clock skew for signatures, in seconds        |
| `MAX_MESSAGE_BYTES`                                                                                    | `65536`                    | Max decoded ciphertext size, and max WebSocket frame |
| `STELLAR_NETWORK`                                                                                      | `Testnet`                  | Network label used by the auth service               |
| `SHUTDOWN_DRAIN_TIMEOUT_MS`                                                                            | `30000`                    | Drain window before forced exit                      |
| `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`                                                               | `60`, `60000`              | Per-sender limit (prototype and design)              |
| `CONV_RATE_LIMIT_MAX`, `CONV_RATE_LIMIT_WINDOW_MS`                                                     | `20`, `60000`              | Per-conversation limit (prototype and design)        |
| `DB_POOL_MAX`, `DB_POOL_IDLE_TIMEOUT_MS`, `DB_POOL_CONNECTION_TIMEOUT_MS`, `DB_POOL_STATS_INTERVAL_MS` | `20`, `30000`, `2000`, `0` | PostgreSQL pool tuning                               |

Source of truth: `services/dm-relay/src/config.ts` and `.env.example`.

---

## 11. Known limitations

- **Replay cache is per process** (section 3.3).
- **Pushes are not durable.** A recipient offline at send time gets the message
  only through REST (section 6.3).
- **Metadata is visible to the relay**: who talks to whom, when, how often, and
  how large the messages are.
- **Idempotency caches error responses too.** The idempotency layer stores
  whatever response the handler produces. A `500` produced for a given key is
  replayed for later retries with that key, until the key expires. A request
  that crashes before it responds leaves its key in progress until the key
  expires, and retries get `409` in the meantime.
- **Legacy tables and prototype entrypoint** described in sections 5.1 and 9.
