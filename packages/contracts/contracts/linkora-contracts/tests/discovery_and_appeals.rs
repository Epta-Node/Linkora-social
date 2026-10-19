#![cfg(test)]

use linkora_contracts::{
    AppealStatus, LinkoraContract, LinkoraContractClient, ReportStatus, Role,
};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    token::{self, StellarAssetClient},
    vec, Address, BytesN, Env, String,
};

fn deploy(env: &Env) -> (LinkoraContractClient<'_>, Address, Address) {
    env.mock_all_auths();
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    client.initialize(&admin, &treasury, &0);
    (client, admin, contract_id)
}

fn setup_token(env: &Env, admin: &Address) -> Address {
    let token_id = env.register_stellar_asset_contract_v2(admin.clone());
    StellarAssetClient::new(env, &token_id.address()).mint(admin, &10_000);
    token_id.address()
}

/// Uphold a report on `post_id` as `author`, leaving the post removed and an
/// appeal window open. Returns `(reporter, rev_a, rev_b)`.
fn uphold_report(
    env: &Env,
    client: &LinkoraContractClient<'_>,
    admin: &Address,
    contract_id: &Address,
    author: &Address,
) -> (Address, Address, Address, u64) {
    let reporter = Address::generate(env);
    let creator_token = setup_token(env, author);
    token::Client::new(env, &creator_token).approve(
        author,
        contract_id,
        &1_000,
        &(env.ledger().sequence() + 1_000_000),
    );
    let stake_token = setup_token(env, &reporter);

    client.set_profile(author, &String::from_str(env, "author"), &creator_token);
    let post_id = client.create_post(author, &String::from_str(env, "reported post"));

    client.grant_role(admin, admin, &Role::Moderator);
    let moderator = admin.clone();
    let rev_a = Address::generate(env);
    let rev_b = Address::generate(env);
    let pool_admins = vec![env, moderator.clone(), rev_a.clone(), rev_b.clone()];
    client.create_pool(&moderator, &symbol_short!("mods"), &stake_token, &pool_admins, &2);

    client.report_post(
        &reporter,
        &post_id,
        &stake_token,
        &500,
        &BytesN::from_array(env, &[2u8; 32]),
    );

    let signers = vec![env, rev_a.clone(), rev_b.clone()];
    client.review_report(&moderator, &signers, &post_id, &reporter, &ReportStatus::Upheld);
    assert!(client.get_post(&post_id).is_none(), "post must be removed after upheld report");

    (reporter, rev_a, rev_b, post_id)
}

// ── #1672: paginated follow suggestions ───────────────────────────────────────

#[test]
fn suggested_follows_returns_distinct_second_hop_excluding_seen() {
    let env = Env::default();
    let (client, _admin, _cid) = deploy(&env);
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let carol = Address::generate(&env);
    let dave = Address::generate(&env);

    client.follow(&alice, &bob);
    client.follow(&bob, &carol);
    client.follow(&bob, &dave);

    let suggestions = client.get_suggested_follows(&alice, &0, &10);
    assert_eq!(suggestions.len(), 2);
    assert!(suggestions.iter().any(|a| a == carol));
    assert!(suggestions.iter().any(|a| a == dave));
    assert!(!suggestions.iter().any(|a| a == alice));
    assert!(!suggestions.iter().any(|a| a == bob));

    // Accounts the viewer already follows are excluded from suggestions.
    client.follow(&alice, &carol);
    let after = client.get_suggested_follows(&alice, &0, &10);
    assert!(!after.iter().any(|a| a == carol));
    assert!(after.iter().any(|a| a == dave));

    // Pagination returns a bounded page.
    let page = client.get_suggested_follows(&alice, &0, &1);
    assert_eq!(page.len(), 1);
}

// ── #1673: post content-hash anchoring ────────────────────────────────────────

