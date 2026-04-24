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

#[test]
fn test_tip_fee_split() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let author = Address::generate(&env);
    let tipper = Address::generate(&env);
    
    // Initialize with 2.5% fee (250 bps)
    client.initialize(&admin, &treasury, &250);

    let token = setup_token(&env, &tipper);

    let post_id = client.create_post(&author, &String::from_str(&env, "Fee test post"));

    // Tip 1000 units
    client.tip(&tipper, &post_id, &token, &1000);

    // Verify balances
    // Fee = 1000 * 250 / 10000 = 25
    // Author gets 1000 - 25 = 975
    assert_eq!(TokenClient::new(&env, &token).balance(&treasury), 25);
    assert_eq!(TokenClient::new(&env, &token).balance(&author), 975);
    
    let post = client.get_post(&post_id).unwrap();
    assert_eq!(post.tip_total, 1000);
}

#[test]
fn test_tip_zero_fee() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let author = Address::generate(&env);
    let tipper = Address::generate(&env);
    
    // Initialize with 0% fee
    client.initialize(&admin, &treasury, &0);

    let token = setup_token(&env, &tipper);
    let post_id = client.create_post(&author, &String::from_str(&env, "Zero fee post"));

    client.tip(&tipper, &post_id, &token, &1000);

    assert_eq!(TokenClient::new(&env, &token).balance(&treasury), 0);
    assert_eq!(TokenClient::new(&env, &token).balance(&author), 1000);
}

#[test]
fn test_set_fee_and_treasury() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    
    client.initialize(&admin, &treasury, &0);

    // Update fee
    client.set_fee(&500); // 5%
    
    // Update treasury
    let new_treasury = Address::generate(&env);
    client.set_treasury(&new_treasury);

    let author = Address::generate(&env);
    let tipper = Address::generate(&env);
    let token = setup_token(&env, &tipper);
    let post_id = client.create_post(&author, &String::from_str(&env, "Update test post"));

    client.tip(&tipper, &post_id, &token, &1000);

    assert_eq!(TokenClient::new(&env, &token).balance(&new_treasury), 50);
    assert_eq!(TokenClient::new(&env, &token).balance(&author), 950);
}

#[test]
#[should_panic(expected = "fee_bps cannot exceed 10000")]
fn test_invalid_fee() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &treasury, &10001);
}

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

    // Zero deposit must be rejected before any state change
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

    // Negative deposit must be rejected before any state change
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

    // Seed the pool first so the zero-amount guard is the only thing that fires
    client.pool_deposit(&user, &pool_id, &token, &1_000);

    // Zero withdrawal must be rejected before any state change
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

    // Seed the pool first so the negative-amount guard is the only thing that fires
    client.pool_deposit(&user, &pool_id, &token, &1_000);

    // Negative withdrawal must be rejected before any state change
    client.pool_withdraw(&user, &pool_id, &-1);
}

#[test]
fn test_sequential_posts() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let author = Address::generate(&env);

    // Set first timestamp
    let ts1 = 1000;
    env.ledger().set_timestamp(ts1);

    // Create first post
    let post_id1 = client.create_post(&author, &String::from_str(&env, "First post"));
    assert_eq!(post_id1, 1, "First post ID should be 1");

    let post1 = client.get_post(&post_id1).unwrap();
    assert_eq!(post1.timestamp, ts1, "First post timestamp should match ledger");
    assert_eq!(post1.id, 1);

    // Advance timestamp
    let ts2 = 2000;
    env.ledger().set_timestamp(ts2);

    // Create second post
    let post_id2 = client.create_post(&author, &String::from_str(&env, "Second post"));
    assert_eq!(post_id2, 2, "Second post ID should be 2");

    let post2 = client.get_post(&post_id2).unwrap();
    assert_eq!(post2.timestamp, ts2, "Second post timestamp should match updated ledger");
    assert_eq!(post2.id, 2);

    // Verify both exist and are distinct
    assert!(post_id1 != post_id2);
}

#[test]
fn test_follow_is_idempotent() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Follow bob twice from alice — should be deduplicated
    client.follow(&alice, &bob);
    client.follow(&alice, &bob);

    let following = client.get_following(&alice);
    // Bob must appear exactly once despite two follow calls
    assert_eq!(following.len(), 1);
    assert_eq!(following.get(0).unwrap(), bob);
}

