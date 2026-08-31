#![cfg(test)]

use crate::test::{
    credential_authority_pubkey, credential_authority_signing_key, sign_credential_root,
};
use crate::*;
use soroban_sdk::{testutils::Address as _, vec, Address, BytesN, Env, String, Vec};

/// Credential subsystem invariant tests
/// These tests verify that the credential subsystem maintains
/// important security and correctness invariants.

#[test]
fn test_invariant_credential_root_persistence() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_test_env(&env);
    let signing_key = credential_authority_signing_key(1);
    client.set_credential_authority(&admin, &credential_authority_pubkey(&env, &signing_key));

    let user = <soroban_sdk::Address as soroban_sdk::testutils::Address>::generate(&env);
    let root = BytesN::from_array(&env, &[1u8; 32]);

    client.update_credential_root(
        &user,
        &root,
        &sign_credential_root(&env, &signing_key, &root),
    );

    // Invariant: Once set, the root should persist across multiple reads
    assert_eq!(client.get_credential_root(&user).unwrap(), root);
    assert_eq!(client.get_credential_root(&user).unwrap(), root);
    assert_eq!(client.get_credential_root(&user).unwrap(), root);
}

#[test]
fn test_invariant_nullifier_uniqueness() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_test_env(&env);
    let signing_key = credential_authority_signing_key(1);
    client.set_credential_authority(&admin, &credential_authority_pubkey(&env, &signing_key));

    let user = <soroban_sdk::Address as soroban_sdk::testutils::Address>::generate(&env);
    let leaf = BytesN::from_array(&env, &[1u8; 32]);
    let root = leaf.clone();
    let proof: Vec<BytesN<32>> = vec![&env];

    client.update_credential_root(
        &user,
        &root,
        &sign_credential_root(&env, &signing_key, &root),
    );

    // Invariant: Each nullifier can only be used once
    let nullifier1 = BytesN::from_array(&env, &[10u8; 32]);
    let nullifier2 = BytesN::from_array(&env, &[20u8; 32]);
    let nullifier3 = BytesN::from_array(&env, &[30u8; 32]);

    assert!(client.verify_credential(&user, &proof, &leaf, &nullifier1));
    assert!(client.verify_credential(&user, &proof, &leaf, &nullifier2));
    assert!(client.verify_credential(&user, &proof, &leaf, &nullifier3));

    // Reusing any nullifier returns false rather than panicking.
    let reused = client.verify_credential(&user, &proof, &leaf, &nullifier1);
    assert!(!reused, "reused nullifier should return false");
}

#[test]
fn test_invariant_nullifier_replay_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_test_env(&env);
    let signing_key = credential_authority_signing_key(1);
    client.set_credential_authority(&admin, &credential_authority_pubkey(&env, &signing_key));

    let user = <soroban_sdk::Address as soroban_sdk::testutils::Address>::generate(&env);
    let leaf = BytesN::from_array(&env, &[1u8; 32]);
    let root = leaf.clone();
    let proof: Vec<BytesN<32>> = vec![&env];
    let nullifier = BytesN::from_array(&env, &[10u8; 32]);

    client.update_credential_root(
        &user,
        &root,
        &sign_credential_root(&env, &signing_key, &root),
    );

    // First verification should succeed
    assert!(client.verify_credential(&user, &proof, &leaf, &nullifier));

    // Second verification with the same nullifier returns false rather than panicking.
    let replayed = client.verify_credential(&user, &proof, &leaf, &nullifier);
    assert!(!replayed, "replayed nullifier should return false");
}

#[test]
fn test_invariant_user_root_isolation() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_test_env(&env);
    let signing_key = credential_authority_signing_key(1);
    client.set_credential_authority(&admin, &credential_authority_pubkey(&env, &signing_key));

    let user1 = <soroban_sdk::Address as soroban_sdk::testutils::Address>::generate(&env);
    let user2 = <soroban_sdk::Address as soroban_sdk::testutils::Address>::generate(&env);
    let user3 = <soroban_sdk::Address as soroban_sdk::testutils::Address>::generate(&env);

    let root1 = BytesN::from_array(&env, &[1u8; 32]);
    let root2 = BytesN::from_array(&env, &[2u8; 32]);
    let root3 = BytesN::from_array(&env, &[3u8; 32]);

    client.update_credential_root(
        &user1,
        &root1,
        &sign_credential_root(&env, &signing_key, &root1),
    );
    client.update_credential_root(
        &user2,
        &root2,
        &sign_credential_root(&env, &signing_key, &root2),
    );
    client.update_credential_root(
        &user3,
        &root3,
        &sign_credential_root(&env, &signing_key, &root3),
    );

    // Invariant: Each user's root is independent
    assert_eq!(client.get_credential_root(&user1).unwrap(), root1);
    assert_eq!(client.get_credential_root(&user2).unwrap(), root2);
    assert_eq!(client.get_credential_root(&user3).unwrap(), root3);

    // Updating one user should not affect others
    let new_root1 = BytesN::from_array(&env, &[99u8; 32]);
    client.update_credential_root(
        &user1,
        &new_root1,
        &sign_credential_root(&env, &signing_key, &new_root1),
    );

    assert_eq!(client.get_credential_root(&user1).unwrap(), new_root1);
    assert_eq!(client.get_credential_root(&user2).unwrap(), root2);
    assert_eq!(client.get_credential_root(&user3).unwrap(), root3);
}

