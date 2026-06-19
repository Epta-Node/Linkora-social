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
    /// - `deployer`       — the creator; becomes the token admin, receives `initial_supply`.
    /// - `name`           — token name (max 64 chars).
    /// - `symbol`         — token symbol (max 12 chars).
    /// - `decimals`       — decimal places (max 18).
    /// - `initial_supply` — stroops minted to `deployer`; must be >= 0.
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

        // ── Derive unique salt from deployer + ledger sequence ────────────────
        // Using the current ledger sequence as part of the salt ensures that the
        // same deployer can deploy multiple tokens without address collisions.
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

        // ── Mint initial supply to deployer ───────────────────────────────────
        if initial_supply > 0 {
            let token_client = token::StellarAssetClient::new(&env, &token_address);
            token_client.mint(&deployer, &initial_supply);
        }

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
