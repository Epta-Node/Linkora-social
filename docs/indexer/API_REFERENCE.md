# Indexer REST API Reference

This is the human-readable route guide for the Linkora indexer. The machine-readable OpenAPI 3.1 contract is maintained at [`docs/api/indexer.openapi.yaml`](../api/indexer.openapi.yaml); the development Swagger UI is available at `/api/docs` and the raw specification at `/api/openapi.yaml` when `NODE_ENV` is neither `production` nor `test`.

The service defaults to port `3001`. Examples below assume:

```bash
export INDEXER_URL=http://localhost:3001
```

All paths below are relative to the service root. JSON responses use snake_case unless a route's existing contract uses another spelling. Fields marked as examples are illustrative; actual records depend on indexed chain data.

## Authentication and request conventions

- Public read routes accept an optional Stellar signature. When supplied, it is used to identify the caller for per-address rate limiting.
- Routes marked **StellarSig required** reject requests without a valid signed authorization header. Follow the repository's Stellar authentication middleware/client signing flow; do not send a wallet secret to the API.
- Read requests are rate limited. Write requests use the stricter write limiter where noted.
- Query validation is performed with Zod. Invalid values return HTTP 400.
- Cursor values are opaque. Pass the exact `next_cursor` from one response to retrieve the next page; do not construct or edit cursors.
- The route mount table in `services/indexer/src/api/index.ts` is the source for URL prefixes. The OpenAPI contract test checks that mounted routes and documented paths stay aligned.

## Endpoint index

### Health and operations

| Method | Path | Query parameters | Success response |
| --- | --- | --- | --- |
| GET | `/health` | — | `{ status, uptime, version, commit, checks, rateLimiter, backfill }`; 503 when not ready |
| GET | `/health/live` | — | `{ status: "alive", uptime }` |
| GET | `/health/ready` | — | `{ status, degraded, checks }`; 503 when dependencies are not ready |
| GET | `/health/startup` | — | `{ status: "started", startedAt }`; 503 while starting |
| GET | `/metrics` | — | Prometheus text exposition (`text/plain`) |

### Profiles

| Method | Path | Query parameters | Success response |
| --- | --- | --- | --- |
| GET | `/api/profiles` | `limit` (default 20; cursor schema max 100), `cursor` | `{ profiles, limit, cursor, next_cursor, has_more }` |
| GET | `/api/profiles/search` | required `q`; `limit`, `offset` | `{ profiles, total, limit, offset, has_more }` |
| GET | `/api/profiles/{address}` | — | One profile object |

`address` must be a valid Stellar account address. Search matches profile usernames or address fragments.

### Posts and media

| Method | Path | Query parameters | Success response |
| --- | --- | --- | --- |
| GET | `/api/posts` | `author` (optional); `limit`, `cursor` | `{ posts, limit, cursor, next_cursor, has_more }` |
| GET | `/api/posts/{id}` | — | One post object |
| GET | `/api/posts/{id}/reports` | — | `{ post_id, reports, total }` |
| GET | `/api/posts/media/config` | — | `{ max_upload_bytes, allowed_image_types }` |
| POST | `/api/posts/media` | multipart body field `file`; no query parameters | 201: `{ url, size }`; **StellarSig required** |
| GET | `/api/posts/media/{filename}` | — | Uploaded image bytes (static media response) |

Post IDs are positive numeric strings. Media uploads use `multipart/form-data`; the accepted MIME types and maximum size are returned by the config endpoint. The default upload cap is 20 MiB and default types are JPEG, PNG, and WebP; deployments may override these values.

### Feeds

| Method | Path | Query parameters | Success response |
| --- | --- | --- | --- |
| GET | `/api/feed` | `viewer` (optional Stellar address), `limit` (default 20), `offset` (default 0) | `{ posts, total, limit, offset, has_more }` |
| GET | `/api/feed/explore` | `limit` (default 20; 1–100), `cursor` (opaque), `tag` (optional) | `{ posts, has_more, next_cursor }` |
| GET | `/api/feed/following/{address}` | `limit` (default 20; 1–100), `cursor` (opaque), `tag` (optional) | `{ posts, has_more, next_cursor }` |

The home feed currently uses offset pagination. Explore and following feeds use opaque composite cursors. A tag filter, when supplied, is matched case-insensitively.

