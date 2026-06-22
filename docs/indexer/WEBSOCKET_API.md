# Linkora Indexer WebSocket API

The indexer exposes a real-time WebSocket stream of contract events. Downstream
systems (web/mobile clients, search indexers, notification services) subscribe
here instead of polling the database.

**Endpoint:** `ws://<host>:<PORT>/ws` (default port `3000`)

Events are published to the stream **only after** they have been durably
committed by the exactly-once ingestion pipeline, so every frame a client
receives corresponds to a persisted event.

---

## Connection lifecycle

1. Client opens a WebSocket to `/ws`.
2. By default the client receives **all** event types. To narrow the stream,
   send a `subscribe` control frame (see below).
3. The server sends a protocol-level **ping every 15 seconds**; clients MUST
   reply with a pong (browsers and the `ws` library do this automatically). A
   client that misses a heartbeat is terminated.
4. On shutdown the server sends WebSocket close code `1001` ("going away").

---

## Server → client frames

Every application frame is a JSON object with a `type` and a `payload`:

```json
{
  "type": "<frame type>",
  "payload": { ... }
}
```

### Event frame

Emitted for each committed contract event. `type` is the contract event type
(`topic[0]`).

```json
{
  "type": "PostCreated",
  "payload": {
    "type": "PostCreated",
    "ledgerSequence": 1234567,
    "eventIndex": 0,
    "contractId": "CCONTRACT...",
    "topic": ["PostCreated", "..."],
    "data": {
      "id": "0001234567-0000000000",
      "value": "<base64/raw event value>",
      "txHash": "<tx hash>",
      "ledgerClosedAt": "2026-06-22T12:00:00Z",
      "pagingToken": "0001234567-0000000000"
    }
  }
}
```

| Field                    | Type       | Description                                          |
| ------------------------ | ---------- | ---------------------------------------------------- |
| `payload.type`           | `string`   | Contract event type (same as the frame `type`).      |
| `payload.ledgerSequence` | `number`   | Ledger the event was emitted in.                     |
| `payload.eventIndex`     | `number`   | Index of the event within its ledger.                |
| `payload.contractId`     | `string`   | Contract that emitted the event.                     |
| `payload.topic`          | `string[]` | Raw event topic array.                               |
| `payload.data`           | `object`   | Event body (decoded/raw fields).                     |

The pair `(ledgerSequence, eventIndex)` uniquely identifies an event and can be
used by clients to deduplicate if they reconnect.

### Subscription acknowledgement

Sent in response to a successful `subscribe` control frame.

```json
{ "type": "subscribed", "payload": { "types": ["PostCreated", "Follow"] } }
```

`["*"]` indicates the client is subscribed to all event types.

### Error frame

Sent when a client control frame is malformed.

```json
{ "type": "error", "payload": { "message": "subscribe requires a string[] 'types' field" } }
```

---

## Client → server frames

### `subscribe`

Narrow the set of event types delivered to this connection. Replaces any
previous subscription for the connection.

```json
{ "action": "subscribe", "types": ["PostCreated", "Follow"] }
```

| Field    | Type       | Description                                                            |
| -------- | ---------- | --------------------------------------------------------------------- |
| `action` | `string`   | Must be `"subscribe"`.                                                 |
| `types`  | `string[]` | Event types to receive. Empty array or `["*"]` subscribes to all.     |

Unknown actions, non-JSON frames, or an invalid `types` field produce an
`error` frame; the connection stays open.

---

## Event types

Event types correspond to contract events. Current types include:

| Type             | Description                          |
| ---------------- | ------------------------------------ |
| `PostCreated`    | A post was created.                  |
| `PostDeleted`    | A post was soft-deleted.             |
| `Follow`         | A follow edge was created.           |
| `Unfollow`       | A follow edge was removed.           |
| `ProfileSet`     | A profile was created/updated.       |
| `Tip`            | A post was tipped.                   |
| `LikePost`       | A post was liked.                    |
| `PoolCreated`    | A pool was created.                  |
| `PoolDeposit`    | A deposit was made to a pool.        |
| `PoolWithdraw`   | A withdrawal was made from a pool.   |

`*` is a reserved meta-type meaning "all events" and is only valid in
`subscribe` frames — it is never used as the `type` of an event frame.

---

## Example (browser)

```js
const ws = new WebSocket("ws://localhost:3000/ws");

ws.onopen = () => {
  ws.send(JSON.stringify({ action: "subscribe", types: ["PostCreated", "Tip"] }));
};

ws.onmessage = (e) => {
  const { type, payload } = JSON.parse(e.data);
  if (type === "PostCreated") {
    console.log("new post in ledger", payload.ledgerSequence, payload.data);
  }
};
```
