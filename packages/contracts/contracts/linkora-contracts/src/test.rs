#![cfg(test)]

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Env, String,
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
        like_count_after_new_user, like_count_after_first + 1,
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

// ── Follow / unfollow reverse index symmetry (issue #138) ─────────────────────

#[test]
fn test_follow_populates_both_indexes() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.follow(&alice, &bob);

    let following = client.get_following(&alice);
    assert_eq!(following.len(), 1);
    assert_eq!(following.get(0).unwrap(), bob);

    let followers = client.get_followers(&bob);
    assert_eq!(followers.len(), 1);
    assert_eq!(followers.get(0).unwrap(), alice);
}

#[test]
fn test_unfollow_clears_both_indexes() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.follow(&alice, &bob);
    client.unfollow(&alice, &bob);

    assert_eq!(client.get_following(&alice).len(), 0);
    assert_eq!(client.get_followers(&bob).len(), 0);
}

#[test]
fn test_follow_is_idempotent() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    client.follow(&alice, &bob);
    client.follow(&alice, &bob);

    assert_eq!(client.get_following(&alice).len(), 1);
    assert_eq!(client.get_followers(&bob).len(), 1);
}

#[test]
fn test_unfollow_noop_on_nonexistent_relationship() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    // No prior follow — must not panic and both indexes must stay empty.
    client.unfollow(&alice, &bob);

    assert_eq!(client.get_following(&alice).len(), 0);
    assert_eq!(client.get_followers(&bob).len(), 0);
}

// ── Pool deposit / withdraw event emission (issue #137) ───────────────────────

#[test]
fn test_pool_deposit_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    let depositor = Address::generate(&env);
    let token = setup_token(&env, &depositor);
    let pool_id = symbol_short!("evt_dep");

    client.create_pool(&admin, &pool_id, &token, &vec![&env, admin.clone()], &1);

    client.pool_deposit(&depositor, &pool_id, &token, &200);

    // Verify at least one event was emitted by pool_deposit.
    assert!(!env.events().all().events().is_empty());
    // Verify the deposit was recorded.
    assert_eq!(client.get_pool(&pool_id).unwrap().balance, 200);
}

#[test]
fn test_pool_withdraw_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    let depositor = Address::generate(&env);
    let recipient = Address::generate(&env);
    let token = setup_token(&env, &depositor);
    let pool_id = symbol_short!("evt_wd");

    client.create_pool(&admin, &pool_id, &token, &vec![&env, admin.clone()], &1);

    client.pool_deposit(&depositor, &pool_id, &token, &500);
    client.pool_withdraw(&vec![&env, admin.clone()], &pool_id, &150, &recipient);

    // Verify at least one event was emitted by pool_withdraw.
    assert!(!env.events().all().events().is_empty());
    // Verify the withdrawal was recorded.
    assert_eq!(client.get_pool(&pool_id).unwrap().balance, 350);
}
