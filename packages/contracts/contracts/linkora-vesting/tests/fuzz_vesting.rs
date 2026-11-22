//! Property tests for the time-based vesting arithmetic, both on the pure
//! `vested_amount` function and end-to-end through the contract.

use linkora_vesting::{vested_amount, LinkoraVesting, LinkoraVestingClient, MAX_DURATION_SECONDS};
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env,
};

/// Reference result computed with exact wide arithmetic. Only valid while
/// `total * elapsed` fits in u128, which the strategies below guarantee.
fn reference(total: i128, cliff: u64, duration: u64, elapsed: u64) -> i128 {
    if elapsed < cliff {
        0
    } else if elapsed >= duration {
        total
    } else {
        ((total as u128) * (elapsed as u128) / (duration as u128)) as i128
    }
}

/// (cliff, duration) with cliff <= duration.
fn schedule() -> impl Strategy<Value = (u64, u64)> {
    (1u64..=MAX_DURATION_SECONDS).prop_flat_map(|duration| (0u64..=duration, Just(duration)))
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(512))]

    #[test]
    fn prop_matches_exact_formula(
        total in 0i128..=(u64::MAX as i128),
        (cliff, duration) in schedule(),
        elapsed in 0u64..=(2 * MAX_DURATION_SECONDS),
        start in 0u64..=4_000_000_000,
    ) {
        let got = vested_amount(total, start, cliff, duration, start + elapsed);
        prop_assert_eq!(got, reference(total, cliff, duration, elapsed));
    }

    #[test]
    fn prop_bounded_and_monotonic(
        total in 0i128..=i128::MAX,
        (cliff, duration) in schedule(),
        a in 0u64..=(2 * MAX_DURATION_SECONDS),
        b in 0u64..=(2 * MAX_DURATION_SECONDS),
    ) {
        let (t1, t2) = if a <= b { (a, b) } else { (b, a) };
        let v1 = vested_amount(total, 0, cliff, duration, t1);
        let v2 = vested_amount(total, 0, cliff, duration, t2);
        prop_assert!(v1 >= 0 && v2 <= total, "out of range: {} {}", v1, v2);
        prop_assert!(v1 <= v2, "not monotonic: v({})={} > v({})={}", t1, v1, t2, v2);
    }

    #[test]
    fn prop_cliff_and_end_are_exact(
        total in 0i128..=i128::MAX,
        (cliff, duration) in schedule(),
        before in 1u64..=1_000_000,
        after in 0u64..=1_000_000,
    ) {
        if cliff > 0 {
            let t = cliff.saturating_sub(before);
            if t < cliff {
                prop_assert_eq!(vested_amount(total, 0, cliff, duration, t), 0);
            }
        }
        prop_assert_eq!(vested_amount(total, 0, cliff, duration, duration + after), total);
    }
}

// ── Contract-level properties ────────────────────────────────────────────────

const START: u64 = 1_700_000_000;

struct World<'a> {
    env: Env,
    client: LinkoraVestingClient<'a>,
    treasury: Address,
    beneficiary: Address,
    token: TokenClient<'a>,
}

fn world<'a>() -> World<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(START);
    let client = LinkoraVestingClient::new(&env, &env.register(LinkoraVesting, ()));
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let token_id = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    StellarAssetClient::new(&env, &token_id).mint(&admin, &i128::MAX);
    client.initialize(&admin, &treasury);
    let token = TokenClient::new(&env, &token_id);
    World {
        env,
        client,
        treasury,
        beneficiary,
        token,
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    /// Claiming at arbitrary times always pays exactly what has vested by
    /// then, and never more than the total.
    #[test]
    fn prop_claims_track_vested_amount(
        total in 1i128..=1_000_000_000_000_000,
        (cliff, duration) in (1u64..=10 * 365 * 86_400)
            .prop_flat_map(|d| (0u64..=d, Just(d))),
        steps in prop::collection::vec(0u64..=400 * 86_400, 1..8),
    ) {
        let w = world();
        let id = w.client.create_vest(&w.beneficiary, &w.token.address, &total, &cliff, &duration);

        let mut now = START;
        let mut claimed = 0i128;
        for step in steps {
            now += step;
            w.env.ledger().set_timestamp(now);
            let vested = vested_amount(total, START, cliff, duration, now);
            prop_assert_eq!(w.client.get_vested_amount(&id), vested);
            prop_assert_eq!(w.client.get_claimable_amount(&id), vested - claimed);
            if vested > claimed {
                prop_assert_eq!(w.client.claim(&id), vested - claimed);
                claimed = vested;
            }
            prop_assert_eq!(w.token.balance(&w.beneficiary), claimed);
            prop_assert!(claimed <= total);
        }
    }

    /// Revoking at any time splits the total exactly: what vested goes (now or
    /// later) to the beneficiary, the rest to the treasury, nothing is left in
    /// the contract and nothing is created.
    #[test]
    fn prop_revoke_conserves_tokens(
        total in 1i128..=1_000_000_000_000_000,
        (cliff, duration) in (1u64..=10 * 365 * 86_400)
            .prop_flat_map(|d| (0u64..=d, Just(d))),
        claim_at in 0u64..=(20 * 365 * 86_400),
        revoke_after in 0u64..=(20 * 365 * 86_400),
        late in 0u64..=(20 * 365 * 86_400),
    ) {
        let w = world();
        let id = w.client.create_vest(&w.beneficiary, &w.token.address, &total, &cliff, &duration);

        w.env.ledger().set_timestamp(START + claim_at);
        if w.client.get_claimable_amount(&id) > 0 {
            w.client.claim(&id);
        }

        let revoke_time = START + claim_at + revoke_after;
        w.env.ledger().set_timestamp(revoke_time);
        let vested_at_revoke = vested_amount(total, START, cliff, duration, revoke_time);
        let returned = w.client.revoke(&id);
        prop_assert_eq!(returned, total - vested_at_revoke);

        w.env.ledger().set_timestamp(revoke_time + late);
        prop_assert_eq!(w.client.get_vested_amount(&id), vested_at_revoke);
        if w.client.get_claimable_amount(&id) > 0 {
            w.client.claim(&id);
        }

        prop_assert_eq!(w.token.balance(&w.beneficiary), vested_at_revoke);
        prop_assert_eq!(w.token.balance(&w.treasury), returned);
        prop_assert_eq!(w.token.balance(&w.client.address), 0);
    }
}
