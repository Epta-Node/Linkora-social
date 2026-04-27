#![cfg(test)]

extern crate std;

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Env, Event, String,
};

fn setup_token(env: &Env, admin: &Address) -> Address {
    let token_id = env.register_stellar_asset_contract_v2(admin.clone());
    StellarAssetClient::new(env, &token_id.address()).mint(admin, &10_000);
    token_id.address()
}

fn setup_contract(env: &Env) -> (LinkoraContractClient, Address, Address) {
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
fn test_follow_and_unfollow() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    client.follow(&alice, &bob);
    assert_eq!(client.get_following(&alice).len(), 1);
    assert_eq!(client.get_followers(&bob).len(), 1);

    client.unfollow(&alice, &bob);
    assert_eq!(client.get_following(&alice).len(), 0);
    assert_eq!(client.get_followers(&bob).len(), 0);
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

    // First like: should emit LikePostEvent
    client.like_post(&user, &post_id);
    let events = env.events().get();
    let like_events: Vec<LikePostEvent> = events.iter()
        .filter_map(|e| e.data::<LikePostEvent>(&env).ok())
        .collect();
    assert_eq!(like_events.len(), 1, "Should emit exactly one LikePostEvent on first like");
    assert_eq!(like_events[0].user, user);
    assert_eq!(like_events[0].post_id, post_id);

    // Duplicate like: should not emit another event
    client.like_post(&user, &post_id);
    let events = env.events().get();
    let like_events: Vec<LikePostEvent> = events.iter()
        .filter_map(|e| e.data::<LikePostEvent>(&env).ok())
        .collect();
    assert_eq!(like_events.len(), 1, "Duplicate like should not emit another LikePostEvent");

    // Verify state
    assert_eq!(client.get_like_count(&post_id), 1);
    assert!(client.has_liked(&user, &post_id));
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

#[test]
fn test_like_post_ttl_bump() {
// ── validate_username tests ───────────────────────────────────────────────────

#[test]
#[should_panic(expected = "username too short")]
fn test_username_too_short() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let author = Address::generate(&env);
    let user = Address::generate(&env);
    let post_id = client.create_post(&author, &String::from_str(&env, "TTL test"));

    let post_key = (POSTS, post_id);
    
    // Initial TTL is set in create_post
    let initial_ttl = env.storage().persistent().get_ttl(&post_key);
    assert_eq!(initial_ttl, LEDGER_BUMP);

    // Advance ledger to reduce TTL
    env.ledger().with_mut(|li| {
        li.sequence_number += 100;
    });

    assert!(env.storage().persistent().get_ttl(&post_key) < LEDGER_BUMP);

    // Like the post
    client.like_post(&user, &post_id);

    // Post TTL should be bumped
    assert_eq!(env.storage().persistent().get_ttl(&post_key), LEDGER_BUMP);

    // Like entry TTL should also be at LEDGER_BUMP
    let like_key = (LIKES, post_id, user);
    assert_eq!(env.storage().persistent().get_ttl(&like_key), LEDGER_BUMP);
    let user = Address::generate(&env);
    let token = Address::generate(&env);
    // "ab" is 2 chars — below the 3-char minimum
    client.set_profile(&user, &String::from_str(&env, "ab"), &token);
}

#[test]
#[should_panic(expected = "username too long")]
fn test_username_too_long() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    // 33 chars — above the 32-char maximum
    client.set_profile(&user, &String::from_str(&env, "a_username_that_is_way_too_long_xx"), &token);
}

#[test]
#[should_panic(expected = "invalid username character")]
fn test_username_with_space() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    client.set_profile(&user, &String::from_str(&env, "bad name"), &token);
}

#[test]
#[should_panic(expected = "invalid username character")]
fn test_username_with_special_character() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    client.set_profile(&user, &String::from_str(&env, "bad@name"), &token);
}

#[test]
fn test_username_boundary_min() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    // exactly 3 chars — should succeed
    client.set_profile(&user, &String::from_str(&env, "abc"), &token);
    let profile = client.get_profile(&user).unwrap();
    assert_eq!(profile.username, String::from_str(&env, "abc"));
}

#[test]
fn test_username_boundary_max() {
#[test]
fn test_pool_deposit_emits_event() {
#[should_panic(expected = "content cannot be empty")]
fn test_create_post_empty_content_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, author, _) = setup_contract(&env);

    let empty_content = String::from_str(&env, "");
    client.create_post(&author, &empty_content);
}

#[test]
#[should_panic(expected = "content too long")]
fn test_create_post_too_long_content_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, author, _) = setup_contract(&env);

    // Create a string of 281 characters
    let mut long_content = String::from_str(&env, "");
    for _ in 0..281 {
        long_content.push_str(&env, "a");
    }
    client.create_post(&author, &long_content);
}

