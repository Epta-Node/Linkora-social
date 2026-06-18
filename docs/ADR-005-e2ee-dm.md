# ADR-005: End-to-End Encrypted Direct Messages

## Status

Accepted

## Context

Linkora currently lacks direct messaging capabilities. Adding DMs to a blockchain-native social platform presents unique challenges:

1. **Key Distribution Problem**: Traditional messaging platforms rely on central key servers, which contradicts our decentralized architecture
2. **Cost Considerations**: Storing message content on-chain is prohibitively expensive and makes all messages publicly readable
3. **Privacy Requirements**: Users expect private communications that cannot be read by third parties, including Linkora infrastructure

## Decision

We will implement end-to-end encrypted direct messages using:

### Cryptographic Protocol

#### Key Agreement: X25519 Diffie-Hellman
- **Algorithm**: X25519 elliptic curve Diffie-Hellman key exchange
- **Rationale**: 
  - Widely audited and standardized (RFC 7748)
  - Constant-time implementations available
  - Efficient key agreement for static key pairs
  - Good compatibility with JavaScript cryptographic libraries

#### Key Derivation: HKDF-SHA256
- **Algorithm**: HKDF (HMAC-based Extract-and-Expand Key Derivation Function) with SHA-256
- **Input**: X25519 shared secret
- **Info String**: `"linkora-dm-v1:" + conversation_id` where `conversation_id = sha256(min(address_a, address_b) + max(address_a, address_b))`
- **Output**: 32-byte symmetric encryption key
- **Rationale**:
  - Cryptographically sound key derivation from shared secrets
  - Per-conversation keys prevent cross-conversation attacks
  - Standardized approach (RFC 5869)

#### Encryption: ChaCha20-Poly1305 AEAD
- **Algorithm**: ChaCha20-Poly1305 Authenticated Encryption with Associated Data
- **Rationale over AES-GCM**:
  - Constant-time implementations easier to audit in JavaScript without WASM
  - No timing attack concerns with table lookups
  - Better performance on platforms without AES hardware acceleration
  - Proven security with widespread adoption

#### Nonce Derivation
- **Method**: Deterministic nonce generation using `HKDF(shared_secret, salt=conversation_id, info="nonce:" + message_index)`
- **Format**: 12-byte nonce for ChaCha20-Poly1305
- **Rationale**:
  - Prevents nonce reuse attacks
  - Deterministic approach eliminates need to store/transmit nonces
  - Message ordering provides replay protection

### Key Publication Strategy

#### Separate DM Key Pair
**Problem with Key Reuse**: Using the Stellar signing key directly as the X25519 key creates security vulnerabilities:
- **Different Security Models**: Stellar keys are designed for transaction signing, not key agreement
- **Key Exposure**: Transaction signatures may leak information about the private key over time
- **Algorithm Mismatch**: Ed25519 (Stellar) vs X25519 (key agreement) have different mathematical properties

**Solution**: 
- Generate separate X25519 key pairs specifically for DM encryption
- Publish X25519 public keys on-chain using the Stellar signing key for authentication
- Store X25519 private keys locally in secure storage

#### On-Chain Key Storage
- **Storage Key**: `StorageKey::DmPublicKey(Address)` → `BytesN<32>`
- **Publication**: Users call `publish_dm_key()` with their X25519 public key
- **Retrieval**: Anyone can call `get_dm_key(address)` to retrieve a user's public key
- **Authentication**: Key publication requires signature from the user's Stellar key

### Message Architecture

#### Off-Chain Relay Service
**Evaluation of Options**:

1. **On-Chain Storage**: 
   - ❌ Too expensive (each message = transaction fee)
   - ❌ Publicly readable (defeats encryption purpose)
   - ❌ Poor scalability

2. **IPFS**:
   - ❌ Content addressing makes private messaging difficult
   - ❌ No built-in access control
   - ❌ Potential availability issues for ephemeral messages

3. **Nostr Relay Protocol**:
   - ✅ Designed for decentralized messaging
   - ❌ Added complexity for integration
   - ❌ Different cryptographic assumptions

4. **Custom HTTP Relay** (Selected):
   - ✅ Simple integration with existing infrastructure
   - ✅ Fine-grained access control
   - ✅ Message TTL and cleanup capabilities
   - ✅ Transport-only (never decrypts messages)

#### Relay Server Properties
- **Transport Only**: Server never has access to plaintext messages
- **Authentication**: Message submission requires signature verification
- **TTL**: 7-day message retention with automatic cleanup
- **Conversation Routing**: Messages grouped by deterministic conversation ID
- **Pagination**: Support for message history retrieval

### Forward Secrecy Limitations

**Current Approach**: Static X25519 key pairs provide **basic encryption** but not **forward secrecy**.

**Limitation**: If a user's X25519 private key is compromised, all past messages can be decrypted.

**Future Enhancement**: The Double Ratchet protocol (used in Signal) can be layered on top:
- **Session Keys**: Ephemeral keys for each message/session
- **Key Rotation**: Automatic key updates prevent future compromise from affecting past messages
- **Healing**: Compromised state can be recovered from

**Why Not Now**:
- Significantly increases implementation complexity
- Requires more sophisticated key management
- Static keys provide adequate security for initial implementation
- Can be added in v2 without breaking existing conversations

## Implementation Plan

### Phase 2: Contract Changes
- Add `StorageKey::DmPublicKey(Address)`
- Implement `publish_dm_key()` and `get_dm_key()` functions
- Add `DmKeyPublishedEvent`

### Phase 3: SDK Encryption Layer
- X25519 key generation using @noble/curves
- HKDF key derivation
- ChaCha20-Poly1305 encryption/decryption
- Nonce derivation utilities
- HTTP client for relay API

### Phase 4: Relay Service
- Express.js HTTP service
- Message storage with PostgreSQL
- Authentication via Stellar signature verification
- TTL cleanup with cron jobs

### Phase 5: UI Implementation
- DM screens for mobile and web
- Key generation flows
- Message composition and display
- Error handling for missing keys

## Security Considerations

### Threat Model
- **Server Compromise**: Relay server compromise cannot decrypt messages
- **Network Surveillance**: Message content encrypted in transit and at rest
- **Key Compromise**: Static key compromise affects all conversations (limitation noted above)
- **Metadata Leakage**: Message timing and participant identities are visible to relay

### Cryptographic Assumptions
- X25519 provides strong key agreement security
- ChaCha20-Poly1305 provides authenticated encryption
- HKDF provides secure key derivation
- Users maintain secure local key storage

### Out of Scope (V1)
- Forward secrecy (requires Double Ratchet)
- Metadata privacy (requires more sophisticated routing)
- Multi-device synchronization
- Message deletion/editing

## Consequences

### Benefits
- Private direct messaging without central key management
- End-to-end encryption with no plaintext server access
- Leverages existing Stellar key infrastructure for authentication
- Scalable off-chain message storage
- Foundation for future protocol enhancements

### Tradeoffs
- No forward secrecy in v1 implementation
- Metadata visible to relay service
- Requires separate key management for DM keys
- Additional infrastructure (relay service) to operate

### Migration Path
- Contract storage key addition is backwards compatible
- Encryption protocol can be enhanced without breaking existing keys
- Relay service can be decentralized in future versions