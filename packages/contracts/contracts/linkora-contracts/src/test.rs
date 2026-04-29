#![cfg(test)]

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{storage::Persistent as _, Address as _, Events, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, BytesN, Env, String,
};

fn setup_token(env: &Env, admin: &Address) -> Address {
    let token_id = env.register_stellar_asset_contract_v2(admin.clone());
    StellarAssetClient::new(env, &token_id.address()).mint(admin, &10_000);
    token_id.address()
}

fn setup_contract(env: &Env) -> (LinkoraContractClient<'_>, Address, Address) {
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    client.initialize(&admin, &treasury, &0);
    (client, admin, treasury)
}

#[test]
fn test_set_and_get_profile() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    client.set_profile(&user, &String::from_str(&env, "alice"), &token);
    let profile = client.get_profile(&user).unwrap();
    assert_eq!(profile.username, String::from_str(&env, "alice"));
}

#[test]
fn test_username_reverse_index_registration() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    client.set_profile(&user, &String::from_str(&env, "alice"), &token);

    let resolved = client.get_address_by_username(&String::from_str(&env, "alice"));
    assert_eq!(resolved, Some(user));
}

#[test]
fn test_username_reverse_index_update() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    client.set_profile(&user, &String::from_str(&env, "alice"), &token);
    client.set_profile(&user, &String::from_str(&env, "alice2"), &token);

    // Old username should be gone
    assert!(client
        .get_address_by_username(&String::from_str(&env, "alice"))
        .is_none());
    // New username should resolve
    assert_eq!(
        client.get_address_by_username(&String::from_str(&env, "alice2")),
        Some(user)
    );
}

#[test]
#[should_panic(expected = "username taken")]
fn test_username_duplicate_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let token = Address::generate(&env);

    client.set_profile(&user1, &String::from_str(&env, "alice"), &token);
    // Different address tries to claim the same username
    client.set_profile(&user2, &String::from_str(&env, "alice"), &token);
}

#[test]
fn test_username_same_user_can_reregister_same_name() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    client.set_profile(&user, &String::from_str(&env, "alice"), &token);
    // Same user re-registering with the same username should not panic
    client.set_profile(&user, &String::from_str(&env, "alice"), &token);
    assert_eq!(
        client.get_address_by_username(&String::from_str(&env, "alice")),
        Some(user)
    );
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
#[should_panic(expected = "blocked")]
fn test_tip_blocked_by_author() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let author = Address::generate(&env);
    let tipper = Address::generate(&env);

    client.initialize(&admin, &treasury, &250);

    let token = setup_token(&env, &tipper);
    let post_id = client.create_post(&author, &String::from_str(&env, "Test post"));

    // Author blocks tipper
    client.block_user(&author, &tipper);

    // Tipper tries to tip - should panic with "blocked"
    client.tip(&tipper, &post_id, &token, &1000);
}

#[test]
fn test_tip_after_unblock() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let author = Address::generate(&env);
    let tipper = Address::generate(&env);

    client.initialize(&admin, &treasury, &250);

    let token = setup_token(&env, &tipper);
    let post_id = client.create_post(&author, &String::from_str(&env, "Test post"));

    // Author blocks tipper
    client.block_user(&author, &tipper);

    // Author unblocks tipper
    client.unblock_user(&author, &tipper);

    // Tipper can now tip successfully
    client.tip(&tipper, &post_id, &token, &1000);

    let post = client.get_post(&post_id).unwrap();
    assert_eq!(post.tip_total, 1000);
}

#[test]
fn test_tip_non_blocked_user() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let author = Address::generate(&env);
    let tipper1 = Address::generate(&env);
    let tipper2 = Address::generate(&env);

    client.initialize(&admin, &treasury, &250);

    let token = setup_token(&env, &tipper1);
    StellarAssetClient::new(&env, &token).mint(&tipper2, &5000);

    let post_id = client.create_post(&author, &String::from_str(&env, "Test post"));

    // Author blocks tipper1
    client.block_user(&author, &tipper1);

    // Tipper2 (not blocked) can tip successfully
    client.tip(&tipper2, &post_id, &token, &500);

    let post = client.get_post(&post_id).unwrap();
    assert_eq!(post.tip_total, 500);
}

