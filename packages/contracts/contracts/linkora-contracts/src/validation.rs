use alloc::format;
use soroban_sdk::{Address, BytesN, Env, String, Vec};

use crate::{GovParameter, ReportStatus};

pub const MAX_NAME_LEN: u32 = 32;
pub const MIN_NAME_LEN: u32 = 3;
pub const MAX_BIO_LEN: u32 = 500;
pub const MAX_CONTENT_LEN: u32 = 280;
pub const MAX_PROTOCOL_AMOUNT: i128 = 1_000_000_000_000_000_000_000_000_000_000_000_000;
pub const MAX_FEE_BPS: u32 = 10_000;
pub const MAX_QUORUM: u32 = 100;
const ZERO_ACCOUNT_ADDRESS: &str = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const ZERO_CONTRACT_ADDRESS: &str = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";

// Reserved usernames that cannot be claimed
const RESERVED_WORDS: &[&str] = &[
    "admin",
    "system",
    "moderator",
    "bot",
    "root",
    "support",
    "help",
    "feedback",
    "contact",
    "info",
    "status",
    "health",
    "api",
    "app",
    "web",
    "mobile",
    "linkora",
];

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

/// Ensures no duplicate addresses appear in the list. Duplicate signers could
/// let a subset of admins exceed the M-of-N threshold weight.
pub fn validate_unique_signers(env: &Env, label: &str, addresses: &Vec<Address>) {
    for i in 0..addresses.len() {
        for j in (i + 1)..addresses.len() {
            require_with_error!(
                env,
                addresses.get_unchecked(i) != addresses.get_unchecked(j),
                format!("{label} must not contain duplicate addresses")
            );
        }
    }
}

fn validate_string_max_len(env: &Env, label: &str, value: &String, max: u32) {
    require_with_error!(
        env,
        value.len() <= max,
        format!("{label} must be at most {max} characters")
    );
}

/// Validates a username against the contract's naming rules.
///
/// A valid username must:
/// - Be at least `MIN_NAME_LEN` (3) characters long
/// - Be at most `MAX_NAME_LEN` (32) characters long
/// - Start with a letter (a–z, A–Z)
/// - Contain only alphanumeric characters (a–z, A–Z, 0–9) and underscores (`_`)
/// - Not be a reserved word (e.g., "admin", "system", "moderator")
///
/// # Panics
///
/// Panics with a descriptive error message on the first violated rule.
pub fn validate_username(env: &Env, username: &String) {
    // Check minimum length
    require_with_error!(
        env,
        username.len() >= MIN_NAME_LEN,
        format!("username must be at least {MIN_NAME_LEN} characters")
    );

    // Check maximum length
    validate_string_max_len(env, "username", username, MAX_NAME_LEN);

    // Check that first character is a letter
    let username_bytes = username.to_bytes();
    if let Some(first_byte) = username_bytes.first() {
        require_with_error!(
            env,
            first_byte.is_ascii_alphabetic(),
            "username must start with a letter"
        );
    }

    // Check for alphanumeric and underscore only
    for byte in username_bytes.iter() {
        let is_valid = byte.is_ascii_lowercase()
            || byte.is_ascii_uppercase()
            || byte.is_ascii_digit()
            || byte == b'_';

        require_with_error!(
            env,
            is_valid,
            "username can only contain alphanumeric characters and underscores"
        );
    }

    // Check for reserved words (case-insensitive). Usernames are ASCII-only
    // (enforced above), so a byte-wise ASCII lowercase is sufficient here.
    let mut lower = [0u8; MAX_NAME_LEN as usize];
    let len = username_bytes.len() as usize;
    username_bytes.copy_into_slice(&mut lower[..len]);
    for b in lower[..len].iter_mut() {
        b.make_ascii_lowercase();
    }
    for reserved in RESERVED_WORDS.iter() {
        require_with_error!(
            env,
            &lower[..len] != reserved.as_bytes(),
            format!("username '{reserved}' is reserved and cannot be used")
        );
    }
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
        signature != &zero && signature.to_array().len() == 64,
        format!("{label} must not be an all-zero or malformed signature")
    );
}

pub fn validate_pubkey_32(env: &Env, label: &str, pubkey: &BytesN<32>) {
    let zero = BytesN::from_array(env, &[0u8; 32]);
    require_with_error!(
        env,
        pubkey != &zero && pubkey.to_array().len() == 32,
        format!("{label} must not be an all-zero or malformed public key")
    );
}

pub fn validate_report_verdict(env: &Env, verdict: &ReportStatus) {
    require_with_error!(
        env,
        !matches!(verdict, ReportStatus::Pending),
        "verdict must be upheld or dismissed"
    );
}

/// Rejects a report where the reporter is also the post author, preventing
/// self-reporting from being used to bury one's own content.
pub fn validate_reporter_can_report(env: &Env, reporter: &Address, author: &Address) {
    require_with_error!(env, reporter != author, "cannot report own post");
}