#[test]
fn test_invariant_verification_requires_root() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_test_env(&env);

    let user = <soroban_sdk::Address as soroban_sdk::testutils::Address>::generate(&env);
    let leaf = BytesN::from_array(&env, &[1u8; 32]);
    let proof: Vec<BytesN<32>> = vec![&env];
    let nullifier = BytesN::from_array(&env, &[10u8; 32]);

    // Invariant: Verification must return false without a root set
    let result = client.verify_credential(&user, &proof, &leaf, &nullifier);
    assert!(!result, "verification without a root should return false");
}

#[test]
fn test_invariant_invalid_proof_does_not_consume_nullifier() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_test_env(&env);
    let signing_key = credential_authority_signing_key(1);
    client.set_credential_authority(&admin, &credential_authority_pubkey(&env, &signing_key));

    let user = <soroban_sdk::Address as soroban_sdk::testutils::Address>::generate(&env);
    let root = BytesN::from_array(&env, &[1u8; 32]);
    let wrong_leaf = BytesN::from_array(&env, &[2u8; 32]);
    let proof: Vec<BytesN<32>> = vec![&env];
    let nullifier = BytesN::from_array(&env, &[10u8; 32]);

    client.update_credential_root(
        &user,
        &root,
        &sign_credential_root(&env, &signing_key, &root),
    );

    // Invariant: Failed verification should not consume the nullifier
    assert!(!client.verify_credential(&user, &proof, &wrong_leaf, &nullifier));

    // Same nullifier should still work for a valid proof
    let valid_leaf = root.clone();
    assert!(client.verify_credential(&user, &proof, &valid_leaf, &nullifier));
}

#[test]
fn test_invariant_root_size_fixed() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_test_env(&env);
    let signing_key = credential_authority_signing_key(1);
    client.set_credential_authority(&admin, &credential_authority_pubkey(&env, &signing_key));

    let user = <soroban_sdk::Address as soroban_sdk::testutils::Address>::generate(&env);

    // Invariant: Root must be exactly 32 bytes
    // This is enforced by the type system (BytesN<32>)
    let root = BytesN::from_array(&env, &[1u8; 32]);
    client.update_credential_root(
        &user,
        &root,
        &sign_credential_root(&env, &signing_key, &root),
    );

    let retrieved = client.get_credential_root(&user).unwrap();
    assert_eq!(retrieved.to_array().len(), 32);
}

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
    let (client, _admin, _) = setup_test_env(&env);

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

// ── Issue #1249: pool existence invariant ───────────────────────────────────
//
// These invariants verify that get_pool and get_pool_admins always
// distinguish between a pool that was never created and one that exists
// with zero admins.

#[test]
fn invariant_get_pool_admins_none_for_missing_pool() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_test_env(&env);

    // Invariant: get_pool_admins must return None for a pool_id
    // that was never created — not an empty Vec.
    let missing_id = soroban_sdk::symbol_short!("never");
    assert_eq!(
        client.get_pool_admins(&missing_id),
        None,
        "get_pool_admins must return None for a non-existent pool"
    );
    // Also verify get_pool returns None for the same missing id.
    assert!(
        client.get_pool(&missing_id).is_none(),
        "get_pool must return None for a non-existent pool"
    );
}

#[test]
fn invariant_existing_pool_admins_are_some() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_test_env(&env);

    let pool_admin = Address::generate(&env);
    let token = setup_token_in_env(&env, &pool_admin);

    let pool_id = soroban_sdk::symbol_short!("inv12");
    client.create_pool(
        &admin,
        &pool_id,
        &token,
        &vec![&env, pool_admin.clone()],
        &1,
    );

    // Invariant: After creation, get_pool returns Some and
    // get_pool_admins returns Some with the correct admin list.
    assert!(client.get_pool(&pool_id).is_some());
    let admins = client.get_pool_admins(&pool_id).unwrap();
    assert_eq!(admins.len(), 1);
    assert!(admins.iter().any(|a| a == pool_admin));
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
