#![no_std]
use soroban_sdk::{
    contract, contractevent, contractimpl, symbol_short, token, Address, BytesN, Env, String,
    Symbol,
};

// ── Storage Keys ──────────────────────────────────────────────────────────────

const ADMIN: Symbol = symbol_short!("ADMIN");
const TOKEN_WASM: Symbol = symbol_short!("TKN_WASM");
const INITIALIZED: Symbol = symbol_short!("INIT");

// ── TTL ───────────────────────────────────────────────────────────────────────

const LEDGER_BUMP: u32 = 535_000;
const LEDGER_THRESHOLD: u32 = 535_000 - 100;

// ── Validation ────────────────────────────────────────────────────────────────

const MAX_NAME_LEN: u32 = 64;
const MAX_SYMBOL_LEN: u32 = 12;
const MAX_DECIMALS: u32 = 18;

// ── Events ────────────────────────────────────────────────────────────────────

#[contractevent]
#[derive(Clone, Debug)]
pub struct CreatorTokenDeployedEvent {
    #[topic]
    pub deployer: Address,
    #[topic]
    pub token_address: Address,
    pub name: String,
    pub symbol: String,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct TokenFactory;

#[contractimpl]
impl TokenFactory {
    // ── Initialization ────────────────────────────────────────────────────────

    /// Initialize the factory with an admin address and the token WASM hash to
    /// use for all child deploys.
    pub fn initialize(env: Env, admin: Address, token_wasm_hash: BytesN<32>) {
        Self::bump_instance(&env);
        if env
            .storage()
            .instance()
            .get::<Symbol, bool>(&INITIALIZED)
            .unwrap_or(false)
        {
            panic!("already initialized");
        }
        env.storage().instance().set(&INITIALIZED, &true);
        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&TOKEN_WASM, &token_wasm_hash);
    }

    /// Update the WASM hash used for future child token deploys.
    /// Only affects new tokens — existing child tokens are not upgraded.
    pub fn update_token_wasm_hash(env: Env, new_wasm_hash: BytesN<32>) {
        Self::bump_instance(&env);
        Self::require_admin(&env);
        env.storage().instance().set(&TOKEN_WASM, &new_wasm_hash);
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&ADMIN).unwrap()
    }

    pub fn get_token_wasm_hash(env: Env) -> BytesN<32> {
        env.storage().instance().get(&TOKEN_WASM).unwrap()
    }

    // ── Deploy ────────────────────────────────────────────────────────────────

    /// Deploy a new minimal SEP-41 token contract.
    ///
    /// - `deployer`       — the creator; receives `initial_supply` and becomes the
    ///                      token admin after the deployment completes.
    /// - `name`           — token name (max 64 chars).
    /// - `symbol`         — token symbol (max 12 chars).
    /// - `decimals`       — decimal places (max 18).
    /// - `initial_supply` — stroops minted to `deployer`; must be >= 0.
    ///
    /// **Admin handoff:** The factory is set as the token admin during deployment
    /// so it can mint `initial_supply` in the same transaction without requiring
    /// an additional deployer signature.  Once minting is complete the factory
    /// immediately calls `set_admin(deployer)` so the creator holds all admin
    /// authority post-launch.
    ///
    /// **Salt constraint:** The deploy salt is derived from the current ledger
    /// sequence number only.  Two calls from the same `deployer` in the same
    /// ledger will produce the same salt and therefore the same contract address,
    /// causing a "contract already exists" error.  To avoid this, each deployer
    /// must submit at most one `deploy_creator_token` per ledger.
    ///
    /// Returns the address of the newly deployed token contract.
    pub fn deploy_creator_token(
        env: Env,
        deployer: Address,
        name: String,
        symbol: String,
        decimals: u32,
        initial_supply: i128,
    ) -> Address {
        Self::bump_instance(&env);
        deployer.require_auth();

        // ── Validation ────────────────────────────────────────────────────────
        assert!(name.len() > 0 && name.len() <= MAX_NAME_LEN, "invalid name");
        assert!(
            symbol.len() > 0 && symbol.len() <= MAX_SYMBOL_LEN,
            "invalid symbol"
        );
        assert!(decimals <= MAX_DECIMALS, "decimals exceeds max");
        assert!(initial_supply >= 0, "initial_supply must be non-negative");

        // ── Retrieve stored WASM hash ─────────────────────────────────────────
        let wasm_hash: BytesN<32> = env
            .storage()
            .instance()
            .get(&TOKEN_WASM)
            .expect("factory not initialized");

        // ── Derive unique salt from ledger sequence ───────────────────────────
        // The factory's deployer() already incorporates the deployer address when
        // computing the child contract address, so hashing the ledger sequence
        // alone is sufficient to distinguish successive calls by the same deployer
        // across different ledgers.  Note: two calls from the same deployer within
        // a single ledger will collide — see the docstring for details.
        let salt = env.crypto().sha256(&soroban_sdk::Bytes::from_slice(
            &env,
            &env.ledger().sequence().to_be_bytes(),
        ));

        // ── Deploy child contract ─────────────────────────────────────────────
        let token_address = env
            .deployer()
            .with_address(deployer.clone(), salt)
            .deploy_v2(
                wasm_hash,
                (
                    env.current_contract_address(),
                    decimals,
                    name.clone(),
                    symbol.clone(),
                ),
            );

        let token_client = token::StellarAssetClient::new(&env, &token_address);

        // ── Mint initial supply to deployer ───────────────────────────────────
        // The factory is the current admin, so no extra auth is required here.
        if initial_supply > 0 {
            token_client.mint(&deployer, &initial_supply);
        }

        // ── Hand off admin rights to the creator ──────────────────────────────
        // After minting we unconditionally transfer admin authority to the
        // deployer so the creator manages their token post-launch without any
        // factory involvement.
        token_client.set_admin(&deployer);

        // ── Emit event ────────────────────────────────────────────────────────
        CreatorTokenDeployedEvent {
            deployer: deployer.clone(),
            token_address: token_address.clone(),
            name,
            symbol,
        }
        .publish(&env);

        token_address
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn require_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&ADMIN).unwrap();
        admin.require_auth();
    }

    fn bump_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod test;
