# ADR-006 — Analytics Oracle: Trust-Minimised Off-Chain Compute Attestation

**Status:** Accepted  
**Deciders:** Linkora core team  
**Date:** 2026-06-19

---

## Context

Creators want verifiable analytics: total tips earned, follower growth, engagement rate. Computing these on-chain per-query is prohibitively expensive — it would require scanning every `TipEvent`, `PostCreatedEvent`, and `FollowEvent` entry for a given creator on each call. Computing them purely off-chain (and serving them as bare numbers from an API) gives creators no way to trust or verify the numbers independently.

The solution is a **verifiable analytics oracle**: an off-chain service computes analytics over indexed event data, signs the result with an Ed25519 key whose public key is registered on-chain, and the contract exposes a `verify_analytics_attestation` function that any caller can use to check a signed analytics report. Once verified, the attestation is anchored on-chain as an event, giving clients a canonical, auditable reference.

---

## Decision

### 1. What constitutes a valid analytics report

A report covers a single creator over a closed time window. The canonical schema (CBOR-encoded in the oracle service, validated by its SHA-256 hash on-chain) is:

```
{
  version:        u8,       // schema version, currently 1
  creator:        bytes32,  // Stellar address bytes (raw 32-byte ed25519 public key)
  window_start:   u64,      // inclusive ledger sequence
  window_end:     u64,      // inclusive ledger sequence
  total_tips:     u128,     // sum of tip amounts net of fee, in token stroops
  post_count:     u64,      // posts created by creator in window
  follower_delta: i64,      // net change in follower count during window
  unique_tippers: u32,      // distinct tipper addresses in window
}
```

A report is valid if:
- `version == 1`
- `window_start <= window_end`
- The Ed25519 signature over `sha256(report_cbor)` verifies against the registered oracle public key
- The nullifier `sha256(report_cbor)` has not been previously stored (replay protection)

### 2. Signing scheme

```
message  = sha256(report_cbor)          // 32-byte digest of the canonical CBOR blob
signature = ed25519_sign(oracle_sk, message)
```

The contract uses `env.crypto().ed25519_verify(pubkey, message, signature)` which is a native, gas-metered Soroban host function. The oracle service signs with `@noble/ed25519`.

### 3. Canonical serialisation rules

The oracle service produces CBOR using `cbor-x` (Node.js). Rules:
- Fields encoded in the struct order listed above (no key sorting needed — CBOR uses positional encoding for fixed-schema structs encoded as arrays, not maps)
- No optional trailing fields; all 8 fields are always present
- Strings are not used; `creator` is raw bytes, not a Stellar G-address string
- The CBOR bytes are the canonical serialisation; the contract receives them as `Bytes` and does not re-encode

### 4. Oracle key rotation

The contract stores oracle keys in `StorageKey::OracleKey(Symbol)` keyed by an oracle name (e.g., `Symbol("default")`). The contract admin can call `register_oracle` at any time to update a key.

Rotation does **not** invalidate existing attestations: nullifiers are keyed by `sha256(report_cbor)`, which is a content hash of the report data itself, not the key. Old attestations remain stored and remain valid records of the oracle's past signatures. Clients should record the `oracle_name` alongside any displayed attestation so that auditors know which key generation signed it.

### 5. Trust model

**What an attacker who compromises the oracle key can do:**
- Forge analytics reports for any creator — claim false `total_tips`, `post_count`, `follower_delta`, etc.
- Submit these forged attestations on-chain; they will pass `ed25519_verify`.
- The forged attestations are anchored on-chain and visible to all clients.

**What the attacker cannot do:**
- Steal funds. The oracle has no authority over pool withdrawals, tips, or token transfers. Analytics attestations have no privileged contract role.
- Alter historical contract events (TipEvent, PostCreatedEvent, etc.) — those are already on-chain.
- Impersonate users or authorise transactions on their behalf.

**Threat boundary:** The oracle key controls only the authenticity of analytics numbers. A forged attestation inflates or deflates displayed stats. The economic and social damage of false analytics is real but scoped. Key rotation and monitoring of oracle submissions mitigate the risk.

### 6. TEE comparison (Intel SGX / AWS Nitro Enclaves)

A TEE-attested oracle would run the analytics computation inside a hardware-isolated enclave. The enclave's attestation quote, signed by the hardware vendor, would prove:
- The exact binary computing the analytics
- That the private key was generated inside the enclave and cannot be exfiltrated

This provides a stronger guarantee: even a fully compromised server cannot produce a valid attestation without the hardware attestation chain. However, it adds significant operational complexity (proprietary hardware, attestation verification code, key provisioning), is not supported natively in Soroban, and requires trust in the hardware vendor's attestation infrastructure.

For this iteration, the Ed25519 approach is sufficient: the public key is registered on-chain (transparent), the oracle service is open-source (auditable), and key rotation provides recovery. A TEE upgrade path is possible by replacing the oracle key with one generated inside an enclave without changing the on-chain contract interface.

---

## Consequences

- Creators get verifiable, on-chain-anchored analytics that clients can display with confidence.
- The oracle is a trusted but auditable service; its key compromise is recoverable via rotation.
- Attestations are replay-proof (nullifier) and cheap to verify (single `ed25519_verify` call).
- No changes to existing contract storage layout are required beyond additive new keys.
- The CBOR schema is versioned (`version` field) to support future field additions.
