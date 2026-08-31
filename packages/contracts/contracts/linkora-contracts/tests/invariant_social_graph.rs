#![cfg(test)]

//! Property-based invariant tests for the social graph contract.
//!
//! These exercise the real contract (via `LinkoraContractClient`) with
//! randomized inputs and assert that core accounting invariants hold no
//! matter what sequence of operations proptest generates. See
//! `tests/FUZZING.md` for how to add more targets.

use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env, String as SdkString,
};

use linkora_contracts::{LinkoraContract, LinkoraContractClient};

fn setup(fee_bps: u32) -> (Env, LinkoraContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, LinkoraContract);
    let client = LinkoraContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &treasury, &fee_bps);

    (env, client, admin, treasury)
}

fn setup_token(env: &Env, admin: &Address) -> Address {
    let token_id = env.register_stellar_asset_contract_v2(admin.clone());
    token_id.address()
}

fn name(env: &Env, s: &str) -> SdkString {
    SdkString::from_str(env, s)
}

fn set_profile(env: &Env, client: &LinkoraContractClient, user: &Address, username: &str) {
    let creator_token = Address::generate(env);
    client.set_profile(user, &name(env, username), &creator_token);
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    /// Invariant: follower/following counts reported by the contract always
    /// equal the number of rows actually stored, for any sequence of
    /// follow/unfollow calls between two fixed users.
    #[test]
    fn invariant_follow_count_matches_rows(
        ops in prop::collection::vec(any::<bool>(), 0..30),
    ) {
        let (env, client, _admin, _treasury) = setup(0);
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);
        set_profile(&env, &client, &alice, "alice");
        set_profile(&env, &client, &bob, "bob");

        let mut following = false;
        for &should_follow in &ops {
            if should_follow {
                client.follow(&alice, &bob);
                following = true;
            } else {
                client.unfollow(&alice, &bob);
                following = false;
            }
        }

        let bob_followers = client.get_followers(&bob, &0, &50);
        let alice_following = client.get_following(&alice, &0, &50);

        prop_assert_eq!(bob_followers.contains(&alice), following);
        prop_assert_eq!(alice_following.contains(&bob), following);
        prop_assert_eq!(bob_followers.len() as usize, following as usize);
        prop_assert_eq!(alice_following.len() as usize, following as usize);
    }

    /// Invariant: like_count on a post always equals the number of distinct
    /// users who have successfully liked it (double-likes are no-ops).
    #[test]
    fn invariant_like_count_matches_likers(
        like_attempts in prop::collection::vec(0usize..5, 0..30),
    ) {
        let (env, client, _admin, _treasury) = setup(0);
        let author = Address::generate(&env);
        set_profile(&env, &client, &author, "author");
        let post_id = client.create_post(&author, &name(&env, "hello world"));

        let mut likers: Vec<Address> = Vec::new();
        for i in 0..5 {
            let u = Address::generate(&env);
            set_profile(&env, &client, &u, &format!("liker{i}"));
            likers.push(u);
        }

        let mut liked = [false; 5];
        for &idx in &like_attempts {
            client.like_post(&likers[idx], &post_id);
            liked[idx] = true;
        }

        let expected_count: u64 = liked.iter().filter(|x| **x).count() as u64;
        prop_assert_eq!(client.get_like_count(&post_id), expected_count);

        for (idx, liker) in likers.iter().enumerate() {
            prop_assert_eq!(client.has_liked(liker, &post_id), liked[idx]);
        }
    }

    /// Invariant: tip conservation. For every tip, the amount debited from
    /// the tipper equals exactly the amount credited to the author plus the
    /// amount credited to the treasury (total_tips_in == total_tips_out),
    /// and the post's tracked tip_total only ever accumulates the
    /// author's share.
    #[test]
    fn invariant_tip_balance_conservation(
        fee_bps in 0u32..=10_000,
        amounts in prop::collection::vec(1i128..1_000_000, 1..8),
    ) {
        let (env, client, _admin, treasury) = setup(fee_bps);
        let author = Address::generate(&env);
        set_profile(&env, &client, &author, "author");
        let post_id = client.create_post(&author, &name(&env, "content"));

        let token_admin = Address::generate(&env);
        let token = setup_token(&env, &token_admin);
        let token_sac = StellarAssetClient::new(&env, &token);
        let token_client = TokenClient::new(&env, &token);

        let total_amount: i128 = amounts.iter().sum();
        let tipper = Address::generate(&env);
        set_profile(&env, &client, &tipper, "tipper");
        token_sac.mint(&tipper, &(total_amount * 2));

        let author_balance_before = token_client.balance(&author);
        let treasury_balance_before = token_client.balance(&treasury);

        let mut expected_tip_total: i128 = 0;
        for &amount in &amounts {
            client.tip(&tipper, &post_id, &token, &amount);

            let fee_amount = (amount / 10_000) * fee_bps as i128
                + (amount % 10_000) * fee_bps as i128 / 10_000;
            let author_amount = amount - fee_amount;
            expected_tip_total += author_amount;

            // Fast-forward past the default per-tipper tip cooldown (17_280
            // ledgers) so the next tip in this sequence is accepted.
            env.ledger().with_mut(|l| l.sequence_number += 20_000);
        }

        let author_balance_after = token_client.balance(&author);
        let treasury_balance_after = token_client.balance(&treasury);

        let total_out = (author_balance_after - author_balance_before)
            + (treasury_balance_after - treasury_balance_before);

        // Total debited from tipper must equal total credited to author + treasury.
        prop_assert_eq!(total_out, total_amount);
        // The post's recorded tip_total must match the sum of author shares only.
        prop_assert_eq!(client.get_post(&post_id).unwrap().tip_total, expected_tip_total);
    }

    /// Invariant: pool balance conservation. balance == sum(deposits) -
    /// sum(withdrawals) for any interleaving of deposit/withdraw calls.
    #[test]
    fn invariant_pool_balance_conservation(
        deposits in prop::collection::vec(1i128..1_000_000, 1..6),
        withdraw_fracs in prop::collection::vec(0u32..100, 1..6),
    ) {
        let (env, client, admin, _treasury) = setup(0);
        let token_admin = Address::generate(&env);
        let token = setup_token(&env, &token_admin);
        let token_sac = StellarAssetClient::new(&env, &token);

        let pool_id = soroban_sdk::Symbol::new(&env, "pool1");
        client.create_pool(&admin, &pool_id, &token, &soroban_sdk::vec![&env, admin.clone()], &1);

        let mut expected_balance: i128 = 0;
        for (i, &amount) in deposits.iter().enumerate() {
            let depositor = Address::generate(&env);
            token_sac.mint(&depositor, &amount);
            client.pool_deposit(&depositor, &pool_id, &token, &amount);
            expected_balance += amount;
            let _ = i;
        }

        for &frac in &withdraw_fracs {
            let current = client.get_pool(&pool_id).unwrap().balance;
            if current == 0 {
                continue;
            }
            let amount = ((current * frac as i128) / 100).max(1).min(current);
            let recipient = Address::generate(&env);
            client.pool_withdraw(&soroban_sdk::vec![&env, admin.clone()], &pool_id, &amount, &recipient);
            expected_balance -= amount;
        }

        let pool = client.get_pool(&pool_id).unwrap();
        prop_assert_eq!(pool.balance, expected_balance);
    }
}
