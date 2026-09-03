#![no_std]

mod test;

use soroban_sdk::{
    contract, contractevent, contractimpl, symbol_short, Address, BytesN, Env, String, Symbol,
};

#[macro_export]
macro_rules! require_with_error {
    ($env:expr, $cond:expr, $msg:expr) => {{
        if !($cond) {
            let _ = &$env;
            panic!("{}", $msg);
        }
    }};
}

// ── Storage Keys ──────────────────────────────────────────────────────────────

const ADMIN: Symbol = symbol_short!("ADMIN");
const TOKEN_WASM: Symbol = symbol_short!("TOKN_WSM");
const INIT: Symbol = symbol_short!("INIT");

// ── Validation Constants ────────────────────────────────────────────────────────

const MAX_DECIMALS: u32 = 38;
const MAX_NAME_LEN: u32 = 64;
const MAX_SYMBOL_LEN: u32 = 16;

// ── TTL ───────────────────────────────────────────────────────────────────────

const LEDGER_BUMP: u32 = 535_000;
const LEDGER_THRESHOLD: u32 = 535_000 - 100;

// ── Events ────────────────────────────────────────────────────────────────────

/// Emitted when a creator token is successfully deployed via the factory.
///
/// Topics: (TokenFactory, token_deployed, v1)
#[contractevent]
#[derive(Clone)]
pub struct CreatorTokenDeployedEvent {
    /// The account that requested the deployment and now administers the
    /// new token (SEP-41 admin, mint authority).
    #[topic]
    pub deployer: Address,
    /// Deterministic address of the newly deployed SEP-41 token contract.
    #[topic]
    pub token_address: Address,
    /// Human-readable token name, as passed to `deploy_creator_token`.
    pub name: String,
    /// Token symbol/ticker, as passed to `deploy_creator_token`.
    pub symbol: String,
}

// ── Limits ───────────────────────────────────────────────────────────────────

pub const MAX_DECIMALS: u32 = 18;
pub const MAX_INITIAL_SUPPLY: i128 = 100_000_000_000_000_000_000_000_000_000_000_i128;

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct TokenFactoryContract;

#[contractimpl]
impl TokenFactoryContract {
    // ── Admin ─────────────────────────────────────────────────────────────────

    /// Initialise the factory. Must be called exactly once after deployment;
    /// panics with `"already initialized"` on any subsequent call.
    ///
    /// @param admin Address stored as the factory administrator; required to
    ///   authorize `update_token_wasm`.
    /// @param token_wasm_hash WASM hash of the SEP-41 token contract that
    ///   `deploy_creator_token` will instantiate for new creator tokens.
    /// Side effects: sets instance storage (`ADMIN`, `TOKEN_WASM`, `INIT`)
    /// and extends the instance TTL.
    pub fn initialize(env: Env, admin: Address, token_wasm_hash: BytesN<32>) {
        if env
            .storage()
            .instance()
            .get::<Symbol, bool>(&INIT)
            .unwrap_or(false)
        {
            panic!("already initialized");
        }

        let zero_hash = BytesN::from_array(&env, &[0u8; 32]);
        require_with_error!(
            &env,
            token_wasm_hash != zero_hash,
            "token_wasm_hash must not be zero"
        );
        // Validate admin is not the zero address by requiring auth.
        // A zero address cannot satisfy require_auth, so this implicitly rejects it.
        admin.require_auth();

        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&TOKEN_WASM, &token_wasm_hash);
        env.storage().instance().set(&INIT, &true);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    /// Replace the token WASM hash used for new deployments.
    /// Does NOT retroactively affect already-deployed child tokens.
    ///
    /// Precondition: admin-only — requires auth from the address stored by
    /// `initialize`.
    /// @param new_wasm_hash WASM hash used by subsequent `deploy_creator_token` calls.
    /// Side effects: overwrites instance storage (`TOKEN_WASM`) and extends the instance TTL.
    pub fn update_token_wasm(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&ADMIN).unwrap();
        admin.require_auth();
        let zero_hash = BytesN::from_array(&env, &[0u8; 32]);
        require_with_error!(
            &env,
            new_wasm_hash != zero_hash,
            "token_wasm_hash must not be zero"
        );
        env.storage().instance().set(&TOKEN_WASM, &new_wasm_hash);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    /// Read the currently stored token WASM hash.
    ///
    /// @return The WASM hash that `deploy_creator_token` currently deploys.
    /// Side effect: extends the instance TTL on every read.
    pub fn get_token_wasm_hash(env: Env) -> BytesN<32> {
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.storage().instance().get(&TOKEN_WASM).unwrap()
    }

