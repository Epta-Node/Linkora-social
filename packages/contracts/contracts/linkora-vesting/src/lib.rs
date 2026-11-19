#![no_std]
//! `LinkoraVesting` — token vesting for creator grant distribution.
//!
//! The admin locks `total_amount` of a token for a beneficiary. Nothing can be
//! claimed before the cliff; after that the vested amount grows linearly from
//! the vest's start until `start + duration`, when everything is vested:
//!
//! ```text
//! vested(t) = 0                                   if t < start + cliff
//!           = total * (t - start) / duration      if start + cliff <= t < start + duration
//!           = total                               if t >= start + duration
//! ```
//!
//! Revoking a vest freezes the vested amount at the revocation time: the
//! beneficiary can still claim whatever had vested, and the unvested rest goes
//! back to the treasury straight away.

mod math;
mod test;

pub use math::vested_amount;

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error,
    symbol_short, token, Address, Env, Symbol, Vec,
};

// ── Storage ───────────────────────────────────────────────────────────────────

const ADMIN: Symbol = symbol_short!("ADMIN");
const TREASURY: Symbol = symbol_short!("TREASURY");
const VEST_COUNT: Symbol = symbol_short!("VEST_CT");

const EVENT_VERSION: u32 = 1;
const LEDGER_BUMP: u32 = 535_000;
const LEDGER_THRESHOLD: u32 = 535_000 - 100;

/// Longest supported vesting schedule: 100 years. Bounding the duration keeps
/// the linear-unlock arithmetic exact and overflow-free (see `math.rs`).
pub const MAX_DURATION_SECONDS: u64 = 100 * 365 * 24 * 60 * 60;

/// Most vests listed for one beneficiary, so `get_vests_of` stays bounded.
pub const MAX_VESTS_PER_BENEFICIARY: u32 = 50;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// vest id -> Vest
    Vest(u64),
    /// beneficiary -> Vec<u64> of their vest ids
    VestsOf(Address),
}

/// A vesting schedule. Times are ledger timestamps (seconds).
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Vest {
    pub id: u64,
    pub beneficiary: Address,
    pub token: Address,
    pub total_amount: i128,
    pub claimed_amount: i128,
    pub start_time: u64,
    pub cliff_seconds: u64,
    pub duration_seconds: u64,
    /// Set when the admin revokes the vest; vesting stops at this time.
    pub revoked_at: Option<u64>,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VestingError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    InvalidSchedule = 4,
    VestNotFound = 5,
    NothingToClaim = 6,
    AlreadyRevoked = 7,
    TooManyVests = 8,
}

// ── Events ────────────────────────────────────────────────────────────────────

#[contractevent(topics = ["vest_created"])]
#[derive(Clone)]
pub struct VestCreatedEvent {
    #[topic]
    pub version: u32,
    #[topic]
    pub vest_id: u64,
    #[topic]
    pub beneficiary: Address,
    pub token: Address,
    pub total_amount: i128,
    pub start_time: u64,
    pub cliff_seconds: u64,
    pub duration_seconds: u64,
}

#[contractevent(topics = ["tokens_claimed"])]
#[derive(Clone)]
pub struct TokensClaimedEvent {
    #[topic]
    pub version: u32,
    #[topic]
    pub vest_id: u64,
    #[topic]
    pub beneficiary: Address,
    pub amount: i128,
    pub total_claimed: i128,
}

