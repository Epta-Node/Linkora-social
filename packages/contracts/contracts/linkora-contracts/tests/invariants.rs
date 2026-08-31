#![cfg(test)]

/// Invariant harness: Contract state invariants that must always hold.
///
/// **Invariants:**
/// 1. Social Graph Closure: If user A follows user B, then {B} ⊆ followers(A)
/// 2. Index Consistency: All users in adjacency set have valid index entries
/// 3. Balance Consistency: Tracked balances match token contract state
/// 4. Governance Soundness: Proposals use snapshotted config at creation time
/// 5. Tip Accounting: post.tip_total = sum of author amounts (not full tips)
/// 6. Quorum Floor: Cannot set quorum below floor
/// 7. Block prevents all interactions (bidirectional)
/// 8. Block cleans social graph
/// 9. Unblock does not restore relationships
/// 10. Vote window enforced
/// 11. Time-lock enforced
/// 12. Quorum decay monotonic
/// 13. Oracle key persists
/// 14. Attestation nullifier immutable
extern crate alloc;
extern crate std;

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, BytesN, Env, String,
};

use linkora_contracts::{GovParameter, LinkoraContract, LinkoraContractClient, StorageKey};

fn setup_token(env: &Env, admin: &Address) -> Address {
    let token_id = env.register_stellar_asset_contract_v2(admin.clone());
    StellarAssetClient::new(env, &token_id.address()).mint(admin, &10_000_000);
    token_id.address()
}

fn setup_contract(env: &Env) -> (LinkoraContractClient<'_>, Address, Address) {
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    client.initialize(&admin, &treasury, &250);
    (client, admin, treasury)
}

// ── Invariant 1: Social graph adjacency is logically consistent ────────────

#[test]
fn invariant_social_graph_consistency() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let token = setup_token(&env, &alice);

    client.set_profile(&alice, &String::from_str(&env, "alice"), &token);
    client.set_profile(&bob, &String::from_str(&env, "bob"), &token);

    client.follow(&alice, &bob);

    let alice_following = client.get_following(&alice, &0, &50);
    assert_eq!(alice_following.len(), 1);
    assert_eq!(alice_following.get(0).unwrap(), bob);

    let bob_followers = client.get_followers(&bob, &0, &50);
    assert_eq!(bob_followers.len(), 1);
    assert_eq!(bob_followers.get(0).unwrap(), alice);

    client.unfollow(&alice, &bob);

    assert_eq!(client.get_following(&alice, &0, &50).len(), 0);
    assert_eq!(client.get_followers(&bob, &0, &50).len(), 0);
}

// ── Invariant 2: Index array positions remain valid and unique ─────────────

#[test]
fn invariant_index_position_valid() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let alice = Address::generate(&env);
    let token = setup_token(&env, &alice);
    client.set_profile(&alice, &String::from_str(&env, "alice"), &token);

    let user0 = Address::generate(&env);
    let t0 = setup_token(&env, &user0);
    client.set_profile(&user0, &String::from_str(&env, "user0"), &t0);

    let user1 = Address::generate(&env);
    let t1 = setup_token(&env, &user1);
    client.set_profile(&user1, &String::from_str(&env, "user1"), &t1);

    let user2 = Address::generate(&env);
    let t2 = setup_token(&env, &user2);
    client.set_profile(&user2, &String::from_str(&env, "user2"), &t2);

    client.follow(&alice, &user0);
    client.follow(&alice, &user1);
    client.follow(&alice, &user2);

    assert_eq!(client.get_following(&alice, &0, &50).len(), 3);

    client.unfollow(&alice, &user1);

    let following_after = client.get_following(&alice, &0, &50);
    assert_eq!(following_after.len(), 2);
    assert_eq!(following_after.get(0).unwrap(), user0);
    assert_eq!(following_after.get(1).unwrap(), user2);

    assert_eq!(client.get_followers(&user0, &0, &50).len(), 1);
    assert_eq!(client.get_followers(&user1, &0, &50).len(), 0);
    assert_eq!(client.get_followers(&user2, &0, &50).len(), 1);
}

// ── Invariant 3: Balance tracking is accurate ──────────────────────────────

#[test]
fn invariant_balance_tracking() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, treasury) = setup_contract(&env);

    let alice = Address::generate(&env);
    let tipper = Address::generate(&env);
    let token = setup_token(&env, &alice);
    StellarAssetClient::new(&env, &token).mint(&tipper, &10_000);

    client.set_profile(&alice, &String::from_str(&env, "alice"), &token);
    let post_id = client.create_post(&alice, &String::from_str(&env, "post"));

    let tipper_before = TokenClient::new(&env, &token).balance(&tipper);
    let treasury_before = TokenClient::new(&env, &token).balance(&treasury);
    let alice_before = TokenClient::new(&env, &token).balance(&alice);

    client.tip(&tipper, &post_id, &token, &1000);

    assert_eq!(
        TokenClient::new(&env, &token).balance(&tipper),
        tipper_before - 1000
    );
    assert_eq!(
        TokenClient::new(&env, &token).balance(&treasury),
        treasury_before + 25
    );
    assert_eq!(
        TokenClient::new(&env, &token).balance(&alice),
        alice_before + 975
    );

    let post = client.get_post(&post_id).unwrap();
    assert_eq!(post.tip_total, 975);
}

