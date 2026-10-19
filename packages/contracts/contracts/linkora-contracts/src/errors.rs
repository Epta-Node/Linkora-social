//! Contract-specific error codes.
//!
//! `RentError` is used by the storage-rent/TTL guard path; `ContractError`
//! enumerates every domain error (profile, post, social graph, pool,
//! governance, moderation) returned across the contract's public API.
//!
//! # Variant catalogue
//!
//! | Code | Variant                   | Description                                                   |
//! |------|---------------------------|---------------------------------------------------------------|
//! | 100  | AlreadyInitialized        | Contract has already been initialised; re-init rejected.      |
//! | 101  | NotInitialized            | Contract has not been initialised yet.                        |
//! | 102  | UsernameTaken             | The requested username is already claimed by another user.    |
//! | 103  | UsernameTooShort          | Username is below the minimum length (3 chars).               |
//! | 104  | UsernameTooLong           | Username exceeds the maximum length (32 chars).               |
//! | 105  | ContentTooLong            | Post content exceeds the 280-character limit.                 |
//! | 106  | ContentEmpty              | Post content must not be empty.                               |
//! | 107  | Blocked                   | Operation rejected because one party has blocked the other.   |
//! | 108  | NotBlocked                | Attempted to unblock a user that was never blocked.           |
//! | 109  | Unauthorized              | Generic catch-all: caller lacks permission for the operation. |
//! | 110  | PostNotFound              | No post exists with the supplied ID.                          |
//! | 111  | ProfileNotFound           | No profile exists for the supplied address.                   |
//! | 112  | PoolNotFound              | No pool exists with the supplied symbol.                      |
//! | 113  | PoolExists                | A pool with that symbol already exists.                       |
//! | 114  | InvalidThreshold          | M-of-N threshold is 0 or exceeds the admin count.             |
//! | 115  | InsufficientSigners       | Fewer valid signers than the required M-of-N threshold.       |
//! | 116  | UnauthorizedSigner        | A signer address is not in the pool's admin set.              |
//! | 117  | LowBalance                | Pool balance is below the requested withdrawal amount.        |
//! | 118  | WrongToken                | Token address does not match the pool's registered token.     |
//! | 119  | AlreadyPaused             | Module (or contract) is already paused.                       |
//! | 120  | NotPaused                 | Module (or contract) is not currently paused.                 |
//! | 121  | ContractPaused            | The module this entry-point belongs to is paused.             |
//! | 122  | AlreadyFollowing          | Caller already follows the target; duplicate follow rejected. |
//! | 123  | NotFollowing              | Unfollow rejected because the follow edge does not exist.     |
//! | 124  | SelfInteractionNotAllowed | Follow/tip/like of one's own content is not permitted.        |
//! | 125  | InvalidAmount             | Amount is zero, negative, or exceeds the protocol maximum.    |
//! | 126  | TipCooldownActive         | The per-tipper tip cooldown window is still active.           |
//! | 127  | InvalidCooldown           | Cooldown window length is out of the permitted range.         |
//! | 128  | GraphEntryExpired         | Follow-graph entry has expired; caller must pay rent first.   |
//! | 129  | UnauthorizedRole          | Caller does not hold the role required for this operation.    |
//! | 130  | PoolAdminNotFound         | The address to remove is not in the pool's admin set.         |
//! | 131  | PoolAdminExists           | The address to add is already in the pool's admin set.        |
//! | 132  | ProposalNotFound          | No governance proposal exists with the supplied ID.           |
//! | 133  | ProposalExpired           | The proposal's vote window has closed; it cannot be voted on. |
//! | 134  | TimeLockNotExpired        | Governance time-lock has not elapsed; execution rejected.     |
//! | 135  | QuorumNotMet              | Approval percentage did not reach the required quorum.        |
//! | 136  | AlreadyVoted              | Caller has already cast a vote on this proposal.              |
//! | 137  | ReportNotFound            | No moderation report exists for this (post, reporter) pair.   |
//! | 138  | InvalidVerdict            | Moderation verdict must be Upheld or Dismissed, not Pending.  |
//! | 139  | InvalidPostId             | Post ID is 0 or otherwise out of the valid range.             |
//! | 140  | ZeroAddress               | Supplied address is the all-zeros sentinel address.           |
//! | 141  | CannotRemoveLastAdmin     | Removing this admin would leave the contract without any.     |
//! | 142  | CannotRemoveLastUpgrader  | Removing this upgrader would leave the contract without any.  |
//! | 143  | MathOverflow              | An arithmetic operation overflowed the i128/u32 bounds.       |

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
    /// Fewer valid signers were supplied than the pool's M-of-N threshold
    /// requires. Clients should surface this as a distinct "not enough
    /// signers" message rather than a generic auth failure.
    InsufficientSigners = 115,
    /// A supplied signer address is not a member of the pool's admin set.
    /// Distinct from `InsufficientSigners` so clients can tell the user
    /// *which* signer was wrong rather than just *how many* are missing.
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
    /// The per-tipper tip cooldown window is still active; the caller must
    /// wait before tipping the same post again. Replaces the previous
    /// opaque `TipCooldownNotExpired` name for clarity.
    TipCooldownActive = 126,
    InvalidCooldown = 127,
    GraphEntryExpired = 128,
    /// Caller does not hold the role required for this entry-point
    /// (e.g. Admin, Moderator, Pauser, Upgrader). Replaces the previous
    /// generic `RoleRequired` name so SDK consumers can distinguish a
    /// missing-role failure from a generic `Unauthorized` (109).
    UnauthorizedRole = 129,
    PoolAdminNotFound = 130,
    PoolAdminExists = 131,
    ProposalNotFound = 132,
    /// The proposal's vote window has closed; it can no longer be voted
    /// on or executed. Previously named `ProposalNotPassed` (which was
    /// ambiguous — a proposal could also fail quorum after the window).
    ProposalExpired = 133,
    TimeLockNotExpired = 134,
    QuorumNotMet = 135,
    AlreadyVoted = 136,
    ReportNotFound = 137,
    InvalidVerdict = 138,
    InvalidPostId = 139,
    ZeroAddress = 140,
    CannotRemoveLastAdmin = 141,
    CannotRemoveLastUpgrader = 142,
    MathOverflow = 143,
}
