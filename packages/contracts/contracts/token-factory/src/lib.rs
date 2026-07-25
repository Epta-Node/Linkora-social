#![no_std]

mod test;

use soroban_sdk::{
    contract, contractevent, contractimpl, symbol_short, Address, BytesN, Env, String, Symbol,
};

// ── Storage Keys ──────────────────────────────────────────────────────────────

const ADMIN: Symbol = symbol_short!("ADMIN");
const TOKEN_WASM: Symbol = symbol_short!("TOKN_WSM");
const INIT: Symbol = symbol_short!("INIT");

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
    #[topic]
    pub deployer: Address,
    #[topic]
    pub token_address: Address,
    pub name: String,
    pub symbol: String,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct TokenFactoryContract;

#[contractimpl]
impl TokenFactoryContract {
    // ── Admin ─────────────────────────────────────────────────────────────────

    /// Initialise the factory. Must be called exactly once after deployment.
    pub fn initialize(env: Env, admin: Address, token_wasm_hash: BytesN<32>) {
        if env
            .storage()
            .instance()
            .get::<Symbol, bool>(&INIT)
            .unwrap_or(false)
        {
            panic!("already initialized");
        }
        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&TOKEN_WASM, &token_wasm_hash);
        env.storage().instance().set(&INIT, &true);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    /// Replace the token WASM hash used for new deployments.
    /// Does NOT retroactively affect already-deployed child tokens.
    pub fn update_token_wasm(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&ADMIN).unwrap();
        admin.require_auth();
        env.storage().instance().set(&TOKEN_WASM, &new_wasm_hash);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    /// Read the currently stored token WASM hash.
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
    /// Returns the new token contract address.
    pub fn deploy_creator_token(
        env: Env,
        deployer: Address,
        name: String,
        symbol: String,
        decimals: u32,
        initial_supply: i128,
    ) -> Address {
        deployer.require_auth();

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
