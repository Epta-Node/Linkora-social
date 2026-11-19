#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    events::Event as _,
    testutils::{Address as _, Events, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env,
};

const START: u64 = 1_700_000_000;
const DAY: u64 = 86_400;

struct Setup<'a> {
    env: Env,
    client: LinkoraVestingClient<'a>,
    admin: Address,
    treasury: Address,
    beneficiary: Address,
    token: Address,
}

fn setup<'a>() -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(START);

    let contract_id = env.register(LinkoraVesting, ());
    let client = LinkoraVestingClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let beneficiary = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin)
        .address();
    StellarAssetClient::new(&env, &token).mint(&admin, &1_000_000_000);

    client.initialize(&admin, &treasury);
    Setup {
        env,
        client,
        admin,
        treasury,
        beneficiary,
        token,
    }
}

fn set_time(env: &Env, t: u64) {
    env.ledger().set_timestamp(t);
}

fn balance(env: &Env, token: &Address, who: &Address) -> i128 {
    TokenClient::new(env, token).balance(who)
}

// ── create_vest ───────────────────────────────────────────────────────────────

#[test]
fn test_create_vest_locks_tokens_and_records_schedule() {
    let s = setup();
    let id = s
        .client
        .create_vest(&s.beneficiary, &s.token, &1_000, &(30 * DAY), &(365 * DAY));

    assert_eq!(id, 1);
    assert_eq!(s.client.get_vest_count(), 1);
    assert_eq!(balance(&s.env, &s.token, &s.client.address), 1_000);
    assert_eq!(balance(&s.env, &s.token, &s.admin), 1_000_000_000 - 1_000);

    let vest = s.client.get_vest(&id).unwrap();
    assert_eq!(
        vest,
        Vest {
            id,
            beneficiary: s.beneficiary.clone(),
            token: s.token.clone(),
            total_amount: 1_000,
            claimed_amount: 0,
            start_time: START,
            cliff_seconds: 30 * DAY,
            duration_seconds: 365 * DAY,
            revoked_at: None,
        }
    );
    assert_eq!(
        s.client.get_vests_of(&s.beneficiary),
        soroban_sdk::vec![&s.env, id]
    );
}

#[test]
fn test_create_vest_emits_vest_created() {
    let s = setup();
    let id = s
        .client
        .create_vest(&s.beneficiary, &s.token, &500, &DAY, &(10 * DAY));
    let expected = VestCreatedEvent {
        version: EVENT_VERSION,
        vest_id: id,
        beneficiary: s.beneficiary.clone(),
        token: s.token.clone(),
        total_amount: 500,
        start_time: START,
        cliff_seconds: DAY,
        duration_seconds: 10 * DAY,
    }
    .to_xdr(&s.env, &s.client.address);
    assert!(s.env.events().all().events().contains(&expected));
}

#[test]
fn test_create_vest_requires_admin_auth() {
    let s = setup();
    s.client
        .create_vest(&s.beneficiary, &s.token, &100, &0, &DAY);
    let auths = s.env.auths();
    assert_eq!(auths[0].0, s.admin);
}

#[test]
fn test_create_vest_rejects_bad_input() {
    let s = setup();
    let c = &s.client;
    let b = &s.beneficiary;
    let t = &s.token;

    assert_eq!(
        c.try_create_vest(b, t, &0, &0, &DAY),
        Err(Ok(VestingError::InvalidAmount.into()))
    );
    assert_eq!(
        c.try_create_vest(b, t, &-5, &0, &DAY),
        Err(Ok(VestingError::InvalidAmount.into()))
    );
    assert_eq!(
        c.try_create_vest(b, t, &100, &0, &0),
        Err(Ok(VestingError::InvalidSchedule.into()))
    );
    assert_eq!(
        c.try_create_vest(b, t, &100, &(2 * DAY), &DAY),
        Err(Ok(VestingError::InvalidSchedule.into()))
    );
    assert_eq!(
        c.try_create_vest(b, t, &100, &0, &(MAX_DURATION_SECONDS + 1)),
        Err(Ok(VestingError::InvalidSchedule.into()))
    );
    // Nothing was created or transferred.
    assert_eq!(c.get_vest_count(), 0);
    assert_eq!(balance(&s.env, t, &c.address), 0);
}

