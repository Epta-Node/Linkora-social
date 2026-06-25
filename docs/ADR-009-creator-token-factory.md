# ADR-009: Creator Token Factory Contract

## Status

Accepted — 2026-06-24

## Context

`set_profile` accepts a `creator_token` address as a parameter, but Linkora provides no in-app mechanism for creators to deploy a SEP-41 token. The current path requires creators to run the Stellar CLI manually — an unacceptable UX barrier for a consumer-grade web app.

Two approaches exist:

1. **Off-chain deployment**: The web frontend submits a raw Stellar operation that installs a token WASM and deploys a contract instance directly, without a factory contract.
2. **On-chain factory contract**: A dedicated Soroban factory contract holds a token WASM hash, deploys child token contracts via `env.deployer()`, and emits a canonical event.

The factory approach is chosen (see Decision below).

## Decision Drivers

- Creators must be able to deploy a SEP-41 token from the web UI in under three clicks.
- All deployed tokens must be indexable via a single canonical event.
- The factory must not require Linkora admin involvement per deployment.
- Child token contracts must be upgradable by the deploying creator, not by Linkora.
- The WASM used for child tokens must itself be upgradable by the Linkora admin (to patch security issues without redeploying every child).

---

## Options Considered

### Option 1: Off-chain WASM deployment via Freighter

The web app submits a `HostFunctionTypeUploadContractWasm` + `HostFunctionTypeCreateContractV2` operation sequence signed by the user's Freighter wallet.

| Criterion                       | Assessment                                              |
| ------------------------------- | ------------------------------------------------------- |
| User controls upgrade authority | ✅ Natural — user's key is the deployer                 |
| Linkora can patch child WASM    | ❌ Impossible — no shared WASM hash                     |
| Canonical deployment event      | ❌ No single contract emitting consistent topics        |
| Frontend complexity             | High — must bundle WASM bytes in the web app            |
| SDK complexity                  | High — two separate operations, tricky XDR construction |

**Rejected**: No canonical event stream and the WASM patch path is broken.

### Option 2: On-chain Factory Contract (Chosen)

A dedicated `token_factory` Soroban contract stores the token WASM hash in persistent storage. Any user can call `deploy_creator_token`, which:

1. Derives a deterministic contract address via `env.deployer().with_address(deployer, salt)`.
2. Installs the child token contract with the stored WASM hash.
3. Calls `initialize(deployer, decimals, name, symbol)` on the new token.
4. Mints `initial_supply` to the deployer.
5. Emits `CreatorTokenDeployedEvent`.

| Criterion                         | Assessment                                              |
| --------------------------------- | ------------------------------------------------------- |
| User controls upgrade authority   | ✅ Deployer address is stored as admin in child token   |
| Linkora can patch child WASM hash | ✅ Factory admin can call `update_token_wasm(new_hash)` |
| Canonical deployment event        | ✅ Single contract, consistent topics                   |
| Frontend complexity               | Low — one contract call via SDK                         |
| Deterministic addresses           | ✅ `with_address(deployer, salt)` is reproducible       |

**Chosen.**

---

## Design

### 1. Factory Contract Interface

```rust
pub fn initialize(env: Env, admin: Address, token_wasm_hash: BytesN<32>);

pub fn deploy_creator_token(
    env: Env,
    deployer: Address,
    name: String,
    symbol: String,
    decimals: u32,
    initial_supply: i128,
) -> Address;

pub fn update_token_wasm(env: Env, new_wasm_hash: BytesN<32>);
pub fn get_token_wasm_hash(env: Env) -> BytesN<32>;
```

### 2. Child Token Contract (SEP-41 / soroban-token-sdk)

The child token is a minimal SEP-41 compliant token deployed via the stored WASM hash. It exposes the standard `initialize`, `mint`, `transfer`, `balance`, `allowance`, `approve`, `burn`, `decimals`, `name`, `symbol` interface. The deployer becomes the sole `admin` / mint authority.

The factory does **not** retain any authority over child token state after deployment. Upgrade authority for a child token (replacing its WASM) is held by the deployer via the standard Soroban upgrade mechanism — the admin can call `upgrade(new_wasm_hash)` on the child token contract itself.

### 3. Upgrade Authority Model

```
Linkora Admin
    │
    └── update_token_wasm(factory)   ← changes the WASM hash for NEW deployments only
                                        does NOT retroactively affect already-deployed tokens

Creator (Deployer)
    │
    └── upgrade(child_token)         ← upgrades their own token's WASM
```

This two-layer model means:

- The factory admin can improve the default token template for future creators.
- Existing creators retain full control; Linkora cannot force-upgrade their token.
- If a critical bug is found in the token WASM, creators are notified and can voluntarily upgrade.

### 4. Fee Structure

The factory charges **no protocol fee** at deployment time in v1. The rationale:

- Soroban already charges ledger fees for WASM instantiation; adding an extra fee creates friction.
- Creator token monetization (tips, pools) generates protocol revenue via the main Linkora contract.
- A fee mechanism (`deploy_fee_stroops: i128`, paid to `treasury`) is reserved for v2 and can be added via a factory upgrade without changing the child token interface.

### 5. Event Schema

Follows the `(ContractName, EventName, Version)` topic convention established in `EVENTS.md`.

```
Topic 0: TokenFactory      (Symbol)
Topic 1: token_deployed    (Symbol)
Topic 2: v1                (Symbol)

Data: CreatorTokenDeployedEvent {
    deployer:      Address,
    token_address: Address,
    name:          String,
    symbol:        String,
}
```

### 6. Storage Layout

| Key          | Type         | TTL      | Purpose                               |
| ------------ | ------------ | -------- | ------------------------------------- |
| `ADMIN`      | `Address`    | instance | Factory admin (can update WASM hash)  |
| `TOKEN_WASM` | `BytesN<32>` | instance | WASM hash for child token deployments |
| `INIT`       | `bool`       | instance | Prevents double-initialization        |

All keys are instance-storage (low cost; factory state is always needed).

### 7. Salt Strategy

Salt is derived as `sha256(deployer || symbol_bytes)`. This means:

- A given deployer can only deploy one token per symbol (deterministic dedup).
- The token address is predictable off-chain before deployment.

---

## Consequences

**Positive:**

- Creators deploy a SEP-41 token in a single transaction from the web UI.
- Indexers can listen to `TokenFactory / token_deployed / v1` for all new creator tokens.
- The Linkora admin can patch the token WASM for new deployments without touching existing ones.
- No privileged Linkora involvement required per individual deployment.

**Negative / Trade-offs:**

- A separate Soroban contract must be deployed and maintained.
- The factory admin key is a centralisation point for the WASM hash. Mitigated by: the admin cannot affect already-deployed tokens; it only controls future ones.
- Creators are responsible for upgrading their own token if a bug is patched. A governance-driven upgrade path (Linkora suggests, creator confirms) is a v2 concern.

## Related ADRs

- ADR-004: Governance — factory admin upgrade could be placed under governance in a future iteration.
