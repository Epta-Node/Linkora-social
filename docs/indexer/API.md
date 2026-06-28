# Linkora Indexer REST API

This document describes every REST endpoint exposed by the Linkora indexer service.

**Base URL:** `http://localhost:3001` (development) or the configured `INDEXER_URL` in production.

All responses use `Content-Type: application/json`. All timestamps are Unix epoch seconds. All token amounts are raw integer strings to avoid floating-point loss.

---

## Table of Contents

- [Health](#health)
- [Posts](#posts)
  - [Search posts](#post-apisearchposts)
  - [Get post by ID](#get-apipostsid)
  - [Get posts by author](#get-apipostsauthoraddress)
- [Profiles](#profiles)
  - [Get profile](#get-apiprofilesaddress)
  - [Search profiles](#get-apiprofilessearch)
  - [List profiles](#get-apiprofiles)
- [Social graph](#social-graph)
  - [Get following](#get-apisocialgraphaddressfollowing)
  - [Get followers](#get-apisocialgraphaddressfollowers)
- [Tips](#tips)
  - [Get tips for a post](#get-apipoststipsid)
  - [Get tips sent by an address](#get-apitipssenderaddress)
- [Pools](#pools)
  - [Get pool state](#get-apipoolspool_id)
- [Cursor](#cursor)
  - [Get indexer cursor](#get-apicursor)
- [Error format](#error-format)

---

## Health

### GET /health

Returns `200 OK` when the indexer is running and the database connection is healthy.

**Response**

```json
{
  "status": "ok",
  "ledger": 12345678
}
```

| Field    | Type     | Description                               |
| -------- | -------- | ----------------------------------------- |
| `status` | `"ok"`   | Always `"ok"` when the service is healthy |
| `ledger` | `number` | Last fully indexed ledger sequence        |

---

## Posts

### GET /api/search/posts

Full-text search over post content.

**Request body**

```json
{
  "query": "stellar soroban",
  "limit": 20,
  "offset": 0
}
```

| Field    | Type     | Required | Default | Constraints      |
| -------- | -------- | -------- | ------- | ---------------- |
| `query`  | `string` | yes      | —       | 1–200 characters |
| `limit`  | `number` | no       | `20`    | 1–100            |
| `offset` | `number` | no       | `0`     | ≥ 0              |

**Response `200`**

```json
{
  "posts": [
    {
      "id": "42",
      "author": "GABC...XYZ",
      "content": "Building on Stellar with Soroban is great!",
      "tip_total": "1000000000",
      "like_count": 7,
      "created_ledger": 12300000,
      "deleted": false
    }
  ],
  "total": 1,
  "has_more": false
}
```

**Error codes:** `INVALID_QUERY`, `LIMIT_EXCEEDED`, `INTERNAL_ERROR`

---

### GET /api/posts/:id

Fetch a single post by its numeric ID.

**Path parameters**

| Param | Type  | Description                      |
| ----- | ----- | -------------------------------- |
| `id`  | `u64` | Post ID assigned by the contract |

**Response `200`**

```json
{
  "id": "42",
  "author": "GABC...XYZ",
  "content": "Hello Linkora!",
  "tip_total": "500000000",
  "like_count": 3,
  "created_ledger": 12200000,
  "deleted": false,
  "deleted_ledger": null
}
```

**Response `404`**

```json
{
  "error": "post not found",
  "code": "NOT_FOUND"
}
```

---

## Profiles

### GET /api/profiles/search

Full-text search over profile usernames and creator tokens.

Query parameters:

- `q` required search string
- `limit` optional result cap, default `20`, max `100`
- `offset` optional pagination offset, default `0`

Response:

```json
{
  "profiles": [
    {
      "address": "G...",
      "username": "alice",
      "creator_token": "ALICE",
      "updated_ledger": 12345
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0,
  "has_more": false
}
```

---

### GET /api/posts/author/:address

Paginated list of post IDs authored by a Stellar address.

**Path parameters**

| Param     | Type     | Description                      |
| --------- | -------- | -------------------------------- |
| `address` | `string` | Stellar account address (`G...`) |

**Query parameters**

| Param    | Type     | Default | Constraints |
| -------- | -------- | ------- | ----------- |
| `limit`  | `number` | `20`    | 1–50        |
| `offset` | `number` | `0`     | ≥ 0         |

**Response `200`**

```json
{
  "posts": ["41", "42", "55"],
  "total": 3,
  "has_more": false
}
```

---

## Profiles

### GET /api/profiles/:address

Fetch the profile registered for a Stellar address.

**Response `200`**

```json
{
  "address": "GABC...XYZ",
  "username": "alice",
  "creator_token": "CABC...TOKEN",
  "updated_ledger": 12100000
}
```

**Response `404`**

```json
{
  "error": "profile not found",
  "code": "NOT_FOUND"
}
```

---

### GET /api/profiles

Paginated list of all registered profiles, ordered by `updated_ledger` descending.

**Query parameters**

| Param    | Type     | Default | Constraints |
| -------- | -------- | ------- | ----------- |
| `limit`  | `number` | `20`    | 1–100       |
| `offset` | `number` | `0`     | ≥ 0         |

**Response `200`**

```json
{
  "profiles": [
    {
      "address": "GABC...XYZ",
      "username": "alice",
      "creator_token": "CABC...TOKEN",
      "updated_ledger": 12100000
    }
  ],
  "total": 1,
  "has_more": false
}
```

---

## Social Graph

### GET /api/social-graph/:address/following

Paginated list of addresses that `:address` follows.

**Query parameters**

| Param    | Type     | Default | Constraints |
| -------- | -------- | ------- | ----------- |
| `limit`  | `number` | `20`    | 1–50        |
| `offset` | `number` | `0`     | ≥ 0         |

**Response `200`**

```json
{
  "following": ["GBOB...XYZ", "GCAR...XYZ"],
  "total": 2,
  "has_more": false
}
```

---

### GET /api/social-graph/:address/followers

Paginated list of addresses that follow `:address`.

**Query parameters:** same as `/following`.

**Response `200`**

```json
{
  "followers": ["GDAVE...XYZ"],
  "total": 1,
  "has_more": false
}
```

---

## Tips

### GET /api/posts/:id/tips

Paginated tip history for a post.

**Query parameters**

| Param    | Type     | Default | Constraints |
| -------- | -------- | ------- | ----------- |
| `limit`  | `number` | `20`    | 1–100       |
| `offset` | `number` | `0`     | ≥ 0         |

**Response `200`**

```json
{
  "tips": [
    {
      "id": "1",
      "tipper": "GBOB...XYZ",
      "post_id": "42",
      "amount": "1000000000",
      "fee": "25000000",
      "ledger": 12300010,
      "tx_hash": "abc123..."
    }
  ],
  "total": 1,
  "has_more": false
}
```

---

### GET /api/tips/sender/:address

Paginated list of tips sent by an address.

**Query parameters:** same as above.

**Response `200`**

```json
{
  "tips": [
    {
      "id": "1",
      "tipper": "GBOB...XYZ",
      "post_id": "42",
      "amount": "1000000000",
      "fee": "25000000",
      "ledger": 12300010,
      "tx_hash": "abc123..."
    }
  ],
  "total": 1,
  "has_more": false
}
```

---

## Pools

### GET /api/pools/:pool_id

Fetch the current state of a community pool.

**Path parameters**

| Param     | Type     | Description                    |
| --------- | -------- | ------------------------------ |
| `pool_id` | `string` | Symbol identifier for the pool |

**Response `200`**

```json
{
  "pool_id": "CREATOR_FUND",
  "token": "CABC...TOKEN",
  "balance": "5000000000",
  "updated_ledger": 12350000
}
```

**Response `404`**

```json
{
  "error": "pool not found",
  "code": "NOT_FOUND"
}
```

---

## Cursor

### GET /api/cursor

Returns the indexer's current sync position.

**Response `200`**

```json
{
  "ledger_seq": 12345678,
  "event_cursor": "0000004bc9db0000000200000000"
}
```

| Field          | Type     | Description                    |
| -------------- | -------- | ------------------------------ |
| `ledger_seq`   | `number` | Last fully processed ledger    |
| `event_cursor` | `string` | Opaque RPC cursor for resuming |

---

## Error Format

All error responses share the same shape:

```json
{
  "error": "human-readable message",
  "code": "MACHINE_READABLE_CODE"
}
```

| Code             | HTTP status | Meaning                                |
| ---------------- | ----------- | -------------------------------------- |
| `NOT_FOUND`      | 404         | Resource does not exist in the index   |
| `INVALID_QUERY`  | 400         | Missing or malformed request parameter |
| `LIMIT_EXCEEDED` | 400         | `limit` parameter exceeds the maximum  |
| `INTERNAL_ERROR` | 500         | Unexpected server error                |