#[test]
fn test_initialize_twice_fails() {
    let s = setup();
    assert_eq!(
        s.client.try_initialize(&s.admin, &s.treasury),
        Err(Ok(VestingError::AlreadyInitialized.into()))
    );
}

#[test]
fn test_create_vest_before_initialize_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let client = LinkoraVestingClient::new(&env, &env.register(LinkoraVesting, ()));
    let who = Address::generate(&env);
    assert_eq!(
        client.try_create_vest(&who, &who, &1, &0, &1),
        Err(Ok(VestingError::NotInitialized.into()))
    );
}

#[test]
fn test_beneficiary_vest_limit() {
    let s = setup();
    for _ in 0..MAX_VESTS_PER_BENEFICIARY {
        s.client.create_vest(&s.beneficiary, &s.token, &1, &0, &1);
    }
    assert_eq!(
        s.client
            .try_create_vest(&s.beneficiary, &s.token, &1, &0, &1),
        Err(Ok(VestingError::TooManyVests.into()))
    );
}

// ── Cliff ─────────────────────────────────────────────────────────────────────

#[test]
fn test_no_claim_before_cliff() {
    let s = setup();
    let id = s
        .client
        .create_vest(&s.beneficiary, &s.token, &1_000, &(30 * DAY), &(100 * DAY));

    for t in [START, START + 1, START + 29 * DAY, START + 30 * DAY - 1] {
        set_time(&s.env, t);
        assert_eq!(s.client.get_vested_amount(&id), 0);
        assert_eq!(s.client.get_claimable_amount(&id), 0);
        assert_eq!(
            s.client.try_claim(&id),
            Err(Ok(VestingError::NothingToClaim.into()))
        );
    }
    assert_eq!(balance(&s.env, &s.token, &s.beneficiary), 0);
}

#[test]
fn test_cliff_releases_the_linear_amount_accrued_since_start() {
    let s = setup();
    let id = s
        .client
        .create_vest(&s.beneficiary, &s.token, &1_000, &(30 * DAY), &(100 * DAY));

    // At the cliff, 30 of 100 days have elapsed: 30% has vested at once.
    set_time(&s.env, START + 30 * DAY);
    assert_eq!(s.client.get_vested_amount(&id), 300);
    assert_eq!(s.client.claim(&id), 300);
    assert_eq!(balance(&s.env, &s.token, &s.beneficiary), 300);
}

// ── Linear unlock ─────────────────────────────────────────────────────────────

#[test]
fn test_linear_unlock_without_cliff() {
    let s = setup();
    let id = s
        .client
        .create_vest(&s.beneficiary, &s.token, &1_000, &0, &(4 * DAY));

    let expect = [
        (0, 0),
        (DAY, 250),
        (2 * DAY, 500),
        (3 * DAY, 750),
        (4 * DAY, 1_000),
    ];
    for (dt, vested) in expect {
        set_time(&s.env, START + dt);
        assert_eq!(s.client.get_vested_amount(&id), vested, "at +{dt}s");
    }
}

#[test]
fn test_linear_unlock_rounds_down() {
    let s = setup();
    // 10 tokens over 3 seconds: 3.33…, 6.66…, then all 10.
    let id = s.client.create_vest(&s.beneficiary, &s.token, &10, &0, &3);
    set_time(&s.env, START + 1);
    assert_eq!(s.client.get_vested_amount(&id), 3);
    set_time(&s.env, START + 2);
    assert_eq!(s.client.get_vested_amount(&id), 6);
    set_time(&s.env, START + 3);
    assert_eq!(s.client.get_vested_amount(&id), 10);
}

#[test]
fn test_partial_claims_add_up_to_total() {
    let s = setup();
    let id = s
        .client
        .create_vest(&s.beneficiary, &s.token, &1_000, &DAY, &(10 * DAY));

    set_time(&s.env, START + 2 * DAY);
    assert_eq!(s.client.claim(&id), 200);
    // Claiming again at the same time has nothing new to pay.
    assert_eq!(
        s.client.try_claim(&id),
        Err(Ok(VestingError::NothingToClaim.into()))
    );

    set_time(&s.env, START + 7 * DAY);
    assert_eq!(s.client.claim(&id), 500);
    assert_eq!(s.client.get_vest(&id).unwrap().claimed_amount, 700);

    set_time(&s.env, START + 50 * DAY);
    assert_eq!(s.client.get_vested_amount(&id), 1_000);
    assert_eq!(s.client.claim(&id), 300);

    assert_eq!(balance(&s.env, &s.token, &s.beneficiary), 1_000);
    assert_eq!(balance(&s.env, &s.token, &s.client.address), 0);
    assert_eq!(
        s.client.try_claim(&id),
        Err(Ok(VestingError::NothingToClaim.into()))
    );
}

