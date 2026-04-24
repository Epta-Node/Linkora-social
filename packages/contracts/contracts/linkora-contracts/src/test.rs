#![cfg(test)]

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, String,
};

fn setup_token(env: &Env, admin: &Address) -> Address {
    let token_id = env.register_stellar_asset_contract_v2(admin.clone());
    StellarAssetClient::new(env, &token_id.address()).mint(admin, &10_000);
    token_id.address()
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
    let pool_id = symbol_short!("community");

    client.pool_deposit(&user, &pool_id, &token, &0);
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
    let pool_id = symbol_short!("community");

    client.pool_deposit(&user, &pool_id, &token, &-1);
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
    let pool_id = symbol_short!("community");

    client.pool_deposit(&user, &pool_id, &token, &1_000);
    client.pool_withdraw(&user, &pool_id, &0);
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
    let pool_id = symbol_short!("community");

    client.pool_deposit(&user, &pool_id, &token, &1_000);
    client.pool_withdraw(&user, &pool_id, &-1);
}

// ── Post tests ────────────────────────────────────────────────────────────────

#[test]
fn test_sequential_posts() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let author = Address::generate(&env);

    let ts1 = 1000;
    env.ledger().set_timestamp(ts1);

    let post_id1 = client.create_post(&author, &String::from_str(&env, "First post"));
    assert_eq!(post_id1, 1);

    let post1 = client.get_post(&post_id1).unwrap();
    assert_eq!(post1.timestamp, ts1);
    assert_eq!(post1.id, 1);

    let ts2 = 2000;
    env.ledger().set_timestamp(ts2);

    let post_id2 = client.create_post(&author, &String::from_str(&env, "Second post"));
    assert_eq!(post_id2, 2);

    let post2 = client.get_post(&post_id2).unwrap();
    assert_eq!(post2.timestamp, ts2);
    assert_eq!(post2.id, 2);

    assert!(post_id1 != post_id2);
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

    let following = client.get_following(&alice, &0, &10);
    assert_eq!(following.len(), 1);
    assert_eq!(following.get(0).unwrap(), bob);
}

// ── Pagination: get_following ─────────────────────────────────────────────────

#[test]
fn test_get_following_first_page() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let alice = Address::generate(&env);
    let users: soroban_sdk::Vec<Address> = (0..5)
        .map(|_| Address::generate(&env))
        .collect::<std::vec::Vec<_>>()
        .into_iter()
        .fold(soroban_sdk::Vec::new(&env), |mut v, a| {
            v.push_back(a);
            v
        });

    for i in 0..users.len() {
        client.follow(&alice, &users.get(i).unwrap());
    }

    // First page: offset=0, limit=3 → items 0,1,2
    let page = client.get_following(&alice, &0, &3);
    assert_eq!(page.len(), 3);
    assert_eq!(page.get(0).unwrap(), users.get(0).unwrap());
    assert_eq!(page.get(1).unwrap(), users.get(1).unwrap());
    assert_eq!(page.get(2).unwrap(), users.get(2).unwrap());
}

#[test]
fn test_get_following_second_page() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let alice = Address::generate(&env);
    let users: soroban_sdk::Vec<Address> = (0..5)
        .map(|_| Address::generate(&env))
        .collect::<std::vec::Vec<_>>()
        .into_iter()
        .fold(soroban_sdk::Vec::new(&env), |mut v, a| {
            v.push_back(a);
            v
        });

    for i in 0..users.len() {
        client.follow(&alice, &users.get(i).unwrap());
    }

    // Second page: offset=3, limit=3 → items 3,4 (only 2 remain)
    let page = client.get_following(&alice, &3, &3);
    assert_eq!(page.len(), 2);
    assert_eq!(page.get(0).unwrap(), users.get(3).unwrap());
    assert_eq!(page.get(1).unwrap(), users.get(4).unwrap());
}

#[test]
fn test_get_following_page_beyond_end() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.follow(&alice, &bob);

    // offset beyond list length → empty
    let page = client.get_following(&alice, &10, &5);
    assert_eq!(page.len(), 0);
}

#[test]
#[should_panic(expected = "limit exceeds maximum of 50")]
fn test_get_following_limit_exceeded() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let alice = Address::generate(&env);
    client.get_following(&alice, &0, &51);
}

// ── Pagination: get_posts_by_author ───────────────────────────────────────────

#[test]
fn test_get_posts_by_author_first_page() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let author = Address::generate(&env);

    let mut ids = soroban_sdk::Vec::new(&env);
    for i in 0..5u32 {
        let content = String::from_str(&env, "post");
        let id = client.create_post(&author, &content);
        ids.push_back(id);
        let _ = i;
    }

    // First page: offset=0, limit=3 → first 3 post IDs
    let page = client.get_posts_by_author(&author, &0, &3);
    assert_eq!(page.len(), 3);
    assert_eq!(page.get(0).unwrap(), ids.get(0).unwrap());
    assert_eq!(page.get(1).unwrap(), ids.get(1).unwrap());
    assert_eq!(page.get(2).unwrap(), ids.get(2).unwrap());
}

#[test]
fn test_get_posts_by_author_second_page() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let author = Address::generate(&env);

    let mut ids = soroban_sdk::Vec::new(&env);
    for _ in 0..5u32 {
        let id = client.create_post(&author, &String::from_str(&env, "post"));
        ids.push_back(id);
    }

    // Second page: offset=3, limit=3 → items 3,4
    let page = client.get_posts_by_author(&author, &3, &3);
    assert_eq!(page.len(), 2);
    assert_eq!(page.get(0).unwrap(), ids.get(3).unwrap());
    assert_eq!(page.get(1).unwrap(), ids.get(4).unwrap());
}

#[test]
fn test_get_posts_by_author_page_beyond_end() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let author = Address::generate(&env);
    client.create_post(&author, &String::from_str(&env, "only post"));

    // offset beyond list → empty
    let page = client.get_posts_by_author(&author, &10, &5);
    assert_eq!(page.len(), 0);
}

#[test]
#[should_panic(expected = "limit exceeds maximum of 50")]
fn test_get_posts_by_author_limit_exceeded() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let author = Address::generate(&env);
    client.get_posts_by_author(&author, &0, &51);
}
