#![cfg(test)]

//! Property-based fuzz targets for the rent payment state machine (issue #1691).
//!
//! Two invariants are checked:
//!
//! 1. **Expiry monotonicity** — `get_rent_expiry(user)` never decreases unless
//!    there is an explicit payment; after each successful `pay_rent`, the new
//!    expiry is strictly greater than the previous one.
//!
//! 2. **Payment monotonicity** — The ledger extension produced by `pay_rent`
//!    always increases monotonically with the `amount` parameter when all
//!    other factors (token decimals, rent rate) remain constant.

use linkora_contracts::{LinkoraContract, LinkoraContractClient};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::Address as _,
    token::StellarAssetClient,
    Address, Env, String as SdkString,
};

// ── helpers ───────────────────────────────────────────────────────────────────

fn setup(env: &Env) -> (LinkoraContractClient<'_>, Address) {
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    client.initialize(&admin, &treasury, &0);
    (client, admin)
}

fn setup_token(env: &Env, minter: &Address) -> Address {
    let token_id = env.register_stellar_asset_contract_v2(minter.clone());
    token_id.address()
}

fn set_profile(env: &Env, client: &LinkoraContractClient, user: &Address, username: &str) {
    let creator_token = setup_token(env, user);
    StellarAssetClient::new(env, &creator_token).mint(user, &1_000_000_000);
    client.set_profile(user, &SdkString::from_str(env, username), &creator_token);
}

// ── fuzz targets ──────────────────────────────────────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    /// Invariant: `get_rent_expiry` never decreases without a `pay_rent` call,
    /// and each successful payment strictly increases the expiry.
    ///
    /// The test reads expiry before payment, pays rent, reads expiry again,
    /// and asserts the new expiry is strictly greater than the old one.
    #[test]
    fn prop_pay_rent_increases_expiry_monotonically(
        amounts in prop::collection::vec(1_000_000i128..10_000_000, 1..6),
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _admin) = setup(&env);

        let user = Address::generate(&env);
        set_profile(&env, &client, &user, "alice");

        let token = client.get_profile(&user).unwrap().creator_token;

        let mut prev_expiry = client.get_rent_expiry(&user);

        for &amount in &amounts {
            StellarAssetClient::new(&env, &token).mint(&user, &amount);
            client.pay_rent(&user, &token, &amount);

            let new_expiry = client.get_rent_expiry(&user);
            prop_assert!(
                new_expiry > prev_expiry,
                "expiry must increase after payment: prev={}, new={}",
                prev_expiry, new_expiry
            );
            prev_expiry = new_expiry;

            // Advance ledger slightly to ensure multiple payments don't
            // collide on the same ledger sequence.
            env.ledger().with_mut(|l| l.sequence_number += 1);
        }
    }

    /// Invariant: ledger extension is monotonic in `amount` — paying more
    /// always extends expiry by at least as many ledgers as paying less,
    /// assuming constant rent rate and token decimals.
    #[test]
    fn prop_larger_payment_extends_longer(
        amount_1 in 1_000_000i128..5_000_000,
        amount_2 in 5_000_001i128..10_000_000,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _admin) = setup(&env);

        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);
        set_profile(&env, &client, &user1, "user1");
        set_profile(&env, &client, &user2, "user2");

        let token1 = client.get_profile(&user1).unwrap().creator_token;
        let token2 = client.get_profile(&user2).unwrap().creator_token;

        let expiry1_before = client.get_rent_expiry(&user1);
        StellarAssetClient::new(&env, &token1).mint(&user1, &amount_1);
        client.pay_rent(&user1, &token1, &amount_1);
        let expiry1_after = client.get_rent_expiry(&user1);
        let extension1 = expiry1_after - expiry1_before;

        let expiry2_before = client.get_rent_expiry(&user2);
        StellarAssetClient::new(&env, &token2).mint(&user2, &amount_2);
        client.pay_rent(&user2, &token2, &amount_2);
        let expiry2_after = client.get_rent_expiry(&user2);
        let extension2 = expiry2_after - expiry2_before;

        prop_assert!(
            extension2 >= extension1,
            "larger payment must extend expiry by at least as much: ext1={}, ext2={}",
            extension1, extension2
        );
    }

    /// Invariant: expiry does not increase if the payment amount is rejected
    /// as being too small (falls below the minimum ledger extension threshold).
    ///
    /// The contract rejects payments that produce `ledgers_to_extend == 0`.
    /// This test verifies that a failed payment leaves the expiry unchanged.
    #[test]
    fn prop_tiny_payment_rejected_leaves_expiry_unchanged(
        tiny_amount in 1i128..100,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let (client, _admin) = setup(&env);

        let user = Address::generate(&env);
        set_profile(&env, &client, &user, "testuser");

        let token = client.get_profile(&user).unwrap().creator_token;
        let expiry_before = client.get_rent_expiry(&user);

        // Attempt a payment so small that `ledgers_to_extend` is zero. Must fail.
        StellarAssetClient::new(&env, &token).mint(&user, &tiny_amount);
        let result = client.try_pay_rent(&user, &token, &tiny_amount);
        prop_assert!(
            result.is_err(),
            "payment too small to produce any extension must be rejected"
        );

        let expiry_after = client.get_rent_expiry(&user);
        prop_assert_eq!(
            expiry_before,
            expiry_after,
            "expiry must not change after a rejected payment"
        );
    }
}
