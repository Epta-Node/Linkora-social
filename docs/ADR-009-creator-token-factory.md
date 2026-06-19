# ADR-009: Creator Token Factory

**Status:** Accepted
**Date:** 2026-06-19
**Authors:** Linkora Contributors

## Context

`set_profile` accepts a `creator_token: Address` parameter so every creator profile can reference their own SEP-41 token. However, the only way to deploy a SEP-41 token today is via the Stellar CLI — a multi-step process involving WASM compilation, contract installation, and manual invocation. This is incompatible with a consumer-grade web application where the expected flow is: fill a form, click "Deploy", sign once in Freighter.

We need an on-chain factory that deploys SEP-41-compliant child token contracts on behalf of creators, integrates with the existing `set_profile` flow, and surfaces a clean wizard in the web app.

## Decision

Introduce a separate Soroban contract, `token-factory`, that:

1. Accepts token parameters (name, symbol, decimals, initial supply).
2. Deploys a minimal SEP-41 token via `env.deployer()` using the canonical Stellar Asset Contract WASM hash.
3. Mints `initial_supply` to the deployer.
4. Emits a `CreatorTokenDeployedEvent` so indexers can track factory-deployed tokens.
5. Returns the new token's `Address` to the caller.

The web app SDK then sequences two transactions — `deploy_creator_token` followed by `set_profile` — via a `TransactionQueue`.

---

## Deploying Child Contracts from a Factory in Soroban

### How `env.deployer()` Works

Soroban provides `env.deployer().with_address(deployer, salt).deploy(wasm_hash)` which:

- Derives a deterministic contract address from `(deployer_address, salt)`.
- Uploads constructor arguments (passed as the first invocation after deploy).
- Returns the new `Address`.

Because the address is deterministic, the same `(deployer, salt)` pair will always produce the same address. The factory uses `deployer` as part of the salt to ensure each creator's token is unique. A timestamp or sequence component prevents collisions if the same creator deploys multiple tokens.

### WASM Hash Management

The factory stores the `token_wasm_hash: BytesN<32>` of the SEP-41 token WASM in its own instance storage, set at initialization time. The admin can update this hash via `update_token_wasm_hash` to point to a new token implementation without redeploying the factory itself.

This means:

- Tokens deployed before a hash update continue to use the old implementation (no forced upgrade).
- The factory admin controls which token implementation new tokens receive.
- Child token admins receive a separate upgrade path (see below).

---

## Upgrade Authority Model for Child Tokens

### Child Token Admin

When the factory calls `initialize(env, admin, decimals, name, symbol)` on the newly deployed token, it passes `deployer` as the admin. This means:

- The creator (deployer) is the sole admin of their own token from day zero.
- The factory contract retains **no ongoing authority** over child tokens.
- Linkora protocol holds **no authority** over child tokens.

This is intentional: creator tokens are creator-owned assets. The factory is only a deployment convenience.

### Upgrade Path for Child Tokens

Child tokens can upgrade their own WASM via a standard `upgrade(new_wasm_hash)` call, gated behind `admin.require_auth()`. This mirrors the pattern used in the Linkora main contract's own upgrade mechanism.

If the factory admin updates `token_wasm_hash` to point to a new implementation, new deploys will use the updated WASM, but existing child tokens are unaffected unless their own admin explicitly calls `upgrade`.

### No Factory Re-entrancy

The factory does not call back into the Linkora social contract. The SDK sequences `deploy_creator_token` and `set_profile` as two independent transactions, avoiding cross-contract re-entrancy and keeping authorization scopes clean.

---

## Fee Structure

### Rationale

Deploying a contract on Soroban consumes ledger rent (storage fees) and computational fees automatically charged by the network. The factory itself does not impose an additional protocol fee at launch, for two reasons:

1. Network fees already create a natural barrier against spam deployments.
2. Adding a factory fee before meaningful creator adoption would increase friction unnecessarily.

### Future Fee Mechanism

A `deploy_fee: i128` field is reserved in the factory's config (stored in instance storage) and defaults to `0`. When governance decides to activate fees:

- The factory will deduct `deploy_fee` in XLM (or a designated token) from the deployer before deploying the child contract.
- Collected fees go to the Linkora treasury address, the same destination used by tipping fees.
- Fee changes are proposed through the existing on-chain governance system (ADR-004).

### Gas Cost Estimates (Testnet, approximate)

| Operation                    | Ledger entries written                              | Approx. fee (XLM) |
| ---------------------------- | --------------------------------------------------- | ----------------- |
| `deploy_creator_token`       | ~5 (factory state + child instance + token storage) | ~0.05–0.2 XLM     |
| `set_profile` (after deploy) | 2                                                   | ~0.005 XLM        |

These are estimates based on current Soroban fee schedules and may change with network upgrades.

---

## Options Considered

### Option A: Deploy from the Main Linkora Contract

Add `deploy_creator_token` directly to the existing `linkora-contracts` contract.

**Pros:** Single contract, simpler SDK surface.
**Cons:** Token factory WASM hash stored inside a social contract is an unrelated concern. Factory upgrades force a re-audit of the entire social contract. Contract size grows.

### Option B: Separate Factory Contract (Chosen)

A standalone `token-factory` contract holds only factory logic and the token WASM hash.

**Pros:** Separation of concerns, independent upgrade path, smaller audit surface per contract.
**Cons:** Two contract addresses to configure in SDK/web app.

### Option C: Off-Chain Deployment Service

A backend server deploys tokens on behalf of users.

**Pros:** No Soroban complexity for users.
**Cons:** Centralized trust, requires server custody of signing keys, defeats the self-sovereign model of Linkora.

---

## Consequences

- `LinkoraClient` gains a `factoryContractId` config field alongside `contractId`.
- `deployCreatorToken` and `setProfileWithNewToken` are added to the SDK.
- The web onboarding wizard gains a 4-step creator token flow.
- The factory contract must be deployed and its address published before SDK consumers can use it.
- Indexers should subscribe to `CreatorTokenDeployedEvent` to track factory-deployed tokens separately from manually registered tokens.
