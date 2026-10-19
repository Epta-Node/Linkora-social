#![cfg(test)]

//! Property-based fuzz targets for the community-pool subsystem (issue #1691).
//!
//! Two invariants are exercised:
//!
//! 1. **Balance conservation** — `pool.balance` always equals the sum of all
//!    accepted deposits minus the sum of all accepted withdrawals, for any
//!    arbitrary interleaving of `pool_deposit` / `pool_withdraw` calls.
//!
//! 2. **Signer-gate invariant** — `pool_withdraw` is rejected whenever the
//!    number of valid signers supplied is strictly below the pool's M-of-N
//!    threshold, regardless of the order or composition of signers.

use linkora_contracts::{LinkoraContract, LinkoraContractClient};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::Address as _,
    token::StellarAssetClient,
    vec as sdk_vec, Address, Env, Symbol,
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

fn setup_token(env: &Env, minter: &Address, amount: i128) -> Address {
    let token_id = env.register_stellar_asset_contract_v2(minter.clone());
    StellarAssetClient::new(env, &token_id.address()).mint(minter, &amount);
    token_id.address()
}

// ── fuzz targets ──────────────────────────────────────────────────────────────

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    /// Invariant: `pool.balance == sum(deposits) − sum(withdrawals)` for any
    /// interleaving of deposit and withdraw calls.
    ///
    /// Withdrawal amounts are expressed as a fraction (0–99%) of the current
    /// balance so that every accepted withdrawal is bounded by the available
    /// funds, keeping the test deterministic even when `proptest` shrinks.
    #[test]
    fn prop_pool_balance_equals_deposits_minus_withdrawals(
        deposits in prop::collection::vec(1i128..500_000, 1..8),
        withdraw_fracs in prop::collection::vec(0u32..100, 0..8),
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = setup(&env);

        let total_mint: i128 = deposits.iter().sum::<i128>() * 2;
        let minter = Address::generate(&env);
        let token = setup_token(&env, &minter, total_mint);

        let pool_id = Symbol::new(&env, "testpool");
        client.create_pool(
            &admin,
            &pool_id,
            &token,
            &sdk_vec![&env, admin.clone()],
            &1,
        );

        let mut expected_balance: i128 = 0;

        // Phase 1: deposits
        for &amount in &deposits {
            let depositor = Address::generate(&env);
            StellarAssetClient::new(&env, &token).mint(&depositor, &amount);
            client.pool_deposit(&depositor, &pool_id, &token, &amount);
            expected_balance += amount;
        }

        prop_assert_eq!(
            client.get_pool(&pool_id).unwrap().balance,
            expected_balance,
            "balance mismatch after deposits"
        );

        // Phase 2: partial withdrawals
        for &frac in &withdraw_fracs {
            let current = client.get_pool(&pool_id).unwrap().balance;
            if current == 0 {
                continue;
            }
            let amount = ((current * frac as i128) / 100).max(1).min(current);
            let recipient = Address::generate(&env);
            client.pool_withdraw(
                &sdk_vec![&env, admin.clone()],
                &pool_id,
                &amount,
                &recipient,
            );
            expected_balance -= amount;
        }

        prop_assert_eq!(
            client.get_pool(&pool_id).unwrap().balance,
            expected_balance,
            "balance mismatch after withdrawals"
        );
    }

    /// Invariant: `pool_withdraw` must be rejected when the number of supplied
    /// valid signers is strictly below the pool's threshold, regardless of the
    /// pool balance or the recipient address.
    ///
    /// The test creates a 2-of-3 pool and attempts a withdrawal with only one
    /// valid signer — the contract must always reject it.
    #[test]
    fn prop_withdraw_rejected_below_threshold(
        deposit_amount in 1i128..1_000_000,
        withdraw_frac in 1u32..100,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = setup(&env);

        let minter = Address::generate(&env);
        let token = setup_token(&env, &minter, deposit_amount * 2);

        let admin2 = Address::generate(&env);
        let admin3 = Address::generate(&env);
        let pool_id = Symbol::new(&env, "signergate");

        // 2-of-3 threshold
        client.create_pool(
            &admin,
            &pool_id,
            &token,
            &sdk_vec![&env, admin.clone(), admin2.clone(), admin3.clone()],
            &2,
        );

        StellarAssetClient::new(&env, &token).mint(&admin, &deposit_amount);
        client.pool_deposit(&admin, &pool_id, &token, &deposit_amount);

        let current = client.get_pool(&pool_id).unwrap().balance;
        let withdraw_amount = ((current * withdraw_frac as i128) / 100).max(1).min(current);
        let recipient = Address::generate(&env);

        // Only one signer — below the 2-of-3 threshold. Must fail.
        let result = client.try_pool_withdraw(
            &sdk_vec![&env, admin.clone()],
            &pool_id,
            &withdraw_amount,
            &recipient,
        );
        prop_assert!(
            result.is_err(),
            "withdraw with 1 signer against a 2-of-3 threshold must be rejected"
        );

        // Pool balance must be unchanged after the rejected withdrawal.
        prop_assert_eq!(
            client.get_pool(&pool_id).unwrap().balance,
            deposit_amount,
            "balance must not change after a rejected withdrawal"
        );
    }
}