#[test]
fn test_claim_emits_tokens_claimed() {
    let s = setup();
    let id = s
        .client
        .create_vest(&s.beneficiary, &s.token, &100, &0, &10);
    set_time(&s.env, START + 4);
    s.client.claim(&id);
    let expected = TokensClaimedEvent {
        version: EVENT_VERSION,
        vest_id: id,
        beneficiary: s.beneficiary.clone(),
        amount: 40,
        total_claimed: 40,
    }
    .to_xdr(&s.env, &s.client.address);
    assert!(s.env.events().all().events().contains(&expected));
}

#[test]
fn test_claim_requires_beneficiary_auth() {
    let s = setup();
    let id = s
        .client
        .create_vest(&s.beneficiary, &s.token, &100, &0, &10);
    set_time(&s.env, START + 10);
    s.client.claim(&id);
    let auths = s.env.auths();
    assert_eq!(auths[0].0, s.beneficiary);
}

#[test]
#[should_panic]
fn test_claim_without_beneficiary_auth_panics() {
    let s = setup();
    let id = s
        .client
        .create_vest(&s.beneficiary, &s.token, &100, &0, &10);
    set_time(&s.env, START + 10);
    s.env.set_auths(&[]);
    s.client.claim(&id);
}

#[test]
fn test_unknown_vest() {
    let s = setup();
    assert_eq!(s.client.get_vest(&9), None);
    assert_eq!(
        s.client.try_claim(&9),
        Err(Ok(VestingError::VestNotFound.into()))
    );
    assert_eq!(
        s.client.try_revoke(&9),
        Err(Ok(VestingError::VestNotFound.into()))
    );
}

#[test]
fn test_vests_are_independent() {
    let s = setup();
    let other = Address::generate(&s.env);
    let a = s
        .client
        .create_vest(&s.beneficiary, &s.token, &100, &0, &10);
    let b = s.client.create_vest(&other, &s.token, &1_000, &0, &100);
    let c = s.client.create_vest(&s.beneficiary, &s.token, &50, &0, &5);

    set_time(&s.env, START + 5);
    assert_eq!(s.client.claim(&a), 50);
    assert_eq!(s.client.claim(&b), 50);
    assert_eq!(s.client.claim(&c), 50);
    assert_eq!(
        s.client.get_vests_of(&s.beneficiary),
        soroban_sdk::vec![&s.env, a, c]
    );
    assert_eq!(s.client.get_vests_of(&other), soroban_sdk::vec![&s.env, b]);
}

// ── Revocation ────────────────────────────────────────────────────────────────

#[test]
fn test_revoke_returns_unvested_to_treasury() {
    let s = setup();
    let id = s
        .client
        .create_vest(&s.beneficiary, &s.token, &1_000, &DAY, &(10 * DAY));

    set_time(&s.env, START + 4 * DAY);
    assert_eq!(s.client.revoke(&id), 600);
    assert_eq!(balance(&s.env, &s.token, &s.treasury), 600);
    assert_eq!(balance(&s.env, &s.token, &s.client.address), 400);

    let vest = s.client.get_vest(&id).unwrap();
    assert_eq!(vest.revoked_at, Some(START + 4 * DAY));
}