    // ── Deployment ────────────────────────────────────────────────────────────

    /// Deploy a minimal SEP-41 token contract on behalf of `deployer`.
    ///
    /// - Derives a deterministic address via `env.deployer().with_address(deployer, salt)`.
    /// - Initialises the child token (name, symbol, decimals, deployer as admin).
    /// - Mints `initial_supply` to `deployer`.
    /// - Emits `CreatorTokenDeployedEvent`.
    ///
    /// Precondition: `deployer` must authorize the call (`require_auth`).
    /// @param deployer Account that will own/administer the new token and receive `initial_supply`.
    /// @param name Human-readable token name.
    /// @param symbol Token symbol/ticker; combined with `deployer` to derive the deployment salt.
    /// @param decimals Decimal places for the new SEP-41 token.
    /// @param initial_supply Amount minted to `deployer` on deployment; skipped if `<= 0`.
    /// @return Address of the newly deployed token contract.
    pub fn deploy_creator_token(
        env: Env,
        deployer: Address,
        name: String,
        symbol: String,
        decimals: u32,
        initial_supply: i128,
    ) -> Address {
        deployer.require_auth();

        require_with_error!(
            &env,
            decimals <= MAX_DECIMALS,
            "decimals must be at most 38"
        );
        require_with_error!(
            &env,
            !name.is_empty() && name.len() <= MAX_NAME_LEN,
            "name must be 1-64 characters"
        );
        require_with_error!(
            &env,
            !symbol.is_empty() && symbol.len() <= MAX_SYMBOL_LEN,
            "symbol must be 1-16 characters"
        );

        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        let wasm_hash: BytesN<32> = env.storage().instance().get(&TOKEN_WASM).unwrap();

        // Deterministic salt: deployer address bytes XOR'd with symbol bytes ensures
        // (deployer, symbol) uniqueness while keeping the address predictable.
        let salt = Self::derive_salt(&env, &deployer, &symbol);

        let token_address = env
            .deployer()
            .with_address(deployer.clone(), salt)
            .deploy_v2(wasm_hash, ());

        // Initialise the newly deployed token contract.
        // The child is a standard soroban-token / SEP-41 contract whose
        // `initialize` signature is: (admin, decimal, name, symbol).
        let token_init = soroban_sdk::token::StellarAssetClient::new(&env, &token_address);
        let _ = token_init; // SEP-41 tokens deployed via WASM don't expose StellarAssetClient;
                            // we call initialize via invoke_contract instead.

        env.invoke_contract::<()>(
            &token_address,
            &Symbol::new(&env, "initialize"),
            soroban_sdk::vec![
                &env,
                soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&deployer, &env),
                soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&decimals, &env),
                soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&name, &env),
                soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&symbol, &env),
            ],
        );

        // Mint initial supply to deployer via the token's mint function.
        if initial_supply > 0 {
            env.invoke_contract::<()>(
                &token_address,
                &Symbol::new(&env, "mint"),
                soroban_sdk::vec![
                    &env,
                    soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&deployer, &env),
                    soroban_sdk::IntoVal::<Env, soroban_sdk::Val>::into_val(&initial_supply, &env,),
                ],
            );
        }

        // Emit canonical factory event.
        CreatorTokenDeployedEvent {
            deployer,
            token_address: token_address.clone(),
            name,
            symbol,
        }
        .publish(&env);

        token_address
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    /// Derive a deterministic CREATE2-style salt for a (deployer, symbol) pair,
    /// so a given deployer can deploy at most one token per symbol at a
    /// predictable address.
    ///
    /// @param deployer Account requesting the deployment.
    /// @param symbol Token symbol being deployed.
    /// @return sha256 of `deployer`'s XDR bytes concatenated with `symbol`'s bytes.
    pub fn derive_salt(env: &Env, deployer: &Address, symbol: &String) -> BytesN<32> {
        // Build a bytes buffer: deployer XDR bytes followed by symbol bytes.
        // sha256 over the concatenation gives a 32-byte deterministic salt.
        use soroban_sdk::{xdr::ToXdr, Bytes};
        let mut buf = Bytes::new(env);
        buf.append(&deployer.clone().to_xdr(env));
        buf.append(&symbol.to_bytes());
        env.crypto().sha256(&buf).into()
    }
}
