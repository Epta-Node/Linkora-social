# Real-time and contract operations foundations

This guide records the small, safe integration boundaries for the current
contract and indexer work. It is intended for operators and client developers.

## Admin approval changes

Administrative actions should be represented as explicit proposal payloads and
must not execute until the configured approval threshold is reached. Clients
should treat proposal expiry as a terminal state and ask an authorised admin to
create a new proposal rather than retrying an expired one.

## Targeted module pauses

The contract exposes module-level pause state. Operators should select the
narrowest module needed during an incident, confirm the emitted pause event in
the indexer, and resume only after the incident is resolved. A module pause is
not a replacement for the global emergency pause.

## WebSocket subscriptions

Clients subscribe with a `subscribe` control frame containing a string array
of event types. A subscription now accepts at most ten distinct types, which
keeps per-connection fanout bounded. Clients should reconnect after a dropped
connection and resubscribe from their persisted last-seen event marker.

## API rate limiting

Read and mutation limits are enforced independently. Consumers should honor
`Retry-After` and the `X-RateLimit-*` response headers rather than retrying
immediately. Internal-service allowlisting must be explicitly configured; it
is never inferred from an untrusted request header.