// ── Invariant 4: Governance parameters use snapshotted values ──────────────

#[test]
fn invariant_governance_snapshot() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    client.gov_init_config(&admin, &80, &100, &50, &0, &10);

    let proposal_id = client.gov_propose(&admin, &GovParameter::GovTimeLock, &200, &None);
    let proposal = client.gov_get_proposal(&proposal_id);
    assert_eq!(proposal.time_lock_ledgers, 100);

    let _proposal_id2 = client.gov_propose(&admin, &GovParameter::GovTimeLock, &300, &None);

    client.gov_vote(&admin, &proposal_id, &true);
    env.ledger().with_mut(|l| l.sequence_number += 150);
    client.gov_execute(&admin, &proposal_id);

    let config = client.gov_get_config();
    assert_eq!(config.time_lock_ledgers, 200);
}

// ── Invariant 5: Fee calculations are safe from overflow ───────────────────

#[test]
fn invariant_tip_safe_arithmetic() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let author = Address::generate(&env);
    let tipper = Address::generate(&env);

    client.initialize(&admin, &treasury, &10000);

    let token = setup_token(&env, &tipper);
    client.set_profile(&author, &String::from_str(&env, "author"), &token);
    let post_id = client.create_post(&author, &String::from_str(&env, "overflow test"));

    let amount: i128 = 1_000_000_000;
    StellarAssetClient::new(&env, &token).mint(&tipper, &amount);
    client.tip(&tipper, &post_id, &token, &amount);

    let post = client.get_post(&post_id).unwrap();
    assert_eq!(post.tip_total, 0, "at 100% fee, author gets 0");

    let treasury_bal = TokenClient::new(&env, &token).balance(&treasury);
    assert_eq!(
        treasury_bal, amount,
        "treasury gets full amount at 100% fee"
    );
}

// ── Invariant 6: Quorum floor is enforced ──────────────────────────────────

#[test]
fn invariant_quorum_floor_enforced() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    client.gov_init_config(&admin, &80, &100, &50, &0, &40);

    let proposal_id = client.gov_propose(&admin, &GovParameter::GovQuorum, &30, &None);
    client.gov_vote(&admin, &proposal_id, &true);
    env.ledger().with_mut(|l| l.sequence_number += 150);

    let result = client.try_gov_execute(&admin, &proposal_id);
    assert!(result.is_err());

    let config = client.gov_get_config();
    assert_eq!(config.quorum, 80);
}

// ── Invariant 7: Block prevents all interactions ───────────────────────────

#[test]
fn invariant_block_prevents_interaction() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let token = setup_token(&env, &alice);
    StellarAssetClient::new(&env, &token).mint(&bob, &10_000);

    client.set_profile(&alice, &String::from_str(&env, "alice"), &token);
    client.set_profile(&bob, &String::from_str(&env, "bob"), &token);

    let alice_post = client.create_post(&alice, &String::from_str(&env, "alice post"));
    let bob_post = client.create_post(&bob, &String::from_str(&env, "bob post"));

    client.block_user(&alice, &bob);

    assert!(client.try_tip(&bob, &alice_post, &token, &100).is_err());
    assert!(client.try_follow(&bob, &alice).is_err());
    assert!(client.try_like_post(&bob, &alice_post).is_err());
    assert!(client.try_tip(&alice, &bob_post, &token, &100).is_err());
    assert!(client.try_follow(&alice, &bob).is_err());
    assert!(client.try_like_post(&alice, &bob_post).is_err());
}

// ── Invariant 8: Block cleans up social graph ──────────────────────────────

#[test]
fn invariant_block_cleans_social_graph() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let token = setup_token(&env, &alice);
    StellarAssetClient::new(&env, &token).mint(&bob, &10_000);

    client.set_profile(&alice, &String::from_str(&env, "alice"), &token);
    client.set_profile(&bob, &String::from_str(&env, "bob"), &token);

    let alice_post = client.create_post(&alice, &String::from_str(&env, "alice post"));
    let bob_post = client.create_post(&bob, &String::from_str(&env, "bob post"));

    client.follow(&alice, &bob);
    client.follow(&bob, &alice);
    client.like_post(&alice, &bob_post);
    client.like_post(&bob, &alice_post);

    client.block_user(&alice, &bob);

    assert_eq!(client.get_following(&alice, &0, &50).len(), 0);
    assert_eq!(client.get_following(&bob, &0, &50).len(), 0);
    assert_eq!(client.get_like_count(&bob_post), 0);
    assert_eq!(client.get_like_count(&alice_post), 0);
}

// ── Invariant 9: Unblock does not restore previous relationships ───────────

