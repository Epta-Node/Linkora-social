//! Contract-specific error codes.
//!
//! `RentError` is used by the storage-rent/TTL guard path; `ContractError`
//! enumerates every domain error (profile, post, social graph, pool,
//! governance, moderation) returned across the contract's public API.

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RentError {
    Expired = 1,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 100,
    NotInitialized = 101,
    UsernameTaken = 102,
    UsernameTooShort = 103,
    UsernameTooLong = 104,
    ContentTooLong = 105,
    ContentEmpty = 106,
    Blocked = 107,
    NotBlocked = 108,
    Unauthorized = 109,
    PostNotFound = 110,
    ProfileNotFound = 111,
    PoolNotFound = 112,
    PoolExists = 113,
    InvalidThreshold = 114,
    InsufficientSigners = 115,
    UnauthorizedSigner = 116,
    LowBalance = 117,
    WrongToken = 118,
    AlreadyPaused = 119,
    NotPaused = 120,
    ContractPaused = 121,
    AlreadyFollowing = 122,
    NotFollowing = 123,
    SelfInteractionNotAllowed = 124,
    InvalidAmount = 125,
    TipCooldownNotExpired = 126,
    InvalidCooldown = 127,
    GraphEntryExpired = 128,
    RoleRequired = 129,
    PoolAdminNotFound = 130,
    PoolAdminExists = 131,
    ProposalNotFound = 132,
    ProposalNotPassed = 133,
    TimeLockNotExpired = 134,
    QuorumNotMet = 135,
    AlreadyVoted = 136,
    ReportNotFound = 137,
    InvalidVerdict = 138,
    InvalidPostId = 139,
    ZeroAddress = 140,
    CannotRemoveLastAdmin = 141,
    CannotRemoveLastUpgrader = 142,
}