// ── Pool Admin Authorization Tests ───────────────────────────────────────────

#[test]
fn test_create_pool_with_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = setup_token(&env, &admin);
    let pool_id = symbol_short!("treasury");

    // Create admins vector with admin
    let mut admins = Vec::new(&env);
    admins.push_back(admin.clone());

    client.create_pool(&pool_id, &token, &admins);

    let pool = client.get_pool(&pool_id).expect("pool should exist");
    assert_eq!(pool.token, token);
    assert_eq!(pool.balance, 0);
    assert_eq!(pool.admins.len(), 1);
    assert_eq!(pool.admins.get(0).unwrap(), admin);
}

#[test]
fn test_create_pool_with_multiple_admins() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);
    let token = setup_token(&env, &admin1);
    let pool_id = symbol_short!("multisig");

    // Create admins vector with multiple admins
    let mut admins = Vec::new(&env);
    admins.push_back(admin1.clone());
    admins.push_back(admin2.clone());
    admins.push_back(admin3.clone());

    client.create_pool(&pool_id, &token, &admins);

    let pool = client.get_pool(&pool_id).expect("pool should exist");
    assert_eq!(pool.admins.len(), 3);
    assert_eq!(pool.admins.get(0).unwrap(), admin1);
    assert_eq!(pool.admins.get(1).unwrap(), admin2);
    assert_eq!(pool.admins.get(2).unwrap(), admin3);
}

#[test]
#[should_panic(expected = "at least one admin is required")]
fn test_create_pool_without_admins() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = setup_token(&env, &admin);
    let pool_id = symbol_short!("empty");

    let admins = Vec::new(&env);

    client.create_pool(&pool_id, &token, &admins);
}

#[test]
#[should_panic(expected = "pool already exists")]
fn test_create_duplicate_pool() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = setup_token(&env, &admin);
    let pool_id = symbol_short!("dup");

    let mut admins = Vec::new(&env);
    admins.push_back(admin.clone());

    // First creation succeeds
    client.create_pool(&pool_id, &token, &admins);

    // Second creation should panic
    client.create_pool(&pool_id, &token, &admins);
}

#[test]
fn test_authorized_withdrawal() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let token = setup_token(&env, &depositor);
    let pool_id = symbol_short!("auth_test");

    // Create pool with admin
    let mut admins = Vec::new(&env);
    admins.push_back(admin.clone());
    client.create_pool(&pool_id, &token, &admins);

    // Deposit funds
    client.pool_deposit(&depositor, &pool_id, &token, &5_000);

    // Admin should be able to withdraw
    client.pool_withdraw(&admin, &pool_id, &1_000);

    let pool = client.get_pool(&pool_id).expect("pool should exist");
    assert_eq!(pool.balance, 4_000);

    // Check that funds were transferred
    let admin_balance = TokenClient::new(&env, &token).balance(&admin);
    assert_eq!(admin_balance, 1_000);
}

#[test]
#[should_panic(expected = "caller is not authorized to withdraw from this pool")]
fn test_unauthorized_withdrawal_non_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let unauthorized = Address::generate(&env);
    let token = setup_token(&env, &depositor);
    let pool_id = symbol_short!("unauth");

    // Create pool with admin
    let mut admins = Vec::new(&env);
    admins.push_back(admin.clone());
    client.create_pool(&pool_id, &token, &admins);

    // Deposit funds
    client.pool_deposit(&depositor, &pool_id, &token, &5_000);

    // Unauthorized user tries to withdraw — should panic
    client.pool_withdraw(&unauthorized, &pool_id, &1_000);
}

#[test]
fn test_multiple_admins_can_withdraw() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let depositor = Address::generate(&env);
    let token = setup_token(&env, &depositor);
    let pool_id = symbol_short!("multi");

    // Create pool with multiple admins
    let mut admins = Vec::new(&env);
    admins.push_back(admin1.clone());
    admins.push_back(admin2.clone());
    client.create_pool(&pool_id, &token, &admins);

    // Deposit funds
    client.pool_deposit(&depositor, &pool_id, &token, &5_000);

    // First admin withdraws
    client.pool_withdraw(&admin1, &pool_id, &2_000);

    let pool = client.get_pool(&pool_id).expect("pool should exist");
    assert_eq!(pool.balance, 3_000);

    // Second admin withdraws
    client.pool_withdraw(&admin2, &pool_id, &1_500);

    let pool = client.get_pool(&pool_id).expect("pool should exist");
    assert_eq!(pool.balance, 1_500);
}

