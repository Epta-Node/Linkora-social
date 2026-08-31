#![cfg(test)]

use linkora_contracts::{LinkoraContract, LinkoraContractClient};
use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String as SdkString};

// Property-based tests for social graph integrity
// These tests verify that the follow/unfollow/block invariants hold
// under arbitrary sequences of operations.

fn setup_contract() -> (Env, LinkoraContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, LinkoraContract);
    let client = LinkoraContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    client.initialize(&admin, &treasury, &500);

    (env, client)
}

fn set_profile(env: &Env, client: &LinkoraContractClient, user: &Address, username: &str) {
    let creator_token = Address::generate(env);
    client.set_profile(user, &SdkString::from_str(env, username), &creator_token);
}

proptest! {
    #[test]
    fn test_fuzz_follow_unfollow_consistency(
        ops in prop::collection::vec(any::<bool>(), 0..20)
    ) {
        let (env, client) = setup_contract();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        set_profile(&env, &client, &alice, "alice");
        set_profile(&env, &client, &bob, "bob");

        let mut expected_following = false;

        for &should_follow in &ops {
            if should_follow {
                client.follow(&alice, &bob);
                expected_following = true;
            } else {
                client.unfollow(&alice, &bob);
                expected_following = false;
            }
        }

        let followers = client.get_followers(&bob, &0, &50);
        let is_following = followers.contains(&alice);

        prop_assert_eq!(is_following, expected_following,
            "Follow state mismatch: expected {}, got {}", expected_following, is_following);
    }

    #[test]
    fn test_fuzz_block_unblock_consistency(
        ops in prop::collection::vec(any::<bool>(), 0..20)
    ) {
        let (env, client) = setup_contract();
        let alice = Address::generate(&env);
        let bob = Address::generate(&env);

        set_profile(&env, &client, &alice, "alice");
        set_profile(&env, &client, &bob, "bob");

        // Follow first
        client.follow(&alice, &bob);

        let mut expected_blocked = false;

        for &should_block in &ops {
            if should_block {
                client.block_user(&alice, &bob);
                expected_blocked = true;
            } else {
                client.unblock_user(&alice, &bob);
                expected_blocked = false;
            }
        }

        // If blocked, follow should have been removed
        let followers = client.get_followers(&bob, &0, &50);
        let is_following = followers.contains(&alice);

        if expected_blocked {
            prop_assert!(!is_following, "Block should remove follow relationship");
        }
    }

    #[test]
    fn test_fuzz_follow_count_accuracy(
        num_followers in 1usize..15,
    ) {
        let (env, client) = setup_contract();
        let target = Address::generate(&env);

        set_profile(&env, &client, &target, "target");

        let mut followers = Vec::new();

        for i in 0..num_followers {
            let follower = Address::generate(&env);
            let username = format!("user{}", i);
            set_profile(&env, &client, &follower, &username);
            client.follow(&follower, &target);
            followers.push(follower);
        }

        let retrieved_followers = client.get_followers(&target, &0, &50);
        prop_assert_eq!(retrieved_followers.len(), num_followers as u32,
            "Follower count mismatch: expected {}, got {}", num_followers, retrieved_followers.len());

        for follower in &followers {
            prop_assert!(retrieved_followers.contains(follower),
                "Follower not found in list");
        }
    }

    #[test]
    fn test_fuzz_block_removes_follows(
        num_initial_follows in 1usize..10,
        block_index in 0usize..10,
    ) {
        prop_assume!(block_index < num_initial_follows);

        let (env, client) = setup_contract();
        let blocker = Address::generate(&env);

        set_profile(&env, &client, &blocker, "blocker");

        let mut users = Vec::new();

        for i in 0..num_initial_follows {
            let user = Address::generate(&env);
            let username = format!("user{}", i);
            set_profile(&env, &client, &user, &username);

            // Mutual follow
            client.follow(&blocker, &user);
            client.follow(&user, &blocker);

            users.push(user);
        }

        let blocked_user = &users[block_index];
        client.block_user(&blocker, blocked_user);

        let blocker_following = client.get_following(&blocker, &0, &50);
        prop_assert!(!blocker_following.contains(blocked_user),
            "Blocker should not be following blocked user");

        let blocker_followers = client.get_followers(&blocker, &0, &50);
        prop_assert!(!blocker_followers.contains(blocked_user),
            "Blocked user should not be in blocker's followers");

        for (i, user) in users.iter().enumerate() {
            if i != block_index {
                prop_assert!(blocker_following.contains(user),
                    "Non-blocked user should still be followed");
            }
        }
    }
}
