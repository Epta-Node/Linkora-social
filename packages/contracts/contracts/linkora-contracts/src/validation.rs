use alloc::format;
use soroban_sdk::{Address, BytesN, Env, String, Vec};

use crate::{GovParameter, ReportStatus};

pub const MAX_NAME_LEN: u32 = 50;
pub const MAX_CONTENT_LEN: u32 = 2_000;
pub const MAX_PROTOCOL_AMOUNT: i128 = 1_000_000_000_000_000_000_000_000_000_000_000_000;
pub const MAX_FEE_BPS: u32 = 10_000;
pub const MAX_QUORUM: u32 = 100;
const ZERO_ACCOUNT_ADDRESS: &str = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const ZERO_CONTRACT_ADDRESS: &str = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

#[macro_export]
macro_rules! require_with_error {
    ($env:expr, $cond:expr, $msg:expr) => {{
        if !($cond) {
            let _ = &$env;
            panic!("{}", $msg);
        }
    }};
}

fn is_zero_address(env: &Env, address: &Address) -> bool {
    let zero_account = Address::from_str(env, ZERO_ACCOUNT_ADDRESS);
    let zero_contract = Address::from_str(env, ZERO_CONTRACT_ADDRESS);
    address == &zero_account || address == &zero_contract
}

pub fn validate_non_default_address(env: &Env, label: &str, address: &Address) {
    require_with_error!(
        env,
        !is_zero_address(env, address),
        format!("{label} must not be the zero address")
    );
}

pub fn validate_address_list(env: &Env, label: &str, addresses: &Vec<Address>) {
    for (idx, address) in addresses.iter().enumerate() {
        require_with_error!(
            env,
            !is_zero_address(env, &address),
            format!("{label}[{idx}] must not be the zero address")
        );
    }
}

fn validate_string_max_len(env: &Env, label: &str, value: &String, max: u32) {
    require_with_error!(
        env,
        value.len() <= max,
        format!("{label} must be at most {max} characters")
    );
}

pub fn validate_username(env: &Env, username: &String) {
    validate_string_max_len(env, "username", username, MAX_NAME_LEN);
}

pub fn validate_content(env: &Env, content: &String) {
    validate_string_max_len(env, "content", content, MAX_CONTENT_LEN);
}

pub fn validate_amount(env: &Env, label: &str, amount: i128) {
    require_with_error!(
        env,
        amount > 0 && amount <= MAX_PROTOCOL_AMOUNT,
        format!("{label} must be positive and at most {MAX_PROTOCOL_AMOUNT}")
    );
}

pub fn validate_u32_range(env: &Env, label: &str, value: u32, min: u32, max: u32) {
    require_with_error!(
        env,
        value >= min && value <= max,
        format!("{label} must be between {min} and {max}")
    );
}

pub fn validate_protocol_fee(env: &Env, fee_bps: u32) {
    validate_u32_range(env, "fee_bps", fee_bps, 0, MAX_FEE_BPS);
}

/// Exhaustiveness guard for `GovParameter` variants.
///
/// This is a compile-time check: if a new variant is added to `GovParameter`,
/// the match will become non-exhaustive and fail to compile, forcing the
/// developer to handle it. No runtime validation is performed here — actual
/// value validation happens in `gov_propose` via `validate_u32_range`.
pub fn validate_gov_parameter(env: &Env, parameter: &GovParameter) {
    match parameter {
        GovParameter::FeeBps
        | GovParameter::Treasury
        | GovParameter::TipCooldownWindow
        | GovParameter::GovQuorum
        | GovParameter::GovTimeLock
        | GovParameter::GovVoteWindow
        | GovParameter::ModerationSlashBps => {}
    }
    let _ = env;
}

/// Reject the obviously-invalid all-zero signature before it ever reaches the
/// crypto host function, so a missing/uninitialized signature fails with a
/// descriptive message rather than an opaque crypto error.
pub fn validate_signature(env: &Env, label: &str, signature: &BytesN<64>) {
    let zero = BytesN::from_array(env, &[0u8; 64]);
    require_with_error!(
        env,
        signature != &zero,
        format!("{label} must not be an all-zero signature")
    );
}

pub fn validate_report_verdict(env: &Env, verdict: &ReportStatus) {
    require_with_error!(
        env,
        !matches!(verdict, ReportStatus::Pending),
        "verdict must be upheld or dismissed"
    );
}