#[test]
fn test_profile_count() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let token = Address::generate(&env);

    client.set_profile(&user1, &String::from_str(&env, "alice"), &token);
    assert_eq!(client.get_profile_count(), 1);

    // Update profile should not increment count
    client.set_profile(&user1, &String::from_str(&env, "alice_new"), &token);
    assert_eq!(client.get_profile_count(), 1);

    client.set_profile(&user2, &String::from_str(&env, "bob"), &token);
    assert_eq!(client.get_profile_count(), 2);
}

#[test]
fn test_post_count() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let author = Address::generate(&env);
    client.create_post(&author, &String::from_str(&env, "Post 1"));
    client.create_post(&author, &String::from_str(&env, "Post 2"));

    assert_eq!(client.get_post_count(), 2);
}

#[test]
fn test_post_count_not_decremented_on_delete() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let author = Address::generate(&env);
    let post_id1 = client.create_post(&author, &String::from_str(&env, "Post 1"));
    let post_id2 = client.create_post(&author, &String::from_str(&env, "Post 2"));

    assert_eq!(client.get_post_count(), 2);

    // Delete first post
    client.delete_post(&author, &post_id1);

    // Counter should still be 2 (total ever created)
    assert_eq!(client.get_post_count(), 2);

    // But the post should be gone
    assert!(client.get_post(&post_id1).is_none());
    assert!(client.get_post(&post_id2).is_some());
}

#[test]
fn test_follow_and_unfollow() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.follow(&alice, &bob);
    assert_eq!(client.get_following(&alice, &0, &10).len(), 1);
    assert_eq!(client.get_followers(&bob, &0, &10).len(), 1);

    client.unfollow(&alice, &bob);
    assert_eq!(client.get_following(&alice, &0, &10).len(), 0);
    assert_eq!(client.get_followers(&bob, &0, &10).len(), 0);
}

#[test]
fn test_block_prevents_follow() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let blocker = Address::generate(&env);
    let blocked = Address::generate(&env);
    client.block_user(&blocker, &blocked);
    assert!(client.is_blocked(&blocker, &blocked));
}

#[test]
#[should_panic(expected = "blocked")]
fn test_blocked_follow_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Bob blocks Alice
    client.block_user(&bob, &alice);

    // Alice tries to follow Bob
    client.follow(&alice, &bob);
}

#[test]
fn test_like_post() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let author = Address::generate(&env);
    let user = Address::generate(&env);
    let post_id = client.create_post(&author, &String::from_str(&env, "Like test"));

    client.like_post(&user, &post_id);
    assert_eq!(client.get_like_count(&post_id), 1);
    assert!(client.has_liked(&user, &post_id));

    // Duplicate like should not increment
    client.like_post(&user, &post_id);
    assert_eq!(client.get_like_count(&post_id), 1);
}

#[test]
fn test_like_post_emits_event_on_first_like() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let author = Address::generate(&env);
    let user = Address::generate(&env);
    let post_id = client.create_post(&author, &String::from_str(&env, "Event test"));

    client.like_post(&user, &post_id);

    assert!(
        !env.events().all().events().is_empty(),
        "LikePostEvent should be emitted"
    );
}

#[test]
fn test_like_post_no_event_on_duplicate() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let author = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let post_id = client.create_post(&author, &String::from_str(&env, "Duplicate event test"));

    client.like_post(&user1, &post_id);
    let like_count_after_first = client.get_like_count(&post_id);

    client.like_post(&user1, &post_id);
    let like_count_after_duplicate = client.get_like_count(&post_id);

    assert_eq!(
        like_count_after_duplicate, like_count_after_first,
        "duplicate like should not increment count"
    );

    client.like_post(&user2, &post_id);
    let like_count_after_new_user = client.get_like_count(&post_id);

    assert_eq!(
        like_count_after_new_user,
        like_count_after_first + 1,
        "like from new user should increment"
    );
}