#[test]
fn content_hash_roundtrip_and_verification() {
    let env = Env::default();
    let (client, _admin, _cid) = deploy(&env);
    let author = Address::generate(&env);
    let post_id = client.create_post(&author, &String::from_str(&env, "hello world"));

    assert!(client.get_post_content_hash(&post_id).is_none());

    let hash = BytesN::from_array(&env, &[9u8; 32]);
    client.set_post_content_hash(&author, &post_id, &hash);

    assert_eq!(client.get_post_content_hash(&post_id).unwrap(), hash);
    assert!(client.verify_post_content_hash(&post_id, &hash));
    assert!(!client.verify_post_content_hash(&post_id, &BytesN::from_array(&env, &[0u8; 32])));

    // The author may re-anchor a new hash.
    let hash2 = BytesN::from_array(&env, &[10u8; 32]);
    client.set_post_content_hash(&author, &post_id, &hash2);
    assert_eq!(client.get_post_content_hash(&post_id).unwrap(), hash2);
}

#[test]
#[should_panic(expected = "only author can set content hash")]
fn content_hash_rejected_for_non_author() {
    let env = Env::default();
    let (client, _admin, _cid) = deploy(&env);
    let author = Address::generate(&env);
    let other = Address::generate(&env);
    let post_id = client.create_post(&author, &String::from_str(&env, "hi"));
    client.set_post_content_hash(&other, &post_id, &BytesN::from_array(&env, &[1u8; 32]));
}

// ── #1669: moderation appeals ─────────────────────────────────────────────────

#[test]
fn appeal_restores_post_after_quorum() {
    let env = Env::default();
    let (client, admin, contract_id) = deploy(&env);
    let author = Address::generate(&env);
    let (_reporter, rev_a, rev_b, post_id) =
        uphold_report(&env, &client, &admin, &contract_id, &author);

    client.appeal_moderation(&author, &post_id, &BytesN::from_array(&env, &[3u8; 32]));
    let appeal = client.get_appeal(&post_id).unwrap();
    assert_eq!(appeal.status, AppealStatus::Pending);
    assert_eq!(appeal.appellant, author);

    // A single approval is short of the two-reviewer quorum.
    client.review_appeal(&rev_a, &post_id, &true);
    assert_eq!(client.get_appeal(&post_id).unwrap().status, AppealStatus::Pending);
    assert!(client.get_post(&post_id).is_none());

    // The second distinct approval reaches quorum and restores the post.
    client.review_appeal(&rev_b, &post_id, &true);
    assert_eq!(client.get_appeal(&post_id).unwrap().status, AppealStatus::Approved);
    assert!(client.get_post(&post_id).is_some(), "post must be restored on approved appeal");
}

#[test]
fn rejected_appeal_keeps_post_removed() {
    let env = Env::default();
    let (client, admin, contract_id) = deploy(&env);
    let author = Address::generate(&env);
    let (_reporter, rev_a, rev_b, post_id) =
        uphold_report(&env, &client, &admin, &contract_id, &author);

    client.appeal_moderation(&author, &post_id, &BytesN::from_array(&env, &[4u8; 32]));
    client.review_appeal(&rev_a, &post_id, &false);
    client.review_appeal(&rev_b, &post_id, &false);

    assert_eq!(client.get_appeal(&post_id).unwrap().status, AppealStatus::Rejected);
    assert!(client.get_post(&post_id).is_none());
}

#[test]
#[should_panic(expected = "appeal window has closed")]
fn appeal_after_window_panics() {
    let env = Env::default();
    let (client, admin, contract_id) = deploy(&env);
    let author = Address::generate(&env);
    let (_reporter, _rev_a, _rev_b, post_id) =
        uphold_report(&env, &client, &admin, &contract_id, &author);

    env.ledger().with_mut(|l| l.sequence_number += 1_000_000);
    client.appeal_moderation(&author, &post_id, &BytesN::from_array(&env, &[5u8; 32]));
}
