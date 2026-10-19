// Issue #1676: Rent grace period before content is archived
//
// After expiry, provides a grace period during which the user can still renew
// at a penalty before cleanup eligibility.

use crate::*;

// Grace period in ledgers (default ~7 days at 5s/ledger)
const DEFAULT_GRACE_PERIOD_LEDGERS: u32 = 120_960;
const GRACE_PERIOD_KEY: Symbol = symbol_short!("GR_PER");

// Penalty for renewal during grace period (default 10% = 1000 bps)
const DEFAULT_GRACE_PENALTY_BPS: u32 = 1000;
const GRACE_PENALTY_KEY: Symbol = symbol_short!("GR_PEN");

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum RentStatus {
    Active,
    Expired,
    InGrace,
    Archived,
}

impl LinkoraContract {
    /// Get detailed rent status with grace period awareness
    pub fn get_rent_status(env: Env, user: Address) -> RentStatus {
        validate_non_default_address(&env, "user", &user);

        let expiry_key = StorageKey::RentExpiry(user.clone());
        let expiry_ledger: u32 = env
            .storage()
            .persistent()
            .get(&expiry_key)
            .unwrap_or(0);

        let current_ledger = env.ledger().sequence();

        if current_ledger < expiry_ledger {
            // Not expired
            return RentStatus::Active;
        }

        // Expired, check if in grace period
        let grace_period: u32 = env
            .storage()
            .instance()
            .get(&GRACE_PERIOD_KEY)
            .unwrap_or(DEFAULT_GRACE_PERIOD_LEDGERS);

        let grace_end = expiry_ledger + grace_period;

        if current_ledger < grace_end {
            // In grace period
            return RentStatus::InGrace;
        }

        // Grace period expired, eligible for cleanup
        RentStatus::Archived
    }

    /// Enhanced pay_rent that applies penalty during grace period
    pub fn pay_rent_with_grace(
        env: Env,
        user: Address,
        token: Address,
        amount: i128,
    ) -> i128 {
        Self::bump_instance(&env);
        user.require_auth();
        validate_non_default_address(&env, "user", &user);
        validate_non_default_address(&env, "token", &token);
        validate_amount(&env, amount);

        // Check rent status
        let status = Self::get_rent_status(env.clone(), user.clone());

        // Calculate actual amount after potential penalty
        let actual_amount = if status == RentStatus::InGrace {
            // Apply grace period penalty
            let penalty_bps: u32 = env
                .storage()
                .instance()
                .get(&GRACE_PENALTY_KEY)
                .unwrap_or(DEFAULT_GRACE_PENALTY_BPS);

            // Calculate penalty: amount * penalty_bps / 10000
            let penalty = (amount * i128::from(penalty_bps)) / 10_000;
            amount + penalty
        } else if status == RentStatus::Archived {
            panic!("content archived, cannot renew");
        } else {
            amount
        };

        // Verify user has sufficient balance for penalty
        let token_client = token::Client::new(&env, &token);
        let balance = token_client.balance(&user);
        if balance < actual_amount {
            panic!("insufficient balance for rent with penalty");
        }

        // Transfer to treasury
        let treasury: Address = env
            .storage()
            .instance()
            .get(&TREASURY)
            .expect("treasury not set");

        token_client.transfer(&user, &treasury, &actual_amount);

        // Calculate ledger extension
        let profile = Self::get_profile(env.clone(), user.clone())
            .expect("profile not found");
        
        if profile.creator_token != token {
            panic!("token must match profile creator token");
        }

        let decimals = token_client.decimals();
        let normalized = amount * 10i128.pow(7 - decimals);

        let rent_rate_bps: u32 = env
            .storage()
            .instance()
            .get(&RENT_RATE_BPS_KEY)
            .unwrap_or(100);

        let ledgers_to_extend = (normalized * i128::from(rent_rate_bps)) / 10_000;

        if ledgers_to_extend <= 0 {
            panic!("amount too small for rent rate");
        }

        // Update expiry
        let expiry_key = StorageKey::RentExpiry(user.clone());
        let current_expiry: u32 = env
            .storage()
            .persistent()
            .get(&expiry_key)
            .unwrap_or(env.ledger().sequence());

        let new_expiry = if status == RentStatus::InGrace {
            // Reset from current ledger if in grace
            env.ledger().sequence() + ledgers_to_extend as u32
        } else {
            // Extend from current expiry
            current_expiry + ledgers_to_extend as u32
        };

        env.storage().persistent().set(&expiry_key, &new_expiry);
        Self::bump(&env, &expiry_key);

        actual_amount
    }

    /// Admin function to configure grace period
    pub fn set_grace_period(env: Env, admin: Address, grace_period_ledgers: u32) {
        Self::require_admin(&env, &admin);
        admin.require_auth();
        env.storage()
            .instance()
            .set(&GRACE_PERIOD_KEY, &grace_period_ledgers);
    }

    /// Admin function to configure grace period penalty
    pub fn set_grace_penalty(env: Env, admin: Address, penalty_bps: u32) {
        Self::require_admin(&env, &admin);
        admin.require_auth();
        if penalty_bps > MAX_FEE_BPS {
            panic!("penalty exceeds maximum");
        }
        env.storage()
            .instance()
            .set(&GRACE_PENALTY_KEY, &penalty_bps);
    }

    /// Get current grace period configuration
    pub fn get_grace_period(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&GRACE_PERIOD_KEY)
            .unwrap_or(DEFAULT_GRACE_PERIOD_LEDGERS)
    }

    /// Get current grace penalty configuration
    pub fn get_grace_penalty(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&GRACE_PENALTY_KEY)
            .unwrap_or(DEFAULT_GRACE_PENALTY_BPS)
    }
}

// Add to StorageKey enum:
// RentExpiry(Address), // persistent: user -> u32 expiry ledger