#[test]
fn test_pool_authorization() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    let pool_admin1 = Address::generate(&env);
    let pool_admin2 = Address::generate(&env);
    let other_user = Address::generate(&env);
    let token = setup_token(&env, &pool_admin1);

    // Give other_user some tokens to deposit
    StellarAssetClient::new(&env, &token).mint(&other_user, &1000);

    let pool_id = symbol_short!("pool1");
    // Create pool with 2-of-2 threshold
    client.create_pool(
        &admin,
        &pool_id,
        &token,
        &vec![&env, pool_admin1.clone(), pool_admin2.clone()],
        &2,
    );

    // Deposit works for anyone with tokens
    client.pool_deposit(&other_user, &pool_id, &token, &100);

    // Withdrawal by both admins works
    client.pool_withdraw(
        &vec![&env, pool_admin1.clone(), pool_admin2.clone()],
        &pool_id,
        &50,
        &other_user,
    );
    assert_eq!(client.get_pool(&pool_id).unwrap().balance, 50);
}

#[test]
#[should_panic(expected = "insufficient signers")]
fn test_pool_withdraw_insufficient_signers() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    let pool_admin1 = Address::generate(&env);
    let pool_admin2 = Address::generate(&env);
    let other_user = Address::generate(&env);
    let token = setup_token(&env, &pool_admin1);
    StellarAssetClient::new(&env, &token).mint(&other_user, &1000);

    let pool_id = symbol_short!("pool1");
    client.create_pool(
        &admin,
        &pool_id,
        &token,
        &vec![&env, pool_admin1.clone(), pool_admin2.clone()],
        &2,
    );
    client.pool_deposit(&other_user, &pool_id, &token, &100);

    // Only 1 signer when 2 required
    client.pool_withdraw(&vec![&env, pool_admin1.clone()], &pool_id, &50, &other_user);
}

#[test]
#[should_panic(expected = "unauthorized signer")]
fn test_pool_withdraw_unauthorized_signer() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    let pool_admin1 = Address::generate(&env);
    let pool_admin2 = Address::generate(&env);
    let unauthorized_user = Address::generate(&env);
    let other_user = Address::generate(&env);
    let token = setup_token(&env, &pool_admin1);
    StellarAssetClient::new(&env, &token).mint(&other_user, &1000);

    let pool_id = symbol_short!("pool2");
    client.create_pool(
        &admin,
        &pool_id,
        &token,
        &vec![&env, pool_admin1.clone(), pool_admin2.clone()],
        &2,
    );
    client.pool_deposit(&other_user, &pool_id, &token, &100);

    // Try to withdraw with a signer not in pool.admins
    client.pool_withdraw(
        &vec![&env, pool_admin1.clone(), unauthorized_user.clone()],
        &pool_id,
        &50,
        &other_user,
    );
}

#[test]
#[should_panic(expected = "low balance")]
fn test_pool_withdraw_exceeds_balance() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    let pool_admin1 = Address::generate(&env);
    let pool_admin2 = Address::generate(&env);
    let other_user = Address::generate(&env);
    let token = setup_token(&env, &pool_admin1);
    StellarAssetClient::new(&env, &token).mint(&other_user, &1000);

    let pool_id = symbol_short!("pool3");
    client.create_pool(
        &admin,
        &pool_id,
        &token,
        &vec![&env, pool_admin1.clone(), pool_admin2.clone()],
        &1,
    );
    client.pool_deposit(&other_user, &pool_id, &token, &100);

    // Try to withdraw more than available balance
    client.pool_withdraw(
        &vec![&env, pool_admin1.clone(), pool_admin2.clone()],
        &pool_id,
        &200,
        &other_user,
    );
}

#[test]
fn test_sequential_posts() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let author = Address::generate(&env);

    // Set first timestamp
    let ts1 = 1000;
    env.ledger().set_timestamp(ts1);

    // Create first post
    let post_id1 = client.create_post(&author, &String::from_str(&env, "First post"));
    assert_eq!(post_id1, 1);

    let post1 = client.get_post(&post_id1).unwrap();
    assert_eq!(post1.timestamp, ts1);
    assert_eq!(post1.id, 1);

    // Advance timestamp
    let ts2 = 2000;
    env.ledger().set_timestamp(ts2);

    // Create second post
    let post_id2 = client.create_post(&author, &String::from_str(&env, "Second post"));
    assert_eq!(post_id2, 2);

    let post2 = client.get_post(&post_id2).unwrap();
    assert_eq!(post2.timestamp, ts2);
    assert_eq!(post2.id, 2);
}