#[test]
fn test_pool_deposit_creates_pool_with_depositor_as_admin() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let depositor = Address::generate(&env);
    let token = setup_token(&env, &depositor);
    let pool_id = symbol_short!("deposit");

    // Pool doesn't exist yet, so deposit creates it
    client.pool_deposit(&depositor, &pool_id, &token, &3_000);

    let pool = client.get_pool(&pool_id).expect("pool should exist");
    assert_eq!(pool.balance, 3_000);
    assert_eq!(pool.admins.len(), 1);
    assert_eq!(pool.admins.get(0).unwrap(), depositor);

    // Depositor (auto-admin) can now withdraw
    client.pool_withdraw(&depositor, &pool_id, &1_000);

    let pool = client.get_pool(&pool_id).expect("pool should exist");
    assert_eq!(pool.balance, 2_000);
}

#[test]
#[should_panic(expected = "caller is not authorized to withdraw from this pool")]
fn test_update_pool_admins() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let token = setup_token(&env, &admin1);
    let pool_id = symbol_short!("update");

    // Create pool with admin1
    let mut admins = Vec::new(&env);
    admins.push_back(admin1.clone());
    client.create_pool(&pool_id, &token, &admins);

    // admin1 updates admin list to include admin2 and new_admin, but removes admin1
    let mut new_admins = Vec::new(&env);
    new_admins.push_back(admin2.clone());
    new_admins.push_back(new_admin.clone());

    client.update_pool_admins(&pool_id, &admin1, &new_admins);

    let pool = client.get_pool(&pool_id).expect("pool should exist");
    assert_eq!(pool.admins.len(), 2);
    assert_eq!(pool.admins.get(0).unwrap(), admin2);
    assert_eq!(pool.admins.get(1).unwrap(), new_admin);

    // Deposit some funds into the pool
    client.pool_deposit(&admin1, &pool_id, &token, &1_000);

    // Try to withdraw with old admin (should panic)
    client.pool_withdraw(&admin1, &pool_id, &500);
}

#[test]
fn test_new_admin_can_withdraw_after_update() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let token = setup_token(&env, &admin1);
    let pool_id = symbol_short!("new_adm");

    // Create pool with admin1
    let mut admins = Vec::new(&env);
    admins.push_back(admin1.clone());
    client.create_pool(&pool_id, &token, &admins);

    // Deposit funds
    client.pool_deposit(&admin1, &pool_id, &token, &2_000);

    // Update admin to admin2
    let mut new_admins = Vec::new(&env);
    new_admins.push_back(admin2.clone());
    client.update_pool_admins(&pool_id, &admin1, &new_admins);

    // New admin should be able to withdraw
    client.pool_withdraw(&admin2, &pool_id, &500);

    let pool = client.get_pool(&pool_id).expect("pool should exist");
    assert_eq!(pool.balance, 1_500);
}

#[test]
#[should_panic(expected = "only admins can update the admin list")]
fn test_non_admin_cannot_update_admins() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let token = setup_token(&env, &admin);
    let pool_id = symbol_short!("no_auth");

    // Create pool with admin
    let mut admins = Vec::new(&env);
    admins.push_back(admin.clone());
    client.create_pool(&pool_id, &token, &admins);

    // Non-admin tries to update admin list — should panic
    let mut new_admins = Vec::new(&env);
    new_admins.push_back(non_admin.clone());

    client.update_pool_admins(&pool_id, &non_admin, &new_admins);
}

#[test]
#[should_panic(expected = "at least one admin is required")]
fn test_update_pool_admins_to_empty() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let token = setup_token(&env, &admin);
    let pool_id = symbol_short!("emp_adm");

    // Create pool with admin
    let mut admins = Vec::new(&env);
    admins.push_back(admin.clone());
    client.create_pool(&pool_id, &token, &admins);

    // Admin tries to set empty admin list — should panic
    let empty_admins = Vec::new(&env);
    client.update_pool_admins(&pool_id, &admin, &empty_admins);
}