### Search

| Method | Path | Query parameters | Success response |
| --- | --- | --- | --- |
| GET | `/api/search` | required `q`; optional `type` = `posts` | `profiles` | `pools`; `limit`, `offset` | `{ total, limit, offset, posts? , profiles? , pools? }` |
| GET | `/api/search/posts` | at least one of `q` or `tag`; `limit`, `offset` | `{ posts, total, limit, offset, has_more }` |

### Follows and users

| Method | Path | Query parameters | Success response |
| --- | --- | --- | --- |
| GET | `/api/follows/{address}/followers` | `limit`, `cursor` | `{ address, followers, total, limit, cursor, next_cursor, has_more }` |
| GET | `/api/follows/{address}/following` | `limit`, `cursor` | `{ address, following, total, limit, cursor, next_cursor, has_more }` |
| GET | `/api/users/{address}/blocked` | `limit`, `offset` | `{ address, blocked, total, limit, offset, has_more }` |
| GET | `/api/users/{address}/dm-key` | — | `{ address, x25519_pubkey }` |

Addresses are validated as Stellar account addresses. The DM-key route returns 404 when no public key has been published.

### Pools and governance

| Method | Path | Query parameters | Success response |
| --- | --- | --- | --- |
| GET | `/api/pools` | `limit`, `cursor` | `{ pools, limit, cursor, next_cursor, has_more }` |
| GET | `/api/pools/search` | required `q`; `limit`, `offset` | `{ pools, total, limit, offset, has_more }` |
| GET | `/api/pools/{id}` | — | Pool object; `balance` is serialized as a decimal string |
| GET | `/api/pools/{id}/analytics` | — | Pool identity, balance, admins, threshold and analytics fields |
| GET | `/api/governance/proposals` | `limit`, `cursor` | `{ proposals, limit, cursor, next_cursor, has_more }` |

Large integer amounts and balances are serialized as decimal strings to avoid JavaScript number precision loss.

### Events and state roots

| Method | Path | Query parameters | Success response |
| --- | --- | --- | --- |
| GET | `/api/events` | `limit`, `cursor`, `contract_id`, `topic` | `{ events, limit, cursor, next_cursor, has_more }` |
| GET | `/api/events/replay` | required `fromLedger`, `toLedger`; optional `types` (repeatable or comma-free string), `cursor`, `limit` (1–1000, default 100) | Newline-delimited JSON event records; optional final cursor metadata record |
| GET | `/api/state-root` | required positive integer `ledger` | `{ ledger, root, verified: true }` |

The replay route is mounted when the API has a PostgreSQL pool. It returns `application/x-ndjson`, not a JSON array, and is limited to one request per minute per client IP. The state-root route is mounted when PostgreSQL is configured.

### Notifications and direct messages

| Method | Path | Query parameters / body | Success response |
| --- | --- | --- | --- |
| POST | `/api/notifications/register` | JSON: `{ address, token, platform }`; platform is `ios`, `android`, or `web` | 204 No Content; **StellarSig required** |
| POST | `/api/notifications/deregister` | JSON: `{ address, token }` | 204 No Content; **StellarSig required** |
| GET | `/api/notifications/preferences` | — | Current preference object; **StellarSig required** |
| POST | `/api/notifications/preferences` | JSON: `{ preferences, subscription? }` | 200: `{ success: true }`; **StellarSig required** |
| GET | `/api/notifications/inbox/{address}` | `limit`, `cursor` | `{ notifications, has_more, next_cursor }` (PostgreSQL configuration required) |
| POST | `/api/notifications/inbox/read-all` | — | `{ read_through }`; **StellarSig required** |
| POST | `/api/messages` | JSON: `{ recipientAddress, encryptedContent }` | 202: `{ status: "accepted", from, to }`; **StellarSig required** |

Notification preferences are scoped to the authenticated Stellar address. The server rejects attempts to register or deregister a device token for a different address.

### Webhooks

| Method | Path | Query parameters / body | Success response |
| --- | --- | --- | --- |
| POST | `/api/webhooks` | JSON: `{ url, secret, event_types }` | 201: `{ webhook: { id, url, event_types, active, created_at } }` |
| DELETE | `/api/webhooks/{id}` | UUID path parameter | 204 No Content |
| GET | `/api/webhooks/{id}/deliveries` | — | `{ deliveries }` (most recent 100) |

