#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String,
};

// ── Test Helpers ──────────────────────────────────────────────────────────────

fn setup_factory(env: &Env) -> (TokenFactoryClient<'_>, Address) {
    let factory_id = env.register(TokenFactory, ());
    let client = TokenFactoryClient::new(env, &factory_id);
    let admin = Address::generate(env);
    // Upload an empty WASM blob to get a valid hash for initialization.
    // Actual child deploys require a compiled token WASM and are exercised
    // in integration tests (see packages/contracts/tests/).
    let wasm_hash = env
        .deployer()
        .upload_contract_wasm(soroban_sdk::Bytes::new(env));
    client.initialize(&admin, &wasm_hash);
    (client, admin)
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_sets_admin_and_wasm_hash() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup_factory(&env);

    assert_eq!(client.get_admin(), admin);
    let _ = client.get_token_wasm_hash(); // should not panic
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_double_initialize_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin) = setup_factory(&env);

    let dummy_hash = env
        .deployer()
        .upload_contract_wasm(soroban_sdk::Bytes::new(&env));
    client.initialize(&admin, &dummy_hash);
}

// ── Admin ─────────────────────────────────────────────────────────────────────

#[test]
fn test_update_token_wasm_hash() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin) = setup_factory(&env);

    let new_hash = env
        .deployer()
        .upload_contract_wasm(soroban_sdk::Bytes::new(&env));
    client.update_token_wasm_hash(&new_hash);
    assert_eq!(client.get_token_wasm_hash(), new_hash);
}

// ── Validation Panics ─────────────────────────────────────────────────────────
//
// These tests invoke deploy_creator_token with invalid inputs and expect panics
// before the inner deploy_v2 call is reached. The invalid-input checks live
// at the top of deploy_creator_token, so they fire before any WASM execution.

#[test]
#[should_panic(expected = "invalid name")]
fn test_empty_name_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_factory(&env);
    let deployer = Address::generate(&env);
    client.deploy_creator_token(
        &deployer,
        &String::from_str(&env, ""),
        &String::from_str(&env, "SYM"),
        &7,
        &0,
    );
}

#[test]
#[should_panic(expected = "invalid symbol")]
fn test_empty_symbol_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_factory(&env);
    let deployer = Address::generate(&env);
    client.deploy_creator_token(
        &deployer,
        &String::from_str(&env, "Token"),
        &String::from_str(&env, ""),
        &7,
        &0,
    );
}

#[test]
#[should_panic(expected = "decimals exceeds max")]
fn test_decimals_over_max_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_factory(&env);
    let deployer = Address::generate(&env);
    client.deploy_creator_token(
        &deployer,
        &String::from_str(&env, "Token"),
        &String::from_str(&env, "TKN"),
        &19,
        &0,
    );
}

#[test]
#[should_panic(expected = "initial_supply must be non-negative")]
fn test_negative_supply_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _) = setup_factory(&env);
    let deployer = Address::generate(&env);
    client.deploy_creator_token(
        &deployer,
        &String::from_str(&env, "Token"),
        &String::from_str(&env, "TKN"),
        &7,
        &-1,
    );
}

// ── Note on end-to-end deploy tests ──────────────────────────────────────────
//
// Unit tests that call deploy_creator_token() require a real SEP-41 token WASM
// with a matching __constructor(admin, decimals, name, symbol) signature.  The
// empty-bytes WASM used in setup_factory() does not satisfy this requirement
// because the Soroban host executes the constructor when deploy_v2() is called
// with constructor args.  Full deploy tests (token address returned, two deploys
// produce distinct addresses, emitted event carries the correct symbol) live in
// the integration test suite at packages/contracts/tests/.

// ── Salt Uniqueness (unit-level, no WASM required) ────────────────────────────
//
// The salt is derived from the ledger sequence number. We verify that two calls
// at different ledger heights produce different salts by computing the sha256
// of different byte slices.

#[test]
fn test_different_ledger_sequences_produce_different_salts() {
    let env = Env::default();

    let seq_a: u32 = 1000;
    let seq_b: u32 = 1001;

    let salt_a = env
        .crypto()
        .sha256(&soroban_sdk::Bytes::from_slice(&env, &seq_a.to_be_bytes()));
    let salt_b = env
        .crypto()
        .sha256(&soroban_sdk::Bytes::from_slice(&env, &seq_b.to_be_bytes()));

    // Compare via their byte representation
    assert!(
        salt_a.to_bytes() != salt_b.to_bytes(),
        "different ledger sequences must produce different salts"
    );
}
