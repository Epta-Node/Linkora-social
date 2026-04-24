# Linkora Social Contract - Event Schema

This document defines the canonical event schema for the Linkora Social contract. Indexers and clients should use this as the source of truth for decoding and filtering events.

## Versioning Strategy

All events follow a consistent topic structure:
`(ContractName, EventName, Version)`

- **ContractName**: `Linkora` (Symbol)
- **EventName**: Descriptive name (Symbol)
- **Version**: `v1`, `v2`, etc. (Symbol)

When a schema change is required, the version symbol will be incremented. Indexers should filter for the versions they support.

## Canonical Events

### ProfileSet
Emitted when a user creates or updates their profile.

- **Topic 0**: `Linkora`
- **Topic 1**: `profile`
- **Topic 2**: `v1`
- **Data Payload**: `ProfileSetEvent`
  - `user`: `Address`
  - `username`: `String`

### Follow
Emitted when a user follows another user.

- **Topic 0**: `Linkora`
- **Topic 1**: `follow`
- **Topic 2**: `v1`
- **Data Payload**: `FollowEvent`
  - `follower`: `Address`
  - `followee`: `Address`

### PostCreated
Emitted when a new post is successfully created.

- **Topic 0**: `Linkora`
- **Topic 1**: `post`
- **Topic 2**: `v1`
- **Data Payload**: `PostCreatedEvent`
  - `id`: `u64`
  - `author`: `Address`

### Tip
Emitted when a post author is tipped.

- **Topic 0**: `Linkora`
- **Topic 1**: `tip`
- **Topic 2**: `v1`
- **Data Payload**: `TipEvent`
  - `tipper`: `Address`
  - `post_id`: `u64`
  - `amount`: `i128` (Gross amount)
  - `fee`: `i128` (Amount sent to protocol treasury)

### ContractUpgraded
Emitted when the contract WASM is upgraded.

- **Topic 0**: `Linkora`
- **Topic 1**: `upgraded`
- **Topic 2**: `v1`
- **Data Payload**: `ContractUpgraded`
  - `new_wasm_hash`: `BytesN<32>`

## Querying and Decoding

### Using Stellar CLI
To fetch events from a specific contract on Testnet:

```bash
stellar events --id <CONTRACT_ID> --network testnet --start-ledger <LEDGER_NUM>
```

To filter for only `tip` events:

```bash
stellar events --id <CONTRACT_ID> --network testnet --topic "Linkora, tip, v1"
```

### Using JS SDK
```javascript
const events = await server.getEvents({
  filters: [
    {
      type: "contract",
      contractIds: [CONTRACT_ID],
      topics: [
        [
          xdr.ScVal.scvSymbol("Linkora").toXDR("base64"),
          xdr.ScVal.scvSymbol("tip").toXDR("base64"),
          xdr.ScVal.scvSymbol("v1").toXDR("base64"),
        ]
      ]
    }
  ],
  startLedger: 123456,
});
```