Webhook registration requires an absolute URL, a non-empty secret, and at least one event type. Delivery callbacks include `X-Linkora-Signature` (HMAC-SHA256) and `X-Linkora-Event` headers.

## Example requests and responses

### List posts

```bash
curl -s "$INDEXER_URL/api/posts?limit=2"
```

```json
{
  "posts": [
    {
      "id": "1042",
      "author": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      "content": "Hello Linkora",
      "tags": ["intro"],
      "tip_total": "2500000",
      "like_count": "3",
      "created_at": "2026-01-15T10:00:00.000Z"
    }
  ],
  "limit": 2,
  "cursor": null,
  "next_cursor": "opaque-cursor-from-server",
  "has_more": true
}
```

### Search profiles

```bash
curl -s "$INDEXER_URL/api/profiles/search?q=alice&limit=10&offset=0"
```

```json
{
  "profiles": [
    { "address": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", "username": "alice" }
  ],
  "total": 1,
  "limit": 10,
  "offset": 0,
  "has_more": false
}
```

### Fetch a profile

```bash
curl -i "$INDEXER_URL/api/profiles/GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
```

A successful response is the profile resource itself (not wrapped in a `data` property). Its fields are defined by the `Profile` schema in the OpenAPI document.

### Upload post media

```bash
curl -X POST "$INDEXER_URL/api/posts/media" \
  -H "Authorization: StellarSig <signed-request>" \
  -F "file=@./image.webp"
```

```json
{ "url": "/api/posts/media/4e2a...webp", "size": 48213 }
```

The authorization value above is a placeholder: use the project's Stellar signing client to generate a valid request signature.

### Readiness probe

```bash
curl -i "$INDEXER_URL/health/ready"
```

```json
{
  "status": "ready",
  "degraded": false,
  "checks": {
    "database": { "status": "ok" },
    "stellarRpc": { "status": "ok" }
  }
}
```

## Error responses

Most API errors use the shared error envelope:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Profile not found",
    "requestId": "req_01H..."
  }
}
```

The `details` property is included only when an error has safe, useful extra context. A request ID may be present and should be supplied when reporting an incident.

| HTTP status | Typical code | Meaning / action |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR`, `INVALID_CURSOR`, `BAD_REQUEST` | Check required parameters, field types, Stellar address, ID and cursor. Retry only after correcting the request. |
| 401 | `UNAUTHORIZED` | Supply a valid Stellar signature for a protected route. |
| 403 | `FORBIDDEN` | The authenticated address is not allowed to perform the requested action. |
| 404 | `NOT_FOUND` | The requested profile, post, pool, key or state root does not exist. |
| 413 | `PAYLOAD_TOO_LARGE` | Reduce the upload to the advertised `max_upload_bytes`. |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Upload only a MIME type listed by `/api/posts/media/config`. |
| 429 | `RATE_LIMITED` (or route-specific message) | Wait for the rate-limit window to reset; do not immediately retry in a tight loop. |
| 500 | `INTERNAL_ERROR` | Unexpected server failure. Retry with backoff; include `requestId` in a report. |
| 503 | `SELF_FENCED`, `SHUTTING_DOWN`, readiness unavailable | The node is fenced, shutting down, or not ready. Retry against a healthy instance later. |

Validation failures generally return a structured `error` object with a code and message. A few legacy handlers (notably feed cursor validation, event replay, and webhook failures) return route-specific `{ "error": "..." }` strings instead of the shared envelope. Clients should therefore treat the HTTP status as authoritative and tolerate both forms.

### Example validation error

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request parameters",
    "details": { "fieldErrors": { "limit": ["Too small"] } },
    "requestId": "req_01H..."
  }
}
```

## Keeping this reference accurate

1. Add or change the route in `services/indexer/src/api/routes/` and mount it in `services/indexer/src/api/index.ts`.
2. Update `docs/api/indexer.openapi.yaml` in the same pull request.
3. Add request/response and error cases to the route tests.
4. Run the indexer test suite and the OpenAPI route parity test:

```bash
pnpm --filter @linkora/indexer test
```

The OpenAPI file is the detailed schema contract; this Markdown page is the navigable guide and examples companion.