#[test]
fn test_vested_tokens_stay_claimable_after_revoke() {
    let s = setup();
    let id = s
        .client
        .create_vest(&s.beneficiary, &s.token, &1_000, &DAY, &(10 * DAY));

    set_time(&s.env, START + 2 * DAY);
    assert_eq!(s.client.claim(&id), 200);
    set_time(&s.env, START + 4 * DAY);
    assert_eq!(s.client.revoke(&id), 600);

    // Vesting stopped at the revocation: later time adds nothing.
    set_time(&s.env, START + 100 * DAY);
    assert_eq!(s.client.get_vested_amount(&id), 400);
    assert_eq!(s.client.claim(&id), 200);
    assert_eq!(
        s.client.try_claim(&id),
        Err(Ok(VestingError::NothingToClaim.into()))
    );

    // Every token ends up with exactly one party.
    assert_eq!(balance(&s.env, &s.token, &s.beneficiary), 400);
    assert_eq!(balance(&s.env, &s.token, &s.treasury), 600);
    assert_eq!(balance(&s.env, &s.token, &s.client.address), 0);
}

#[test]
fn test_revoke_before_cliff_returns_everything() {
    let s = setup();
    let id = s
        .client
        .create_vest(&s.beneficiary, &s.token, &1_000, &(30 * DAY), &(100 * DAY));
    set_time(&s.env, START + 29 * DAY);
    assert_eq!(s.client.revoke(&id), 1_000);
    set_time(&s.env, START + 200 * DAY);
    assert_eq!(s.client.get_claimable_amount(&id), 0);
}

#[test]
fn test_revoke_after_full_vesting_returns_nothing() {
    let s = setup();
    let id = s
        .client
        .create_vest(&s.beneficiary, &s.token, &1_000, &0, &DAY);
    set_time(&s.env, START + 2 * DAY);
    assert_eq!(s.client.revoke(&id), 0);
    assert_eq!(balance(&s.env, &s.token, &s.treasury), 0);
    assert_eq!(s.client.claim(&id), 1_000);
}

#[test]
fn test_revoke_twice_fails() {
    let s = setup();
    let id = s
        .client
        .create_vest(&s.beneficiary, &s.token, &1_000, &0, &DAY);
    s.client.revoke(&id);
    assert_eq!(
        s.client.try_revoke(&id),
        Err(Ok(VestingError::AlreadyRevoked.into()))
    );
}

#[test]
fn test_revoke_emits_vest_revoked() {
    let s = setup();
    let id = s
        .client
        .create_vest(&s.beneficiary, &s.token, &100, &0, &10);
    set_time(&s.env, START + 3);
    s.client.revoke(&id);
    let expected = VestRevokedEvent {
        version: EVENT_VERSION,
        vest_id: id,
        beneficiary: s.beneficiary.clone(),
        returned_amount: 70,
        vested_amount: 30,
    }
    .to_xdr(&s.env, &s.client.address);
    assert!(s.env.events().all().events().contains(&expected));
}

#[test]
fn test_revoke_requires_admin_auth() {
    let s = setup();
    let id = s
        .client
        .create_vest(&s.beneficiary, &s.token, &100, &0, &10);
    s.client.revoke(&id);
    assert_eq!(s.env.auths()[0].0, s.admin);
}

#[test]
fn test_set_treasury_redirects_revoked_tokens() {
    let s = setup();
    let new_treasury = Address::generate(&s.env);
    s.client.set_treasury(&new_treasury);
    assert_eq!(s.client.get_treasury(), Some(new_treasury.clone()));
    assert_eq!(s.client.get_admin(), Some(s.admin.clone()));

    let id = s
        .client
        .create_vest(&s.beneficiary, &s.token, &100, &0, &10);
    s.client.revoke(&id);
    assert_eq!(balance(&s.env, &s.token, &new_treasury), 100);
    assert_eq!(balance(&s.env, &s.token, &s.treasury), 0);
}

// ── Pure arithmetic ───────────────────────────────────────────────────────────

#[test]
fn test_vested_amount_handles_huge_totals_without_overflow() {
    // total * elapsed would overflow i128 here.
    let total = i128::MAX;
    let duration = MAX_DURATION_SECONDS;
    let half = vested_amount(total, 0, 0, duration, duration / 2);
    assert_eq!(half, i128::MAX / 2);
    assert_eq!(vested_amount(total, 0, 0, duration, duration), total);
    assert!(vested_amount(total, 0, 0, duration, duration - 1) < total);
}

#[test]
fn test_vested_amount_start_in_the_future() {
    // A clock before the start (cannot happen on-chain, but must not underflow).
    assert_eq!(vested_amount(100, 1_000, 0, 10, 999), 0);
}