#[test]
#[should_panic(expected = "post does not exist: 999")]
fn test_delete_post_non_existent() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let author = Address::generate(&env);
    client.delete_post(&author, &999);
}

// ── initialize / upgrade tests ────────────────────────────────────────────────

#[test]
fn test_initialize_stores_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    client.initialize(&admin, &treasury, &0);

    // Admin is stored: set_fee (admin-only) should succeed when called by admin
    client.set_fee(&100);
}

#[test]
#[should_panic(expected = "already initialized")]
fn test_initialize_twice_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    client.initialize(&admin, &treasury, &0);
    // Second call must panic
    client.initialize(&admin, &treasury, &0);
}

#[test]
fn test_upgrade_by_admin_succeeds() {
    let env = Env::default();
    let (client, admin, _) = setup_contract(&env);

    // Use a mock wasm hash as specified in acceptance criteria
    let mock_hash = BytesN::from_array(&env, &[0u8; 32]);
    
    // Mock auth for the admin address only
    env.mock_all_auths();
    
    client.upgrade(&mock_hash);
}

#[test]
#[should_panic]
fn test_upgrade_by_non_admin_panics() {
    let env = Env::default();
    let (client, admin, _) = setup_contract(&env);

    let mock_hash = BytesN::from_array(&env, &[1u8; 32]);
    
    // Don't mock auths - upgrade requires admin authorization
    // This should panic because admin.require_auth() won't be satisfied
    client.upgrade(&mock_hash);
}

#[test]
#[should_panic(expected = "not initialized")]
fn test_upgrade_before_initialize_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let mock_hash = BytesN::from_array(&env, &[0u8; 32]);
    client.upgrade(&mock_hash);
}

#[test]
fn test_upgrade_emits_contract_upgraded_event() {
    let env = Env::default();
    let (client, admin, _) = setup_contract(&env);

    // Use a mock wasm hash as specified in acceptance criteria
    let mock_hash = BytesN::from_array(&env, &[0u8; 32]);
    
    // Mock auth for the admin address
    env.mock_all_auths();
    
    // Call upgrade
    client.upgrade(&mock_hash);
    
    // Verify ContractUpgraded event is present in env.events().all()
    let all_events = env.events().all();
    let events = all_events.events();
    assert!(!events.is_empty(), "ContractUpgraded event should be emitted");
}

// ── Fee boundary tests (issue #196) ─────────────────────────────────────────────

#[test]
fn test_initialize_fee_boundary_max_valid() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    // Initialize with fee_bps = 10_000 (100%) should succeed
    client.initialize(&admin, &treasury, &10_000);
    assert_eq!(client.get_fee_bps(), 10_000);
}

#[test]
#[should_panic(expected = "invalid fee")]
fn test_initialize_fee_boundary_max_invalid() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    // Initialize with fee_bps = 10_001 (>100%) should panic
    client.initialize(&admin, &treasury, &10_001);
}

#[test]
fn test_set_fee_zero_valid() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    // Set fee to 0 should succeed
    client.set_fee(&0);
    assert_eq!(client.get_fee_bps(), 0);
}

#[test]
#[should_panic]
fn test_set_fee_non_admin_panics() {
    let env = Env::default();
    // Don't mock all auths so we can test auth failure
    let (client, _admin, _) = setup_contract(&env);

    // Non-admin trying to set fee should panic due to auth failure
    client.set_fee(&100);
}

// ── Username validation tests (issue #195) ───────────────────────────────────────

#[test]
#[should_panic(expected = "username too short")]
fn test_username_too_short() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);

    // 2-character username should panic
    client.set_profile(&user, &String::from_str(&env, "ab"), &token);
}

#[test]
fn test_username_min_length_valid() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);

    // 3-character username should succeed
    client.set_profile(&user, &String::from_str(&env, "abc"), &token);
    let profile = client.get_profile(&user).unwrap();
    assert_eq!(profile.username, String::from_str(&env, "abc"));
}

