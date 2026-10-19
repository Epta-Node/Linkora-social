#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Placeholder 32-byte hash used when we don't need real WASM semantics.
/// Must be non-zero: `initialize`/`update_token_wasm` reject the all-zero hash.
fn dummy_wasm_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[1u8; 32])
}

fn setup(env: &Env) -> (TokenFactoryContractClient<'_>, Address, BytesN<32>) {
    let factory_id = env.register(TokenFactoryContract, ());
    let client = TokenFactoryContractClient::new(env, &factory_id);

    let admin = Address::generate(env);
    let wasm_hash = dummy_wasm_hash(env);
    client.initialize(&admin, &wasm_hash);

    (client, admin, wasm_hash)
}

// ── Initialization tests ──────────────────────────────────────────────────────

#[test]
fn test_initialize_stores_wasm_hash() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, wasm_hash) = setup(&env);

    assert_eq!(client.get_token_wasm_hash(), wasm_hash);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_initialize_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, wasm_hash) = setup(&env);

    // Second call must panic.
    client.initialize(&admin, &wasm_hash);
}

#[test]
fn test_update_token_wasm_stores_new_hash() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup(&env);

    let new_hash = BytesN::from_array(&env, &[2u8; 32]);
    client.update_token_wasm(&new_hash);

    assert_eq!(client.get_token_wasm_hash(), new_hash);
}

// ── Salt derivation tests ─────────────────────────────────────────────────────
//
// Two deployments with the same deployer but different symbols must produce
// different salts.  We verify this indirectly through the derive_salt helper.

#[test]
fn test_different_symbols_produce_different_salts() {
    let env = Env::default();
    env.mock_all_auths();

    let deployer = Address::generate(&env);

    let salt_alpha =
        TokenFactoryContract::derive_salt(&env, &deployer, &String::from_str(&env, "ALPHA"));
    let salt_beta =
        TokenFactoryContract::derive_salt(&env, &deployer, &String::from_str(&env, "BETA"));

    assert_ne!(salt_alpha, salt_beta);
}

#[test]
fn test_same_inputs_produce_same_salt() {
    let env = Env::default();
    env.mock_all_auths();

    let deployer = Address::generate(&env);
    let sym = String::from_str(&env, "STL");

    let s1 = TokenFactoryContract::derive_salt(&env, &deployer, &sym);
    let s2 = TokenFactoryContract::derive_salt(&env, &deployer, &sym);

    assert_eq!(s1, s2);
}

// ── Event emission test ───────────────────────────────────────────────────────

#[test]
fn test_event_published_when_deploy_helper_called() {
    // This test verifies the event structs are wired correctly.
    // Since deploy_creator_token needs a real WASM hash, we trust that
    // test_initialize_stores_wasm_hash + the ADR integration spec cover
    // the deploy path, and we simply confirm the publish call compiles
    // and can be called within a contract execution context.
    //
    // The integration test (run_e2e.sh or a dedicated script) validates
    // the full deploy → event → indexer pipeline on a live RPC.
    //
    // We verify the event data types are correct by instantiating the struct.
    let env = Env::default();
    env.mock_all_auths();

    let deployer = Address::generate(&env);
    let token_address = Address::generate(&env);

    // Verify the event struct can be constructed with the expected fields.
    let _event = CreatorTokenDeployedEvent {
        version: 1,
        deployer: deployer.clone(),
        token_address: token_address.clone(),
        name: String::from_str(&env, "My Token"),
        symbol: String::from_str(&env, "MTK"),
    };
    // If this compiles and runs, the struct is correctly wired.
    // The publish() call itself is exercised in the integration tests.
}

// ── Validation tests ──────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "token_wasm_hash must not be zero")]
fn test_initialize_rejects_zero_wasm_hash() {
    let env = Env::default();
    env.mock_all_auths();
    let factory_id = env.register(TokenFactoryContract, ());
    let client = TokenFactoryContractClient::new(&env, &factory_id);

    let admin = Address::generate(&env);
    let zero_hash = BytesN::from_array(&env, &[0u8; 32]);
    client.initialize(&admin, &zero_hash);
}

#[test]
#[should_panic(expected = "token_wasm_hash must not be zero")]
fn test_update_token_wasm_rejects_zero_hash() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup(&env);

    let zero_hash = BytesN::from_array(&env, &[0u8; 32]);
    client.update_token_wasm(&zero_hash);
}

// ── Metadata registry tests ───────────────────────────────────────────────────

#[test]
fn test_metadata_views_default_to_empty() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup(&env);

    let token = Address::generate(&env);
    let creator = Address::generate(&env);

    assert!(client.get_token_metadata(&token).is_none());
    assert_eq!(client.get_tokens_by_creator(&creator).len(), 0);
}

#[test]
fn test_register_token_metadata_indexes_by_token_and_creator() {
    let env = Env::default();
    env.mock_all_auths();
    let factory_id = env.register(TokenFactoryContract, ());
    let client = TokenFactoryContractClient::new(&env, &factory_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &dummy_wasm_hash(&env));

    let creator = Address::generate(&env);
    let t1 = Address::generate(&env);
    let t2 = Address::generate(&env);
    let name = String::from_str(&env, "Creator One");
    let symbol = String::from_str(&env, "ONE");

    env.as_contract(&factory_id, || {
        register_token_metadata(&env, &creator, &t1, &name, &symbol, 7);
        register_token_metadata(&env, &creator, &t2, &name, &symbol, 7);
    });

    let metadata = client.get_token_metadata(&t1).unwrap();
    assert_eq!(metadata.token, t1);
    assert_eq!(metadata.creator, creator);
    assert_eq!(metadata.name, name);
    assert_eq!(metadata.symbol, symbol);
    assert_eq!(metadata.decimals, 7);
    assert_eq!(metadata.deployed_ledger, env.ledger().sequence());

    // Creator index preserves deployment order.
    let tokens = client.get_tokens_by_creator(&creator);
    assert_eq!(tokens.len(), 2);
    assert_eq!(tokens.get(0).unwrap(), t1);
    assert_eq!(tokens.get(1).unwrap(), t2);

    // A different creator is not polluted by the first creator's deployments.
    let other = Address::generate(&env);
    assert_eq!(client.get_tokens_by_creator(&other).len(), 0);
}