#[contractevent(topics = ["vest_revoked"])]
#[derive(Clone)]
pub struct VestRevokedEvent {
    #[topic]
    pub version: u32,
    #[topic]
    pub vest_id: u64,
    #[topic]
    pub beneficiary: Address,
    /// Unvested tokens returned to the treasury.
    pub returned_amount: i128,
    /// Tokens that had vested and stay claimable by the beneficiary.
    pub vested_amount: i128,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct LinkoraVesting;

#[contractimpl]
impl LinkoraVesting {
    /// One-time setup. `treasury` receives unvested tokens when a vest is revoked.
    pub fn initialize(env: Env, admin: Address, treasury: Address) {
        if env.storage().instance().has(&ADMIN) {
            panic_with_error!(&env, VestingError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&TREASURY, &treasury);
        bump_instance(&env);
    }

    /// Lock `total_amount` of `token` for `beneficiary`, vesting linearly over
    /// `duration_seconds` from now with nothing claimable before
    /// `cliff_seconds`. The admin funds the vest in the same call. Returns the
    /// new vest id.
    pub fn create_vest(
        env: Env,
        beneficiary: Address,
        token: Address,
        total_amount: i128,
        cliff_seconds: u64,
        duration_seconds: u64,
    ) -> u64 {
        let admin = require_admin(&env);
        if total_amount <= 0 {
            panic_with_error!(&env, VestingError::InvalidAmount);
        }
        if duration_seconds == 0
            || duration_seconds > MAX_DURATION_SECONDS
            || cliff_seconds > duration_seconds
        {
            panic_with_error!(&env, VestingError::InvalidSchedule);
        }

        let list_key = DataKey::VestsOf(beneficiary.clone());
        let mut vests_of: Vec<u64> = env
            .storage()
            .persistent()
            .get(&list_key)
            .unwrap_or_else(|| Vec::new(&env));
        if vests_of.len() >= MAX_VESTS_PER_BENEFICIARY {
            panic_with_error!(&env, VestingError::TooManyVests);
        }

        token::Client::new(&env, &token).transfer(
            &admin,
            env.current_contract_address(),
            &total_amount,
        );

        let id: u64 = env.storage().instance().get(&VEST_COUNT).unwrap_or(0u64) + 1;
        env.storage().instance().set(&VEST_COUNT, &id);

        let start_time = env.ledger().timestamp();
        let vest = Vest {
            id,
            beneficiary: beneficiary.clone(),
            token: token.clone(),
            total_amount,
            claimed_amount: 0,
            start_time,
            cliff_seconds,
            duration_seconds,
            revoked_at: None,
        };
        save_vest(&env, &vest);

        vests_of.push_back(id);
        env.storage().persistent().set(&list_key, &vests_of);
        bump(&env, &list_key);
        bump_instance(&env);

        VestCreatedEvent {
            version: EVENT_VERSION,
            vest_id: id,
            beneficiary,
            token,
            total_amount,
            start_time,
            cliff_seconds,
            duration_seconds,
        }
        .publish(&env);

        id
    }

    /// Transfer everything that has vested and not been claimed yet to the
    /// vest's beneficiary, who must authorize the call. Returns the amount paid.
    pub fn claim(env: Env, vest_id: u64) -> i128 {
        let mut vest = load_vest(&env, vest_id);
        vest.beneficiary.require_auth();

        let amount = claimable(&env, &vest);
        if amount <= 0 {
            panic_with_error!(&env, VestingError::NothingToClaim);
        }

        vest.claimed_amount += amount;
        save_vest(&env, &vest);
        bump_instance(&env);

        token::Client::new(&env, &vest.token).transfer(
            &env.current_contract_address(),
            &vest.beneficiary,
            &amount,
        );

        TokensClaimedEvent {
            version: EVENT_VERSION,
            vest_id,
            beneficiary: vest.beneficiary.clone(),
            amount,
            total_claimed: vest.claimed_amount,
        }
        .publish(&env);

        amount
    }

    /// Stop a vest. Tokens vested so far stay claimable by the beneficiary;
    /// the unvested rest is returned to the treasury. Returns that amount.
    pub fn revoke(env: Env, vest_id: u64) -> i128 {
        require_admin(&env);
        let mut vest = load_vest(&env, vest_id);
        if vest.revoked_at.is_some() {
            panic_with_error!(&env, VestingError::AlreadyRevoked);
        }

        let now = env.ledger().timestamp();
        let vested = vested_at(&vest, now);
        let returned_amount = vest.total_amount - vested;
        vest.revoked_at = Some(now);
        save_vest(&env, &vest);
        bump_instance(&env);

        if returned_amount > 0 {
            let treasury: Address = env.storage().instance().get(&TREASURY).unwrap();
            token::Client::new(&env, &vest.token).transfer(
                &env.current_contract_address(),
                &treasury,
                &returned_amount,
            );
        }

        VestRevokedEvent {
            version: EVENT_VERSION,
            vest_id,
            beneficiary: vest.beneficiary,
            returned_amount,
            vested_amount: vested,
        }
        .publish(&env);

        returned_amount
    }

    /// Change where revoked tokens are sent.
    pub fn set_treasury(env: Env, treasury: Address) {
        require_admin(&env);
        env.storage().instance().set(&TREASURY, &treasury);
        bump_instance(&env);
    }

    pub fn get_vest(env: Env, vest_id: u64) -> Option<Vest> {
        env.storage().persistent().get(&DataKey::Vest(vest_id))
    }

    /// Ids of every vest created for `beneficiary`, oldest first.
    pub fn get_vests_of(env: Env, beneficiary: Address) -> Vec<u64> {
        env.storage()
            .persistent()
            .get(&DataKey::VestsOf(beneficiary))
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Total vested so far (claimed or not), frozen at the revocation time for
    /// a revoked vest.
    pub fn get_vested_amount(env: Env, vest_id: u64) -> i128 {
        let vest = load_vest(&env, vest_id);
        vested_at(&vest, env.ledger().timestamp())
    }

    /// What `claim` would pay right now.
    pub fn get_claimable_amount(env: Env, vest_id: u64) -> i128 {
        let vest = load_vest(&env, vest_id);
        claimable(&env, &vest)
    }

    pub fn get_vest_count(env: Env) -> u64 {
        env.storage().instance().get(&VEST_COUNT).unwrap_or(0u64)
    }

    pub fn get_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&ADMIN)
    }

    pub fn get_treasury(env: Env) -> Option<Address> {
        env.storage().instance().get(&TREASURY)
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn require_admin(env: &Env) -> Address {
    let admin: Address = env
        .storage()
        .instance()
        .get(&ADMIN)
        .unwrap_or_else(|| panic_with_error!(env, VestingError::NotInitialized));
    admin.require_auth();
    admin
}

fn load_vest(env: &Env, vest_id: u64) -> Vest {
    let key = DataKey::Vest(vest_id);
    let vest: Vest = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| panic_with_error!(env, VestingError::VestNotFound));
    bump(env, &key);
    vest
}

fn save_vest(env: &Env, vest: &Vest) {
    let key = DataKey::Vest(vest.id);
    env.storage().persistent().set(&key, vest);
    bump(env, &key);
}

/// Vested amount at `now`, never past the revocation time.
fn vested_at(vest: &Vest, now: u64) -> i128 {
    let at = match vest.revoked_at {
        Some(revoked_at) => now.min(revoked_at),
        None => now,
    };
    vested_amount(
        vest.total_amount,
        vest.start_time,
        vest.cliff_seconds,
        vest.duration_seconds,
        at,
    )
}

fn claimable(env: &Env, vest: &Vest) -> i128 {
    vested_at(vest, env.ledger().timestamp()) - vest.claimed_amount
}

fn bump(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, LEDGER_THRESHOLD, LEDGER_BUMP);
}

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
}