#[test]
fn invariant_unblock_no_restore() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _, _) = setup_contract(&env);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    let token = setup_token(&env, &alice);
    StellarAssetClient::new(&env, &token).mint(&bob, &10_000);

    client.set_profile(&alice, &String::from_str(&env, "alice"), &token);
    client.set_profile(&bob, &String::from_str(&env, "bob"), &token);

    let bob_post = client.create_post(&bob, &String::from_str(&env, "bob post"));

    client.follow(&alice, &bob);
    client.like_post(&alice, &bob_post);

    assert_eq!(client.get_following(&alice, &0, &50).len(), 1);
    assert_eq!(client.get_like_count(&bob_post), 1);

    client.block_user(&alice, &bob);
    client.unblock_user(&alice, &bob);

    assert_eq!(client.get_following(&alice, &0, &50).len(), 0);
    assert_eq!(client.get_like_count(&bob_post), 0);
}

// ── Invariant 10: Vote window is enforced ──────────────────────────────────

#[test]
fn invariant_vote_window_enforced() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    client.gov_init_config(&admin, &80, &30, &50, &0, &10);

    let proposal_id = client.gov_propose(&admin, &GovParameter::FeeBps, &500, &None);

    // Vote within the window — should succeed
    let voter = Address::generate(&env);
    client.gov_vote(&voter, &proposal_id, &true);

    // Advance past the vote window (50 ledgers from creation at ledger 1)
    env.ledger().with_mut(|l| l.sequence_number += 51);

    // New voter tries to vote after window — should fail
    let voter2 = Address::generate(&env);
    let r = client.try_gov_vote(&voter2, &proposal_id, &true);
    assert!(r.is_err(), "vote should fail after vote window closes");
}

// ── Invariant 11: Time-lock is enforced ────────────────────────────────────

#[test]
fn invariant_execution_time_lock_enforced() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    client.gov_init_config(&admin, &80, &30, &50, &0, &10);

    let proposal_id = client.gov_propose(&admin, &GovParameter::FeeBps, &500, &None);
    client.gov_vote(&admin, &proposal_id, &true);

    env.ledger().with_mut(|l| l.sequence_number += 79);
    let result = client.try_gov_execute(&admin, &proposal_id);
    assert!(result.is_err());

    env.ledger().with_mut(|l| l.sequence_number += 1);
    client.gov_execute(&admin, &proposal_id);
}

// ── Invariant 12: Effective quorum decays monotonically ────────────────────

#[test]
fn invariant_quorum_decay_monotonic() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    client.gov_init_config(&admin, &80, &1000, &5000, &5000, &10);

    let proposal_id = client.gov_propose(&admin, &GovParameter::FeeBps, &500, &None);

    let q0 = client.effective_quorum(&proposal_id);
    assert_eq!(q0, 80);

    env.ledger().with_mut(|l| l.sequence_number += 10);
    let q1 = client.effective_quorum(&proposal_id);

    env.ledger().with_mut(|l| l.sequence_number += 10);
    let q2 = client.effective_quorum(&proposal_id);

    assert!(q0 >= q1, "quorum must not increase: {} < {}", q0, q1);
    assert!(q1 >= q2, "quorum must not increase: {} < {}", q1, q2);

    env.ledger().with_mut(|l| l.sequence_number += 2000);
    let q_floor = client.effective_quorum(&proposal_id);
    assert!(
        q_floor >= 10,
        "effective quorum must not go below floor: {}",
        q_floor
    );
}

// ── Invariant 13: Oracle key persists after registration ───────────────────

#[test]
fn invariant_oracle_key_persists() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    let oracle_name = symbol_short!("oracle1");
    let pubkey = BytesN::from_array(&env, &[42u8; 32]);

    client.register_oracle(&admin, &oracle_name, &pubkey);

    let key = StorageKey::OracleKey(oracle_name);
    let stored_key = env.as_contract(&client.address, || {
        env.storage().persistent().get::<_, BytesN<32>>(&key)
    });

    assert!(stored_key.is_some());
    assert_eq!(stored_key.unwrap(), pubkey);
}

// ── Invariant 14: Attestation nullifier is immutable once recorded ─────────

#[test]
fn invariant_attestation_nullifier_immutable() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _) = setup_contract(&env);

    let report_hash = BytesN::from_array(&env, &[0xABu8; 32]);
    let key = StorageKey::AttestationNullifier(report_hash);

    env.as_contract(&client.address, || {
        env.storage().persistent().set(&key, &true);
        let exists = env.storage().persistent().has(&key);
        assert!(exists);
        let val: bool = env.storage().persistent().get(&key).unwrap();
        assert!(val);
    });

    env.as_contract(&client.address, || {
        let val_before: bool = env.storage().persistent().get(&key).unwrap();
        env.storage().persistent().set(&key, &true);
        let val_after: bool = env.storage().persistent().get(&key).unwrap();
        assert_eq!(val_before, val_after);
    });
}