#[test]
fn test_create_post_exactly_280_chars_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, author, _) = setup_contract(&env);

    // Create a string of exactly 280 characters
    let mut content_280 = String::from_str(&env, "");
    for _ in 0..280 {
        content_280.push_str(&env, "a");
    }
    let post_id = client.create_post(&author, &content_280);
    assert_eq!(post_id, 1);
}

#[test]
fn test_create_post_one_char_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, author, _) = setup_contract(&env);

    let one_char = String::from_str(&env, "a");
    let post_id = client.create_post(&author, &one_char);
    assert_eq!(post_id, 1);
#[should_panic(expected = "must be positive")]
fn test_pool_deposit_zero_amount_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    let depositor = Address::generate(&env);
    let token = setup_token(&env, &depositor);
    let pool_id = symbol_short!("pool1");

    let pool_admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let token = setup_token(&env, &pool_admin);
    StellarAssetClient::new(&env, &token).mint(&depositor, &1000);

    let pool_id = symbol_short!("pooldzro");
    client.create_pool(
        &admin,
        &pool_id,
        &token,
        &vec![&env, admin.clone()],
        &1,
    );
    client.pool_deposit(&depositor, &pool_id, &token, &500);

    let contract_id = client.address.clone();
    let expected = PoolDepositEvent {
        depositor: depositor.clone(),
        pool_id: pool_id.clone(),
        amount: 500,
    };
    assert_eq!(
        env.events().all().filter_by_contract(&contract_id),
        std::vec![expected.to_xdr(&env, &contract_id)],
    );
}

#[test]
fn test_pool_withdraw_emits_event() {
        &vec![&env, pool_admin.clone()],
        &1,
    );

    client.pool_deposit(&depositor, &pool_id, &token, &0);
}

#[test]
#[should_panic(expected = "must be positive")]
fn test_pool_deposit_negative_amount_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    let pool_admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let token = setup_token(&env, &pool_admin);
    StellarAssetClient::new(&env, &token).mint(&depositor, &1000);

    let pool_id = symbol_short!("pooldneg");
    client.create_pool(
        &admin,
        &pool_id,
        &token,
        &vec![&env, pool_admin.clone()],
        &1,
    );

    client.pool_deposit(&depositor, &pool_id, &token, &-1);
}

#[test]
fn test_pool_deposit_valid_positive_amount_succeeds() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    let depositor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = setup_token(&env, &depositor);
    let pool_id = symbol_short!("pool1");

    let pool_admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let token = setup_token(&env, &pool_admin);
    StellarAssetClient::new(&env, &token).mint(&depositor, &1000);

    let pool_id = symbol_short!("pooldpos");
    client.create_pool(
        &admin,
        &pool_id,
        &token,
        &vec![&env, pool_admin.clone()],
        &1,
    );

    client.pool_deposit(&depositor, &pool_id, &token, &100);
    assert_eq!(client.get_pool(&pool_id).unwrap().balance, 100);
}

#[test]
#[should_panic(expected = "insufficient pool balance")]
fn test_pool_withdraw_insufficient_balance_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    let pool_admin = Address::generate(&env);
    let depositor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = setup_token(&env, &pool_admin);
    StellarAssetClient::new(&env, &token).mint(&depositor, &1000);

    let pool_id = symbol_short!("poolwlow");
    client.create_pool(
        &admin,
        &pool_id,
        &token,
        &vec![&env, admin.clone()],
        &1,
    );
    client.pool_deposit(&depositor, &pool_id, &token, &500);
    client.pool_withdraw(&vec![&env, admin.clone()], &pool_id, &200, &recipient);

    let contract_id = client.address.clone();
    let expected_deposit = PoolDepositEvent {
        depositor: depositor.clone(),
        pool_id: pool_id.clone(),
        amount: 500,
    };
    let expected_withdraw = PoolWithdrawEvent {
        recipient: recipient.clone(),
        pool_id: pool_id.clone(),
        amount: 200,
    };
    assert_eq!(
        env.events().all().filter_by_contract(&contract_id),
        std::vec![
            expected_deposit.to_xdr(&env, &contract_id),
            expected_withdraw.to_xdr(&env, &contract_id),
        ],
    );
        &vec![&env, pool_admin.clone()],
        &1,
    );
    client.pool_deposit(&depositor, &pool_id, &token, &500);

    client.pool_withdraw(&vec![&env, pool_admin.clone()], &pool_id, &501, &recipient);
}

#[test]
#[should_panic(expected = "pool not found")]
fn test_pool_withdraw_missing_pool_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let user = Address::generate(&env);
    let token = Address::generate(&env);
    // exactly 32 chars — should succeed
    client.set_profile(&user, &String::from_str(&env, "valid_username_32_chars_exactly_"), &token);
    let profile = client.get_profile(&user).unwrap();
    assert_eq!(profile.username, String::from_str(&env, "valid_username_32_chars_exactly_"));
    let signer = Address::generate(&env);
    let recipient = Address::generate(&env);
    let missing_pool_id = symbol_short!("nopool");

    client.pool_withdraw(&vec![&env, signer], &missing_pool_id, &1, &recipient);
}
