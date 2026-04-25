#![cfg(test)]

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{storage::Persistent as _, Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, String,
};

fn setup_env() -> Env {
    let env = Env::default();
    env.ledger().with_mut(|li| {
        li.sequence_number = 100_000;
        li.min_persistent_entry_ttl = 500;
        li.max_entry_ttl = 600_000;
    });
    env
}

fn setup_token(env: &Env, admin: &Address) -> Address {
    let token_id = env.register_stellar_asset_contract_v2(admin.clone());
    StellarAssetClient::new(env, &token_id.address()).mint(admin, &10_000);
    token_id.address()
}

// ── Profile tests ─────────────────────────────────────────────────────────────

#[test]
fn test_set_and_get_profile() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    client.set_profile(&user, &String::from_str(&env, "alice"), &token);

    let profile = client.get_profile(&user).unwrap();
    assert_eq!(profile.username, String::from_str(&env, "alice"));
}

// ── Follow tests ──────────────────────────────────────────────────────────────

#[test]
fn test_follow_is_idempotent() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.follow(&alice, &bob);
    client.follow(&alice, &bob);

    let following = client.get_following(&alice);
    assert_eq!(following.len(), 1);
    assert_eq!(following.get(0).unwrap(), bob);
}

// ── Post tests ────────────────────────────────────────────────────────────────

#[test]
fn test_sequential_posts() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);
    let author = Address::generate(&env);

    env.ledger().set_timestamp(1000);
    let id1 = client.create_post(&author, &String::from_str(&env, "First post"));
    assert_eq!(id1, 1);
    assert_eq!(client.get_post(&id1).unwrap().timestamp, 1000);

    env.ledger().set_timestamp(2000);
    let id2 = client.create_post(&author, &String::from_str(&env, "Second post"));
    assert_eq!(id2, 2);
    assert_eq!(client.get_post(&id2).unwrap().timestamp, 2000);
}

// ── Pool tests ────────────────────────────────────────────────────────────────

#[test]
#[should_panic(expected = "deposit amount must be positive")]
fn test_pool_deposit_zero_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);
    let user = Address::generate(&env);
    let token = setup_token(&env, &user);
    client.pool_deposit(&user, &symbol_short!("community"), &token, &0);
}

#[test]
#[should_panic(expected = "deposit amount must be positive")]
fn test_pool_deposit_negative_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);
    let user = Address::generate(&env);
    let token = setup_token(&env, &user);
    client.pool_deposit(&user, &symbol_short!("community"), &token, &-1);
}

#[test]
#[should_panic(expected = "withdrawal amount must be positive")]
fn test_pool_withdraw_zero_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);
    let user = Address::generate(&env);
    let token = setup_token(&env, &user);
    client.pool_deposit(&user, &symbol_short!("community"), &token, &1_000);
    client.pool_withdraw(&user, &symbol_short!("community"), &0);
}

#[test]
#[should_panic(expected = "withdrawal amount must be positive")]
fn test_pool_withdraw_negative_amount() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);
    let user = Address::generate(&env);
    let token = setup_token(&env, &user);
    client.pool_deposit(&user, &symbol_short!("community"), &token, &1_000);
    client.pool_withdraw(&user, &symbol_short!("community"), &-1);
}

// ── TTL tests ─────────────────────────────────────────────────────────────────

#[test]
fn test_ttl_extended_after_set_profile() {
    let env = setup_env();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    client.set_profile(&user, &String::from_str(&env, "alice"), &token);

    env.as_contract(&contract_id, || {
        let key = (PROFILES, user.clone());
        let ttl = env.storage().persistent().get_ttl(&key);
        assert!(ttl >= LEDGER_THRESHOLD, "profile TTL should be bumped after set");
    });
}

#[test]
fn test_ttl_extended_on_get_profile() {
    let env = setup_env();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    client.set_profile(&user, &String::from_str(&env, "alice"), &token);

    // Advance ledger so TTL has partially decayed
    env.ledger().with_mut(|li| li.sequence_number += 100_000);

    client.get_profile(&user);

    env.as_contract(&contract_id, || {
        let key = (PROFILES, user.clone());
        let ttl = env.storage().persistent().get_ttl(&key);
        assert!(ttl >= LEDGER_THRESHOLD, "profile TTL should be bumped on get");
    });
}

#[test]
fn test_ttl_extended_after_create_post() {
    let env = setup_env();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let author = Address::generate(&env);
    let post_id = client.create_post(&author, &String::from_str(&env, "hello"));

    env.as_contract(&contract_id, || {
        let key = (POSTS, post_id);
        let ttl = env.storage().persistent().get_ttl(&key);
        assert!(ttl >= LEDGER_THRESHOLD, "post TTL should be bumped after create");
    });
}

#[test]
fn test_ttl_extended_on_get_post() {
    let env = setup_env();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let author = Address::generate(&env);
    let post_id = client.create_post(&author, &String::from_str(&env, "hello"));

    env.ledger().with_mut(|li| li.sequence_number += 100_000);

    client.get_post(&post_id);

    env.as_contract(&contract_id, || {
        let key = (POSTS, post_id);
        let ttl = env.storage().persistent().get_ttl(&key);
        assert!(ttl >= LEDGER_THRESHOLD, "post TTL should be bumped on get");
    });
}

#[test]
fn test_ttl_extended_after_pool_deposit() {
    let env = setup_env();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    let token = setup_token(&env, &user);
    let pool_id = symbol_short!("pool1");
    client.pool_deposit(&user, &pool_id, &token, &500);

    env.as_contract(&contract_id, || {
        let key = (POOLS, pool_id.clone());
        let ttl = env.storage().persistent().get_ttl(&key);
        assert!(ttl >= LEDGER_THRESHOLD, "pool TTL should be bumped after deposit");
    });
}

#[test]
fn test_ttl_extended_on_get_pool() {
    let env = setup_env();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    let token = setup_token(&env, &user);
    let pool_id = symbol_short!("pool1");
    client.pool_deposit(&user, &pool_id, &token, &500);

    env.ledger().with_mut(|li| li.sequence_number += 100_000);

    client.get_pool(&pool_id);

    env.as_contract(&contract_id, || {
        let key = (POOLS, pool_id.clone());
        let ttl = env.storage().persistent().get_ttl(&key);
        assert!(ttl >= LEDGER_THRESHOLD, "pool TTL should be bumped on get");
    });
}

#[test]
fn test_ttl_extended_after_follow() {
    let env = setup_env();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.follow(&alice, &bob);

    env.as_contract(&contract_id, || {
        let key = (FOLLOWS, alice.clone());
        let ttl = env.storage().persistent().get_ttl(&key);
        assert!(ttl >= LEDGER_THRESHOLD, "follow list TTL should be bumped after follow");
    });
}