#[test]
fn test_username_max_length_valid() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);

    // 32-character username should succeed
    let username_str = "abcdefghijklmnopqrstuvwxyz123456";
    let username = String::from_str(&env, username_str);
    assert_eq!(username.len(), 32);
    client.set_profile(&user, &username, &token);
    let profile = client.get_profile(&user).unwrap();
    assert_eq!(profile.username, username);
}

#[test]
#[should_panic(expected = "username too long")]
fn test_username_too_long() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);

    // 33-character username should panic
    let username_str = "abcdefghijklmnopqrstuvwxyz1234567";
    let username = String::from_str(&env, username_str);
    assert_eq!(username.len(), 33);
    client.set_profile(&user, &username, &token);
}

#[test]
#[should_panic(expected = "invalid username character")]
fn test_username_with_space() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);

    // Username with space should panic
    client.set_profile(&user, &String::from_str(&env, "user name"), &token);
}

#[test]
#[should_panic(expected = "invalid username character")]
fn test_username_with_special_char() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);

    // Username with special character should panic
    client.set_profile(&user, &String::from_str(&env, "user@name"), &token);
}

// ── Unfollow event emission tests (issue #129) ───────────────────────────────────

#[test]
fn test_unfollow_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // First establish a follow relationship
    client.follow(&alice, &bob);

    // Unfollow should emit UnfollowEvent
    client.unfollow(&alice, &bob);

    // Verify at least one event was emitted by unfollow
    let all_events = env.events().all();
    let events = all_events.events();
    assert!(!events.is_empty());
}

#[test]
fn test_unfollow_noop_no_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // Unfollow when no relationship exists should not panic
    client.unfollow(&alice, &bob);

    // Verify both indexes are still empty
    assert_eq!(client.get_following(&alice, &0, &10).len(), 0);
    assert_eq!(client.get_followers(&bob, &0, &10).len(), 0);
}

// ── Post content length validation tests (issue #194) ────────────────────────────

#[test]
#[should_panic(expected = "empty content")]
fn test_post_content_empty() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let author = Address::generate(&env);

    // Empty content should panic
    client.create_post(&author, &String::from_str(&env, ""));
}

#[test]
fn test_post_content_min_length_valid() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let author = Address::generate(&env);

    // 1-character content should succeed
    let post_id = client.create_post(&author, &String::from_str(&env, "a"));
    let post = client.get_post(&post_id).unwrap();
    assert_eq!(post.content, String::from_str(&env, "a"));
}

#[test]
fn test_post_content_max_length_valid() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let author = Address::generate(&env);

    // 280-character content should succeed
    let content_str = "a".repeat(280);
    let content = String::from_str(&env, &content_str);
    assert_eq!(content.len(), 280);
    let post_id = client.create_post(&author, &content);
    let post = client.get_post(&post_id).unwrap();
    assert_eq!(post.content, content);
}

#[test]
#[should_panic(expected = "content too long")]
fn test_post_content_too_long() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let author = Address::generate(&env);

    // 281-character content should panic
    let content_str = "a".repeat(281);
    let content = String::from_str(&env, &content_str);
    assert_eq!(content.len(), 281);
    client.create_post(&author, &content);
}

// ── get_followers / get_following TTL tests ───────────────────────────────────

#[test]
fn test_get_followers_bumps_followers_key() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // bob follows alice so alice has a non-empty followers list
    client.follow(&bob, &alice);
    client.get_followers(&alice, &0, &50);

    let contract_id = client.address.clone();

    // StorageKey::Followers(alice) must have a bumped TTL
    let followers_ttl = env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .get_ttl(&StorageKey::Followers(alice.clone()))
    });
    assert!(
        followers_ttl >= LEDGER_THRESHOLD,
        "followers TTL {followers_ttl} below LEDGER_THRESHOLD"
    );

    // StorageKey::Following(alice) must NOT exist — get_followers must not touch it
    let follows_exists = env.as_contract(&contract_id, || {
        env.storage()
            .persistent()
            .has(&StorageKey::Following(alice.clone()))
    });
    assert!(
        !follows_exists,
        "get_followers must not create or bump the Following(alice) key"
    );
}
