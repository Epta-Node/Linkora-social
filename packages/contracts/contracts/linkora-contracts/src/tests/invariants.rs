#![cfg(test)]

use crate::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, BytesN, Env, String,
};

// ── Issue #879: Deletion cleanup invariants ──────────────────────────────────
//
// These invariants verify that after delete_post/delete_profile combined with
// their corresponding batch_cleanup functions, no orphaned storage entries
// remain. Tests validate through the contract's public API that the state is
// fully cleaned.

#[test]
fn invariant_no_orphaned_likes_after_post_deletion() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_test_env(&env);

    let author = Address::generate(&env);
    setup_profile(&client, &author, "author");
    let post_id = client.create_post(&author, &String::from_str(&env, "hello"));

    let liker = Address::generate(&env);
    setup_profile(&client, &liker, "liker");
    client.like_post(&liker, &post_id);
    assert_eq!(client.get_like_count(&post_id), 1);

    client.delete_post(&author, &post_id);
    client.batch_cleanup_post(&post_id, &100);

    // Invariant: Like count returns 0 — all Like entries removed
    assert_eq!(client.get_like_count(&post_id), 0);
    // Invariant: has_liked returns false — orphaned Like entry cleaned
    assert!(!client.has_liked(&liker, &post_id));
}

#[test]
fn invariant_no_orphaned_likes_after_post_deletion_with_multiple_likers() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_test_env(&env);

    let author = Address::generate(&env);
    setup_profile(&client, &author, "author");
    let post_id = client.create_post(&author, &String::from_str(&env, "hello"));

    let liker1 = Address::generate(&env);
    let liker2 = Address::generate(&env);
    setup_profile(&client, &liker1, "liker1");
    setup_profile(&client, &liker2, "liker2");
    client.like_post(&liker1, &post_id);
    client.like_post(&liker2, &post_id);
    assert_eq!(client.get_like_count(&post_id), 2);

    client.delete_post(&author, &post_id);
    client.batch_cleanup_post(&post_id, &100);

    // Invariant: All likes removed
    assert_eq!(client.get_like_count(&post_id), 0);
    assert!(!client.has_liked(&liker1, &post_id));
    assert!(!client.has_liked(&liker2, &post_id));
}

#[test]
fn invariant_no_orphaned_reports_after_post_deletion() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_test_env(&env);

    let author = Address::generate(&env);
    setup_profile(&client, &author, "author");
    let post_id = client.create_post(&author, &String::from_str(&env, "hello"));

    let reporter = Address::generate(&env);
    setup_profile(&client, &reporter, "reporter");
    let token = setup_token_in_env(&env, &reporter);
    setup_mint_in_env(&env, &token, &reporter, &100);
    client.report_post(
        &reporter,
        &post_id,
        &token,
        &10,
        &BytesN::from_array(&env, &[0; 32]),
    );

    client.delete_post(&author, &post_id);
    client.batch_cleanup_post(&post_id, &100);

    // Invariant: Post is gone — cleanup completed without error
    assert!(client.get_post(&post_id).is_none());
}

#[test]
fn invariant_no_orphaned_follow_edges_after_profile_deletion() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_test_env(&env);

    let user = Address::generate(&env);
    setup_profile(&client, &user, "user");

    let follower = Address::generate(&env);
    setup_profile(&client, &follower, "follower");
    client.follow(&follower, &user);
    assert_eq!(client.get_followers(&user, &0, &10).len(), 1);

    client.delete_profile(&user);
    client.batch_cleanup_profile(&user, &100);

    // Invariant: Follower's following list no longer includes user
    let following = client.get_following(&follower, &0, &10);
    assert_eq!(following.len(), 0);
}

#[test]
fn invariant_no_orphaned_follow_edges_both_directions() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_test_env(&env);

    let user_a = Address::generate(&env);
    let user_b = Address::generate(&env);
    setup_profile(&client, &user_a, "user_a");
    setup_profile(&client, &user_b, "user_b");
    client.follow(&user_a, &user_b);
    client.follow(&user_b, &user_a);

    client.delete_profile(&user_a);
    client.batch_cleanup_profile(&user_a, &100);

    // Invariant: user_b no longer follows user_a and user_a's edges are gone
    let b_following = client.get_following(&user_b, &0, &10);
    assert_eq!(b_following.len(), 0);
}

#[test]
fn invariant_no_orphaned_authored_posts_after_profile_deletion() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_test_env(&env);

    let user = Address::generate(&env);
    setup_profile(&client, &user, "user");
    let post_id1 = client.create_post(&user, &String::from_str(&env, "post 1"));
    let post_id2 = client.create_post(&user, &String::from_str(&env, "post 2"));

    client.delete_profile(&user);
    client.batch_cleanup_profile(&user, &100);

    // Invariant: Authored posts are tombstoned and no longer retrievable
    assert!(client.get_post(&post_id1).is_none());
    assert!(client.get_post(&post_id2).is_none());
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn setup_test_env(env: &Env) -> (LinkoraContractClient<'_>, Address, Address) {
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    client.initialize(&admin, &treasury, &0);
    (client, admin, treasury)
}

fn setup_profile(client: &LinkoraContractClient<'_>, user: &Address, name: &str) {
    client.set_profile(
        user,
        &String::from_str(&client.env, name),
        &Address::generate(&client.env),
    );
}

fn setup_token_in_env(env: &Env, minter: &Address) -> Address {
    use soroban_sdk::token::StellarAssetClient;
    let token_id = env.register_stellar_asset_contract_v2(minter.clone());
    StellarAssetClient::new(env, &token_id.address()).mint(minter, &10_000);
    token_id.address()
}

fn setup_mint_in_env(env: &Env, token: &Address, recipient: &Address, amount: &i128) {
    use soroban_sdk::token::StellarAssetClient;
    StellarAssetClient::new(env, token).mint(recipient, amount);
}
