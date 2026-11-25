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
    /// A social-graph entry's TTL lapsed before the operation could bump it.
    /// The caller must pay rent or re-create the edge before retrying.
    Expired = 1,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    /// `initialize` was called after the `INIT` instance flag was set.
    AlreadyInitialized = 100,
    /// An admin-only operation ran before `initialize` set the contract state.
    NotInitialized = 101,
    /// `set_profile` used a username already owned by another address.
    UsernameTaken = 102,
    /// A username shorter than the three-character minimum was supplied.
    UsernameTooShort = 103,
    /// A username longer than the 32-character maximum was supplied.
    UsernameTooLong = 104,
    /// `create_post` or an edit supplied content longer than 280 characters.
    ContentTooLong = 105,
    /// `create_post` or an edit supplied empty content.
    ContentEmpty = 106,
    /// A follow, tip, like, or message was attempted across an existing block edge.
    Blocked = 107,
    /// `unblock_user` was called when the blocker-to-target edge did not exist.
    NotBlocked = 108,
    /// The caller lacks the generic permission required by the entry point.
    Unauthorized = 109,
    /// A post lookup used an ID with no `Post` record in storage.
    PostNotFound = 110,
    /// A profile lookup used an address with no `Profile` record in storage.
    ProfileNotFound = 111,
    /// A pool operation used a symbol with no `Pool` record in storage.
    PoolNotFound = 112,
    /// `create_pool` used a symbol that already has a `Pool` record.
    PoolExists = 113,
    /// A pool threshold was zero or greater than the number of pool admins.
    InvalidThreshold = 114,
    /// Fewer valid signers were supplied than the pool's M-of-N threshold requires.
    /// Clients should surface this as a distinct "not enough signers" message
    /// rather than a generic auth failure.
    InsufficientSigners = 115,
    /// A supplied signer address is not a member of the pool's admin set.
    /// Distinct from `InsufficientSigners` so clients can tell the user
    /// *which* signer was wrong rather than just *how many* are missing.
    UnauthorizedSigner = 116,
    /// A pool withdrawal exceeded the pool's available token balance.
    LowBalance = 117,
    /// A pool operation used a token address different from the pool's token.
    WrongToken = 118,
    /// A pause call targeted a module that was already paused.
    AlreadyPaused = 119,
    /// An unpause call targeted a module that was not paused.
    NotPaused = 120,
    /// The entry point's module is currently paused, so the call was rejected.
    ContractPaused = 121,
    /// A follow was attempted for an edge that already exists.
    AlreadyFollowing = 122,
    /// An unfollow was attempted for an edge that does not exist.
    NotFollowing = 123,
    /// A follow, tip, or like targeted the caller's own address or post.
    SelfInteractionNotAllowed = 124,
    /// A tip amount was zero, negative, or above `MAX_PROTOCOL_AMOUNT`.
    InvalidAmount = 125,
    /// The per-tipper tip cooldown window is still active; the caller must
    /// wait before tipping the same post again. Replaces the previous
    /// opaque `TipCooldownNotExpired` name for clarity.
    TipCooldownActive = 126,
    /// A governance or protocol cooldown was zero or outside its allowed range.
    InvalidCooldown = 127,
    /// A graph entry expired before its TTL could be bumped during traversal.
    GraphEntryExpired = 128,
    /// Caller does not hold the role required for this entry-point
    /// (e.g. Admin, Moderator, Pauser, Upgrader). Replaces the previous
    /// generic `RoleRequired` name so SDK consumers can distinguish a
    /// missing-role failure from a generic `Unauthorized` (109).
    UnauthorizedRole = 129,
    /// `remove_pool_admin` targeted an address absent from the pool's admin set.
    PoolAdminNotFound = 130,
    /// `add_pool_admin` targeted an address already in the pool's admin set.
    PoolAdminExists = 131,
    /// A governance call referenced a proposal ID with no stored proposal.
    ProposalNotFound = 132,
    /// The proposal's vote window has closed; it can no longer be voted
    /// on or executed. Previously named `ProposalNotPassed` (which was
    /// ambiguous — a proposal could also fail quorum after the window).
    ProposalExpired = 133,
    /// `gov_execute` ran before the vote window plus time-lock elapsed.
    TimeLockNotExpired = 134,
    /// `gov_execute` found an approval percentage below the effective quorum.
    QuorumNotMet = 135,
    /// `gov_vote` was called by an address that already voted on the proposal.
    AlreadyVoted = 136,
    /// A moderation action referenced a post/reporter pair with no report.
    ReportNotFound = 137,
    /// `resolve_report` used a pending or otherwise unsupported verdict value.
    InvalidVerdict = 138,
    /// A post-related call supplied ID `0` or an otherwise invalid post ID.
    InvalidPostId = 139,
    /// A validation helper received the all-zero account or contract address.
    ZeroAddress = 140,
    /// `revoke_role` would have removed the last remaining Admin.
    CannotRemoveLastAdmin = 141,
    /// `revoke_role` would have removed the last remaining Upgrader.
    CannotRemoveLastUpgrader = 142,
    /// An arithmetic operation overflowed an `i128`/`u32` protocol bound.
    MathOverflow = 143,
}
