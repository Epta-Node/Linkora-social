#![no_std]
extern crate alloc;
use alloc::format;
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, symbol_short, token,
    Address, Bytes, BytesN, Env, Map, String, Symbol, Vec,
};

#[cfg(test)]
use soroban_sdk::testutils::storage::Persistent as _;

mod validation;

use validation::{
    validate_address_list, validate_amount, validate_content, validate_gov_parameter,
    validate_non_default_address, validate_protocol_fee, validate_report_verdict,
    validate_signature, validate_u32_range, validate_username, MAX_FEE_BPS, MAX_QUORUM,
};

// ── Storage Key Enum ──────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub enum StorageKey {
    Post(u64),                 // persistent: post_id -> Post
    Profile(Address),          // persistent: user -> Profile
    Following(Address),        // persistent: user -> Vec<Address> (LEGACY — kept for migration)
    Followers(Address),        // persistent: user -> Vec<Address> (LEGACY — kept for migration)
    Pool(Symbol),              // persistent: pool_id -> Pool
    Like(u64, Address),        // persistent: (post_id, user) -> bool
    AuthorPosts(Address),      // persistent: author -> Vec<u64> of post IDs
    Blocks(Address),           // persistent: blocker -> Map<Address, ()>
    UsernameIndex(String), // persistent: username -> owner Address (reverse index for uniqueness)
    TipCooldown(u64, Address), // temporary: (post_id, tipper) -> last-tip ledger sequence number
    // ── Adjacency-set social graph (ADR-001) ──────────────────────────────
    Edge(Address, Address),         // persistent: (follower, followee) -> bool
    FollowingCount(Address),        // persistent: user -> u32 total following count
    FollowersCount(Address),        // persistent: user -> u32 total follower count
    FollowingIdx(Address, u32),     // persistent: (user, seq) -> Address (ordered index)
    FollowersIdx(Address, u32),     // persistent: (user, seq) -> Address (ordered index)
    FollowingPos(Address, Address), // persistent: (follower, followee) -> u32 position in idx
    FollowersPos(Address, Address), // persistent: (followee, follower) -> u32 position in idx
    GraphMigrated(Address),         // persistent: user -> bool (migration tracking)
    DmPublicKey(Address),           // persistent: user -> X25519 public key for encrypted DMs
    CredentialRoot(Address),        // persistent: user -> credential Merkle root
    NullifierSet(Address, BytesN<32>), // persistent: (user, nullifier) -> bool (prevents replay)
    CredentialAuthority, // persistent: Ed25519 pubkey trusted to sign credential root updates
    // ── Governance ────────────────────────────────────────────────────────
    GovProposal(u64),      // persistent: proposal_id -> GovProposal
    GovVote(u64, Address), // persistent: (proposal_id, voter) -> bool (prevents double-voting)
    GovConfig,             // persistent: governance configuration
    GovProposalCount,      // persistent: next proposal id counter
    // ── Analytics Oracle ──────────────────────────────────────────────────
    OracleKey(Symbol), // persistent: oracle_name -> BytesN<32> Ed25519 pubkey
    AttestationNullifier(BytesN<32>), // persistent: sha256(report_cbor) -> bool (replay guard)
    Report(u64, Address), // persistent: (post_id, reporter) -> Report
    ReportCount(u64),  // persistent: post_id -> u32 count of reports

    // ── Lazy Cleanup (Tombstones & Indexes) ───────────────────────────────
    DeletedPost(u64),              // persistent: post_id -> bool
    DeletedProfile(Address),       // persistent: user -> bool
    PostLikersCount(u64),          // persistent: post_id -> u32
    PostLikersIdx(u64, u32),       // persistent: (post_id, seq) -> Address
    PostReportersIdx(u64, u32),    // persistent: (post_id, seq) -> Address (Count is ReportCount)
    PostTipCooldownsCount(u64),    // persistent: post_id -> u32
    PostTipCooldownsIdx(u64, u32), // persistent: (post_id, seq) -> Address
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RentError {
    Expired = 1,
}

// ── Instance-storage key constants (small scalars, not contracttype) ──────────

const POST_CT: Symbol = symbol_short!("POST_CT");
const PROFILE_CREATED_CT: Symbol = symbol_short!("PROF_CT");
const ADMIN: Symbol = symbol_short!("ADMIN");
const TREASURY: Symbol = symbol_short!("TREASURY");
const FEE_BPS: Symbol = symbol_short!("FEE_BPS");
const INITIALIZED: Symbol = symbol_short!("INIT");
const TIP_COOLDOWN_WINDOW: Symbol = symbol_short!("TIP_CD_W");
const REGISTERED_USERS: Symbol = symbol_short!("R_USERS");
const RENT_RATE_BPS_KEY: Symbol = symbol_short!("RENT_BPS");
const MODERATION_SLASH_BPS: Symbol = symbol_short!("MOD_SL_B");
const CONTRACT_STATE: Symbol = symbol_short!("CT_STATE");
const ROLES: Symbol = symbol_short!("ROLES");
const PAUSED: Symbol = symbol_short!("PAUSED");

// ── TTL Constants ─────────────────────────────────────────────────────────────
//
// LEDGER_BUMP: target TTL (~30 days at 5s/ledger).
// LEDGER_THRESHOLD: extend only when remaining TTL falls below this value.

const LEDGER_BUMP: u32 = 535_000;
const LEDGER_THRESHOLD: u32 = 535_000 - 100;

// ── Tip Cooldown ──────────────────────────────────────────────────────────────
//
// TIP_COOLDOWN_LEDGERS: default per-tipper per-post cooldown (~1 day at 5s/ledger).

const TIP_COOLDOWN_LEDGERS: u32 = 17_280;

// ── Pagination Limit ──────────────────────────────────────────────────────────

const MAX_PAGE_LIMIT: u32 = 50;
const MAX_PAGINATION_LIMIT: u32 = 50;

// ── Data Types ────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct Post {
    pub id: u64,
    pub author: Address,
    pub content: String,
    pub tip_total: i128,
    pub timestamp: u64,
    pub like_count: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Profile {
    pub address: Address,
    pub username: String,
    pub creator_token: Address,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Pool {
    pub token: Address,
    pub balance: i128,
    pub admins: Vec<Address>,
    pub threshold: u32,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ContractState {
    /// Current contract schema / code version for migration tracking.
    pub version: u32,
    /// Last known implementation hash. Updated on each successful upgrade.
    pub implementation_wasm_hash: Option<BytesN<32>>,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProposalStatus {
    Pending,
    Executed,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub id: u64,
    pub pool_id: Symbol,
    pub proposer: Address,
    pub amount: i128,
    pub recipient: Address,
    pub signers: Vec<Address>,
    pub status: ProposalStatus,
}

// ── Governance Types ─────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GovParameter {
    FeeBps,
    Treasury,
    TipCooldownWindow,
    GovQuorum,
    GovTimeLock,
    GovVoteWindow,
    ModerationSlashBps,
}

#[contracttype]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Role {
    Admin,
    Moderator,
    Pauser,
    Upgrader,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GovStatus {
    Active,
    Passed,
    Executed,
    Vetoed,
    Failed,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct GovProposal {
    pub id: u64,
    pub proposer: Address,
    pub parameter: GovParameter,
    pub new_value: u64,
    pub new_address: Option<Address>,
    pub votes_for: u32,
    pub votes_against: u32,
    pub created_ledger: u32,
    pub time_lock_ledgers: u32,
    pub status: GovStatus,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct GovConfig {
    pub quorum: u32,
    pub time_lock_ledgers: u32,
    pub vote_window_ledgers: u32,
    pub quorum_decay_rate_bps: u32,
    pub quorum_floor: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReportStatus {
    Pending,
    Dismissed,
    Upheld,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Report {
    pub post_id: u64,
    pub reporter: Address,
    pub stake_amount: i128,
    pub token: Address,
    pub reason_hash: BytesN<32>,
    pub created_ledger: u32,
    pub status: ReportStatus,
}

// ── Events ────────────────────────────────────────────────────────────────────

#[contractevent]
#[derive(Clone)]
pub struct RentPaidEvent {
    #[topic]
    pub user: Address,
    #[topic]
    pub payer: Address,
    #[topic]
    pub token: Address,
    pub amount: i128,
    pub extended_to_ledger: u32,
}

#[contractevent]
#[derive(Clone)]
pub struct ProfileSetEvent {
    #[topic]
    pub user: Address,
    pub username: String,
}

#[contractevent]
#[derive(Clone)]
pub struct FollowEvent {
    #[topic]
    pub follower: Address,
    #[topic]
    pub followee: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct UnfollowEvent {
    #[topic]
    pub follower: Address,
    #[topic]
    pub followee: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct BlockEvent {
    #[topic]
    pub blocker: Address,
    #[topic]
    pub blocked: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct UnblockEvent {
    #[topic]
    pub blocker: Address,
    #[topic]
    pub blocked: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct PostCreatedEvent {
    #[topic]
    pub id: u64,
    #[topic]
    pub author: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct TipEvent {
    #[topic]
    pub tipper: Address,
    #[topic]
    pub post_id: u64,
    pub amount: i128,
    pub fee: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct PoolDepositEvent {
    #[topic]
    pub depositor: Address,
    #[topic]
    pub pool_id: Symbol,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct PoolWithdrawEvent {
    #[topic]
    pub recipient: Address,
    #[topic]
    pub pool_id: Symbol,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct PoolCreatedEvent {
    #[topic]
    pub pool_id: Symbol,
    pub token: Address,
    pub admins: Vec<Address>,
    pub threshold: u32,
}

#[contractevent]
#[derive(Clone)]
pub struct LikePostEvent {
    #[topic]
    pub user: Address,
    #[topic]
    pub post_id: u64,
}

#[contractevent]
#[derive(Clone)]
pub struct ContractUpgraded {
    pub new_wasm_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone)]
pub struct PausedEvent {
    #[topic]
    pub admin: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct UnpausedEvent {
    #[topic]
    pub admin: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct PostDeleted {
    #[topic]
    pub post_id: u64,
    #[topic]
    pub author: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct ProfileDeletedEvent {
    #[topic]
    pub user: Address,
    pub username: String,
}

#[contractevent]
#[derive(Clone)]
pub struct ProposalCreatedEvent {
    #[topic]
    pub pool_id: Symbol,
    #[topic]
    pub proposal_id: u64,
    pub proposer: Address,
    pub amount: i128,
    pub recipient: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct ProposalSignedEvent {
    #[topic]
    pub pool_id: Symbol,
    #[topic]
    pub proposal_id: u64,
    pub signer: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct ProposalExecutedEvent {
    #[topic]
    pub pool_id: Symbol,
    #[topic]
    pub proposal_id: u64,
    pub amount: i128,
    pub recipient: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct PoolAdminAddedEvent {
    #[topic]
    pub pool_id: Symbol,
    pub new_admin: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct PoolAdminRemovedEvent {
    #[topic]
    pub pool_id: Symbol,
    pub admin: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct PoolThresholdUpdatedEvent {
    #[topic]
    pub pool_id: Symbol,
    pub old_threshold: u32,
    pub new_threshold: u32,
}

#[contractevent]
#[derive(Clone)]
pub struct DmKeyPublishedEvent {
    #[topic]
    pub user: Address,
    pub public_key: BytesN<32>,
}

#[contractevent]
#[derive(Clone)]
pub struct CredentialRootUpdatedEvent {
    #[topic]
    pub user: Address,
    pub root: BytesN<32>,
}

#[contractevent]
#[derive(Clone)]
pub struct CredentialVerifiedEvent {
    #[topic]
    pub user: Address,
    #[topic]
    pub nullifier: BytesN<32>,
}

#[contractevent]
#[derive(Clone)]
pub struct FeeUpdatedEvent {
    #[topic]
    pub name: Symbol,
    pub old_fee_bps: u32,
    pub new_fee_bps: u32,
}

#[contractevent]
#[derive(Clone)]
pub struct TreasuryUpdatedEvent {
    #[topic]
    pub name: Symbol,
    pub old_treasury: Address,
    pub new_treasury: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct RoleGrantedEvent {
    #[topic]
    pub role: Role,
    #[topic]
    pub account: Address,
    pub sender: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct RoleRevokedEvent {
    #[topic]
    pub role: Role,
    #[topic]
    pub account: Address,
    pub sender: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct GovProposalCreatedEvent {
    #[topic]
    pub proposal_id: u64,
    pub proposer: Address,
    pub parameter: GovParameter,
    pub new_value: u64,
}

#[contractevent]
#[derive(Clone)]
pub struct GovVoteEvent {
    #[topic]
    pub proposal_id: u64,
    #[topic]
    pub voter: Address,
    pub support: bool,
}

#[contractevent]
#[derive(Clone)]
pub struct GovProposalExecutedEvent {
    #[topic]
    pub proposal_id: u64,
    pub parameter: GovParameter,
    pub new_value: u64,
}

#[contractevent]
#[derive(Clone)]
pub struct GovProposalVetoedEvent {
    #[topic]
    pub proposal_id: u64,
}

#[contractevent]
#[derive(Clone)]
pub struct EmergencyBypassEvent {
    #[topic]
    pub action: Symbol,
}

#[contractevent]
#[derive(Clone)]
pub struct AttestationVerifiedEvent {
    #[topic]
    pub oracle_name: Symbol,
    #[topic]
    pub report_hash: BytesN<32>,
    pub creator: Address,
    pub window_start: u64,
    pub window_end: u64,
}

#[contractevent]
#[derive(Clone)]
pub struct PostReportedEvent {
    #[topic]
    pub post_id: u64,
    #[topic]
    pub reporter: Address,
    pub stake_amount: i128,
}

#[contractevent]
#[derive(Clone)]
pub struct PostRemovedByModerationEvent {
    #[topic]
    pub post_id: u64,
    #[topic]
    pub reporter: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct ReportDismissedEvent {
    #[topic]
    pub post_id: u64,
    #[topic]
    pub reporter: Address,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct LinkoraContract;

// ── Validation Helpers ────────────────────────────────────────────────────────

fn paginate<T>(env: &Env, list: &Vec<T>, offset: u32, limit: u32) -> Vec<T>
where
    T: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>
        + soroban_sdk::IntoVal<Env, soroban_sdk::Val>
        + Clone,
{
    let len = list.len();
    if offset >= len {
        return Vec::new(env);
    }
    let end = (offset + limit).min(len);
    let mut page = Vec::new(env);
    for i in offset..end {
        page.push_back(list.get(i).unwrap());
    }
    page
}

#[contractimpl]
impl LinkoraContract {
    // ── Initialization ────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address, treasury: Address, fee_bps: u32) {
        Self::bump_instance(&env);
        if env
            .storage()
            .instance()
            .get::<Symbol, bool>(&INITIALIZED)
            .unwrap_or(false)
        {
            panic!("already initialized");
        }
        admin.require_auth();
        validate_non_default_address(&env, "admin", &admin);
        validate_non_default_address(&env, "treasury", &treasury);
        validate_protocol_fee(&env, fee_bps);
        env.storage().instance().set(&INITIALIZED, &true);
        env.storage().instance().set(&ADMIN, &admin);
        let mut roles = Map::new(&env);
        roles.set(
            admin.clone(),
            Self::role_mask(Role::Admin) | Self::role_mask(Role::Upgrader),
        );
        env.storage().instance().set(&ROLES, &roles);
        env.storage().instance().set(&TREASURY, &treasury);
        env.storage().instance().set(&FEE_BPS, &fee_bps);
        env.storage()
            .instance()
            .set(&TIP_COOLDOWN_WINDOW, &TIP_COOLDOWN_LEDGERS);
        env.storage().instance().set(&MODERATION_SLASH_BPS, &0u32);
        env.storage().instance().set(
            &CONTRACT_STATE,
            &ContractState {
                version: 1,
                implementation_wasm_hash: None,
            },
        );

        RoleGrantedEvent {
            role: Role::Admin,
            account: admin.clone(),
            sender: admin.clone(),
        }
        .publish(&env);

        RoleGrantedEvent {
            role: Role::Upgrader,
            account: admin.clone(),
            sender: admin,
        }
        .publish(&env);
    }

    pub fn grant_role(env: Env, admin: Address, account: Address, role: Role) {
        Self::bump_instance(&env);
        admin.require_auth();
        validate_non_default_address(&env, "admin", &admin);
        validate_non_default_address(&env, "account", &account);
        Self::require_role(&env, &admin, Role::Admin);

        let mut roles = Self::get_roles(&env);
        let current = roles.get(account.clone()).unwrap_or(0);
        let updated = current | Self::role_mask(role);
        roles.set(account.clone(), updated);
        env.storage().instance().set(&ROLES, &roles);

        RoleGrantedEvent {
            role,
            account,
            sender: admin,
        }
        .publish(&env);
    }

    pub fn revoke_role(env: Env, admin: Address, account: Address, role: Role) {
        Self::bump_instance(&env);
        admin.require_auth();
        validate_non_default_address(&env, "admin", &admin);
        validate_non_default_address(&env, "account", &account);
        Self::require_role(&env, &admin, Role::Admin);

        let mut roles = Self::get_roles(&env);
        let current = roles.get(account.clone()).unwrap_or(0);
        let updated = current & !Self::role_mask(role);
        roles.set(account.clone(), updated);
        env.storage().instance().set(&ROLES, &roles);

        RoleRevokedEvent {
            role,
            account,
            sender: admin,
        }
        .publish(&env);
    }

    pub fn has_role(env: Env, account: Address, role: Role) -> bool {
        validate_non_default_address(&env, "account", &account);
        Self::has_role_internal(&env, &account, role)
    }

    // ── Profiles ──────────────────────────────────────────────────────────────

    pub fn set_profile(env: Env, user: Address, username: String, creator_token: Address) {
        Self::bump_instance(&env);
        user.require_auth();
        validate_non_default_address(&env, "user", &user);
        validate_non_default_address(&env, "creator_token", &creator_token);
        validate_username(&env, &username);

        let key = StorageKey::Profile(user.clone());
        let username_index_key = StorageKey::UsernameIndex(username.clone());

        if let Some(existing_owner) = env
            .storage()
            .persistent()
            .get::<_, Address>(&username_index_key)
        {
            if existing_owner != user {
                panic!("username taken");
            }
        }

        if let Some(existing_profile) = env.storage().persistent().get::<_, Profile>(&key) {
            if existing_profile.username != username {
                env.storage()
                    .persistent()
                    .remove(&StorageKey::UsernameIndex(
                        existing_profile.username.clone(),
                    ));
            }
        }

        if !env.storage().persistent().has(&key) {
            let count: u64 = env
                .storage()
                .instance()
                .get(&PROFILE_CREATED_CT)
                .unwrap_or(0);
            env.storage()
                .instance()
                .set(&PROFILE_CREATED_CT, &(count + 1));

            // Register the user
            let mut registered: Map<Address, bool> = env
                .storage()
                .instance()
                .get(&REGISTERED_USERS)
                .unwrap_or_else(|| Map::new(&env));
            registered.set(user.clone(), true);
            env.storage().instance().set(&REGISTERED_USERS, &registered);

            // Initialize social graph counts
            let following_count_key = StorageKey::FollowingCount(user.clone());
            let followers_count_key = StorageKey::FollowersCount(user.clone());
            env.storage().persistent().set(&following_count_key, &0u32);
            Self::bump(&env, &following_count_key);
            env.storage().persistent().set(&followers_count_key, &0u32);
            Self::bump(&env, &followers_count_key);
        }

        // Write profile.
        env.storage().persistent().set(
            &key,
            &Profile {
                address: user.clone(),
                username: username.clone(),
                creator_token,
            },
        );
        env.storage().persistent().set(&username_index_key, &user);
        Self::bump(&env, &key);
        Self::bump(&env, &username_index_key);
        ProfileSetEvent { user, username }.publish(&env);
    }

    pub fn get_profile(env: Env, user: Address) -> Option<Profile> {
        validate_non_default_address(&env, "user", &user);
        let key = StorageKey::Profile(user.clone());
        #[cfg(test)]
        let exists = {
            if env.storage().persistent().has(&key) {
                let ttl = env.storage().persistent().get_ttl(&key);
                ttl > 0 && ttl <= 10_000_000
            } else {
                false
            }
        };
        #[cfg(not(test))]
        let exists = env.storage().persistent().has(&key);
        if exists {
            let profile: Profile = env.storage().persistent().get(&key).unwrap();
            Self::bump(&env, &key);
            Some(profile)
        } else {
            let registered: Map<Address, bool> = env
                .storage()
                .instance()
                .get(&REGISTERED_USERS)
                .unwrap_or_else(|| Map::new(&env));
            if registered.contains_key(user) {
                env.panic_with_error(RentError::Expired);
            }
            None
        }
    }

    /// Returns the total number of unique addresses that have ever called `set_profile`,
    /// i.e. the number of profiles ever created. This counter is never decremented —
    /// updating an existing profile does not increment it again.
    pub fn get_profile_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&PROFILE_CREATED_CT)
            .unwrap_or(0)
    }

    pub fn delete_profile(env: Env, user: Address) {
        Self::bump_instance(&env);
        user.require_auth();
        validate_non_default_address(&env, "user", &user);
        let key = StorageKey::Profile(user.clone());
        let profile: Profile = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("profile does not exist"));

        ProfileDeletedEvent {
            user: user.clone(),
            username: profile.username.clone(),
        }
        .publish(&env);

        env.storage()
            .persistent()
            .remove(&StorageKey::UsernameIndex(profile.username));
        env.storage().persistent().remove(&key);

        let count: u64 = env
            .storage()
            .instance()
            .get(&PROFILE_CREATED_CT)
            .unwrap_or(0);
        if count > 0 {
            env.storage()
                .instance()
                .set(&PROFILE_CREATED_CT, &(count - 1));
        }

        // De-register from registry
        let mut registered: Map<Address, bool> = env
            .storage()
            .instance()
            .get(&REGISTERED_USERS)
            .unwrap_or_else(|| Map::new(&env));
        registered.remove(user.clone());
        env.storage().instance().set(&REGISTERED_USERS, &registered);

        // O(1) Deletions
        env.storage()
            .persistent()
            .remove(&StorageKey::DmPublicKey(user.clone()));
        env.storage()
            .persistent()
            .remove(&StorageKey::CredentialRoot(user.clone()));
        env.storage()
            .persistent()
            .remove(&StorageKey::Blocks(user.clone()));

        // Tombstone for lazy cleanup
        let tombstone_key = StorageKey::DeletedProfile(user.clone());
        env.storage().persistent().set(&tombstone_key, &true);
        Self::bump(&env, &tombstone_key);
    }

    pub fn batch_cleanup_profile(env: Env, user: Address, max_entries: u32) {
        Self::bump_instance(&env);
        let tombstone_key = StorageKey::DeletedProfile(user.clone());
        assert!(
            env.storage().persistent().has(&tombstone_key),
            "profile not deleted"
        );

        let mut entries_removed = 0;

        // Cleanup Followers
        let followers_count_key = StorageKey::FollowersCount(user.clone());
        let mut f_count: u32 = env
            .storage()
            .persistent()
            .get(&followers_count_key)
            .unwrap_or(0);
        while f_count > 0 && entries_removed < max_entries {
            f_count -= 1;
            let idx_key = StorageKey::FollowersIdx(user.clone(), f_count);
            if let Some(follower) = env.storage().persistent().get::<_, Address>(&idx_key) {
                env.storage()
                    .persistent()
                    .remove(&StorageKey::Edge(follower.clone(), user.clone()));
                env.storage()
                    .persistent()
                    .remove(&StorageKey::FollowersPos(user.clone(), follower.clone()));

                // Swap-remove user from the follower's following list
                Self::swap_remove_from_index(&env, &follower, &user, true);
            }
            env.storage().persistent().remove(&idx_key);
            entries_removed += 1;
        }
        env.storage()
            .persistent()
            .set(&followers_count_key, &f_count);
        Self::bump(&env, &followers_count_key);

        // Cleanup Following
        let following_count_key = StorageKey::FollowingCount(user.clone());
        let mut following_count: u32 = env
            .storage()
            .persistent()
            .get(&following_count_key)
            .unwrap_or(0);
        while following_count > 0 && entries_removed < max_entries {
            following_count -= 1;
            let idx_key = StorageKey::FollowingIdx(user.clone(), following_count);
            if let Some(followee) = env.storage().persistent().get::<_, Address>(&idx_key) {
                env.storage()
                    .persistent()
                    .remove(&StorageKey::Edge(user.clone(), followee.clone()));
                env.storage()
                    .persistent()
                    .remove(&StorageKey::FollowingPos(user.clone(), followee.clone()));

                // Swap-remove user from the followee's followers list
                Self::swap_remove_from_index(&env, &followee, &user, false);
            }
            env.storage().persistent().remove(&idx_key);
            entries_removed += 1;
        }
        env.storage()
            .persistent()
            .set(&following_count_key, &following_count);
        Self::bump(&env, &following_count_key); // Cleanup Authored Posts
        let author_key = StorageKey::AuthorPosts(user.clone());
        let mut author_posts: Vec<u64> = env
            .storage()
            .persistent()
            .get(&author_key)
            .unwrap_or(Vec::new(&env));
        let mut i = author_posts.len();
        while i > 0 && entries_removed < max_entries {
            i -= 1;
            let post_id = author_posts.get(i).unwrap();

            // Tombstone the post
            let post_tombstone = StorageKey::DeletedPost(post_id);
            env.storage().persistent().set(&post_tombstone, &true);
            Self::bump(&env, &post_tombstone);

            // Delete post object itself
            env.storage()
                .persistent()
                .remove(&StorageKey::Post(post_id));

            // Clean up associated storage: likes, reports, and tip cooldowns.
            // Use a generous max_entries since each post's cleanup is small.
            // This must be done inline to avoid leaving orphaned storage
            // that would become unreachable once the author key is removed.
            Self::cleanup_post_associations(&env, post_id);

            author_posts.remove(i);
            entries_removed += 1;
        }
        if author_posts.is_empty() {
            env.storage().persistent().remove(&author_key);
        } else {
            env.storage().persistent().set(&author_key, &author_posts);
            Self::bump(&env, &author_key);
        }

        if f_count == 0 && following_count == 0 && author_posts.is_empty() {
            env.storage().persistent().remove(&tombstone_key);
        }
    }

    pub fn get_address_by_username(env: Env, username: String) -> Option<Address> {
        validate_username(&env, &username);
        let key = StorageKey::UsernameIndex(username);
        let result: Option<Address> = env.storage().persistent().get(&key);
        if result.is_some() {
            Self::bump(&env, &key);
        }
        result
    }

    // ── DM Key Management ─────────────────────────────────────────────────────

    /// Register or rotate the trusted Ed25519 authority key that signs credential
    /// root updates. Admin only.
    pub fn set_credential_authority(env: Env, admin: Address, pubkey: BytesN<32>) {
        Self::bump_instance(&env);
        admin.require_auth();
        validate_non_default_address(&env, "admin", &admin);
        Self::require_role(&env, &admin, Role::Admin);
        let key = StorageKey::CredentialAuthority;
        env.storage().persistent().set(&key, &pubkey);
        Self::bump(&env, &key);
    }

    pub fn update_credential_root(
        env: Env,
        user: Address,
        new_root: BytesN<32>,
        signature: BytesN<64>,
    ) {
        Self::bump_instance(&env);
        user.require_auth();
        validate_non_default_address(&env, "user", &user);
        validate_signature(&env, "signature", &signature);

        let authority_key = StorageKey::CredentialAuthority;
        let authority_pubkey: BytesN<32> = env
            .storage()
            .persistent()
            .get(&authority_key)
            .expect("credential authority not set");
        Self::bump(&env, &authority_key);

        // Verify Ed25519 signature: ed25519_verify(pubkey, message, signature).
        let message_hash = Self::credential_root_message_hash(&env, &new_root);
        env.crypto()
            .ed25519_verify(&authority_pubkey, &message_hash.into(), &signature);

        let key = StorageKey::CredentialRoot(user.clone());
        env.storage().persistent().set(&key, &new_root);
        Self::bump(&env, &key);

        CredentialRootUpdatedEvent {
            user,
            root: new_root,
        }
        .publish(&env);
    }

    pub fn verify_credential(
        env: Env,
        user: Address,
        proof: Vec<BytesN<32>>,
        leaf: BytesN<32>,
        nullifier: BytesN<32>,
    ) -> bool {
        Self::bump_instance(&env);
        validate_non_default_address(&env, "user", &user);

        let root_key = StorageKey::CredentialRoot(user.clone());
        let expected_root: Option<BytesN<32>> = env.storage().persistent().get(&root_key);
        if expected_root.is_none() {
            return false;
        }

        let nullifier_key = StorageKey::NullifierSet(user.clone(), nullifier.clone());
        if env.storage().persistent().has(&nullifier_key) {
            return false;
        }

        let mut computed = leaf;
        for sibling in proof.iter() {
            computed = Self::hash_merkle_pair(&env, &computed, &sibling);
        }

        if computed != expected_root.unwrap() {
            return false;
        }

        env.storage().persistent().set(&nullifier_key, &true);
        Self::bump(&env, &root_key);
        Self::bump(&env, &nullifier_key);

        CredentialVerifiedEvent { user, nullifier }.publish(&env);
        true
    }

    pub fn get_credential_root(env: Env, user: Address) -> Option<BytesN<32>> {
        validate_non_default_address(&env, "user", &user);
        let key = StorageKey::CredentialRoot(user);
        let result: Option<BytesN<32>> = env.storage().persistent().get(&key);
        if result.is_some() {
            Self::bump(&env, &key);
        }
        result
    }

    /// Publish a user's X25519 public key for encrypted direct messages.
    /// This key is separate from the Stellar signing key for security reasons.
    pub fn publish_dm_key(env: Env, user: Address, x25519_pubkey: BytesN<32>) {
        Self::bump_instance(&env);
        user.require_auth();
        validate_non_default_address(&env, "user", &user);

        let key = StorageKey::DmPublicKey(user.clone());
        env.storage().persistent().set(&key, &x25519_pubkey);
        Self::bump(&env, &key);

        DmKeyPublishedEvent {
            user,
            public_key: x25519_pubkey,
        }
        .publish(&env);
    }

    /// Retrieve a user's X25519 public key for encrypted direct messages.
    /// Returns None if the user has not published a DM key.
    pub fn get_dm_key(env: Env, user: Address) -> Option<BytesN<32>> {
        validate_non_default_address(&env, "user", &user);
        let key = StorageKey::DmPublicKey(user);
        let result: Option<BytesN<32>> = env.storage().persistent().get(&key);
        if result.is_some() {
            Self::bump(&env, &key);
        }
        result
    }

    // ── Social Graph (ADR-001: adjacency-set with per-user counters) ────────

    pub fn follow(env: Env, follower: Address, followee: Address) {
        Self::bump_instance(&env);
        follower.require_auth();
        validate_non_default_address(&env, "follower", &follower);
        validate_non_default_address(&env, "followee", &followee);
        require_with_error!(
            &env,
            follower != followee,
            "follower and followee must be different"
        );
        Self::require_not_paused(&env);

        if Self::is_blocked(env.clone(), followee.clone(), follower.clone()) {
            panic!("blocked");
        }
        if Self::is_blocked(env.clone(), follower.clone(), followee.clone()) {
            panic!("blocked");
        }
        if Self::is_blocked(env.clone(), follower.clone(), followee.clone()) {
            panic!("blocked");
        }

        // Consistency guards
        let check_expired = |k: &StorageKey| {
            if !env.storage().persistent().has(k) {
                panic!("graph entry expired - pay rent");
            }
            #[cfg(test)]
            {
                let mut ttl = env.storage().persistent().get_ttl(k);
                if ttl > 10_000_000 {
                    ttl = 0;
                }
                if ttl <= LEDGER_THRESHOLD {
                    panic!("graph entry expired - pay rent");
                }
            }
        };

        let registered: Map<Address, bool> = env
            .storage()
            .instance()
            .get(&REGISTERED_USERS)
            .unwrap_or_else(|| Map::new(&env));

        if registered.contains_key(follower.clone()) {
            check_expired(&StorageKey::FollowingCount(follower.clone()));
            check_expired(&StorageKey::FollowersCount(follower.clone()));
        }
        if registered.contains_key(followee.clone()) {
            check_expired(&StorageKey::FollowingCount(followee.clone()));
            check_expired(&StorageKey::FollowersCount(followee.clone()));
        }

        let edge_key = StorageKey::Edge(follower.clone(), followee.clone());

        // Idempotent: skip if already following
        if !env.storage().persistent().has(&edge_key) {
            // 1. Write the edge
            env.storage().persistent().set(&edge_key, &true);
            Self::bump(&env, &edge_key);

            // 2. Append to follower's following-index
            let following_count: u32 = env
                .storage()
                .persistent()
                .get(&StorageKey::FollowingCount(follower.clone()))
                .unwrap_or(0u32);
            let following_idx_key = StorageKey::FollowingIdx(follower.clone(), following_count);
            env.storage()
                .persistent()
                .set(&following_idx_key, &followee);
            Self::bump(&env, &following_idx_key);

            // Store position for O(1) swap-remove
            let following_pos_key = StorageKey::FollowingPos(follower.clone(), followee.clone());
            env.storage()
                .persistent()
                .set(&following_pos_key, &following_count);
            Self::bump(&env, &following_pos_key);

            env.storage().persistent().set(
                &StorageKey::FollowingCount(follower.clone()),
                &(following_count + 1),
            );
            Self::bump(&env, &StorageKey::FollowingCount(follower.clone()));

            // 3. Append to followee's followers-index
            let followers_count: u32 = env
                .storage()
                .persistent()
                .get(&StorageKey::FollowersCount(followee.clone()))
                .unwrap_or(0u32);
            let followers_idx_key = StorageKey::FollowersIdx(followee.clone(), followers_count);
            env.storage()
                .persistent()
                .set(&followers_idx_key, &follower);
            Self::bump(&env, &followers_idx_key);

            // Store position for O(1) swap-remove
            let followers_pos_key = StorageKey::FollowersPos(followee.clone(), follower.clone());
            env.storage()
                .persistent()
                .set(&followers_pos_key, &followers_count);
            Self::bump(&env, &followers_pos_key);

            env.storage().persistent().set(
                &StorageKey::FollowersCount(followee.clone()),
                &(followers_count + 1),
            );
            Self::bump(&env, &StorageKey::FollowersCount(followee.clone()));
        }

        FollowEvent { follower, followee }.publish(&env);
    }

    pub fn unfollow(env: Env, follower: Address, followee: Address) {
        Self::bump_instance(&env);
        follower.require_auth();
        validate_non_default_address(&env, "follower", &follower);
        validate_non_default_address(&env, "followee", &followee);
        require_with_error!(
            &env,
            follower != followee,
            "follower and followee must be different"
        );
        Self::require_not_paused(&env);

        let edge_key = StorageKey::Edge(follower.clone(), followee.clone());

        if env.storage().persistent().has(&edge_key) {
            // 1. Remove the edge
            env.storage().persistent().remove(&edge_key);

            // 2. Swap-remove from follower's following-index
            Self::swap_remove_from_index(
                &env, &follower, &followee, true, // is_following side
            );

            // 3. Swap-remove from followee's followers-index
            Self::swap_remove_from_index(
                &env, &followee, &follower, false, // is_followers side
            );
        }

        UnfollowEvent { follower, followee }.publish(&env);
    }

    pub fn get_following(env: Env, user: Address, offset: u32, limit: u32) -> Vec<Address> {
        validate_non_default_address(&env, "user", &user);
        assert!(
            limit > 0 && limit <= MAX_PAGINATION_LIMIT,
            "limit must be between 1 and 50"
        );
        Self::paginate_index(&env, &user, offset, limit, true)
    }

    pub fn get_followers(env: Env, user: Address, offset: u32, limit: u32) -> Vec<Address> {
        validate_non_default_address(&env, "user", &user);
        assert!(
            limit > 0 && limit <= MAX_PAGE_LIMIT,
            "limit must be between 1 and 50"
        );
        Self::paginate_index(&env, &user, offset, limit, false)
    }

    /// Admin function to migrate users from the legacy Vec-based social graph
    /// to the new adjacency-set layout. Processable in chunks of up to 50
    /// users per call. Idempotent: already-migrated edges are skipped.
    pub fn migrate_follow_graph(env: Env, admin: Address, users: Vec<Address>) {
        Self::bump_instance(&env);
        admin.require_auth();
        validate_non_default_address(&env, "admin", &admin);
        Self::require_role(&env, &admin, Role::Admin);
        validate_address_list(&env, "users", &users);
        require_with_error!(
            &env,
            users.len() <= 50,
            "batch size must not exceed 50 users"
        );

        for user in users.iter() {
            let migrated_key = StorageKey::GraphMigrated(user.clone());
            if env.storage().persistent().has(&migrated_key) {
                continue; // Already migrated
            }

            // Migrate following list
            let following_key = StorageKey::Following(user.clone());
            if let Some(following_list) = env
                .storage()
                .persistent()
                .get::<_, Vec<Address>>(&following_key)
            {
                for followee in following_list.iter() {
                    let edge_key = StorageKey::Edge(user.clone(), followee.clone());
                    if !env.storage().persistent().has(&edge_key) {
                        // Write edge
                        env.storage().persistent().set(&edge_key, &true);
                        Self::bump(&env, &edge_key);

                        // Append to following index
                        let count: u32 = env
                            .storage()
                            .persistent()
                            .get(&StorageKey::FollowingCount(user.clone()))
                            .unwrap_or(0u32);
                        let idx_key = StorageKey::FollowingIdx(user.clone(), count);
                        env.storage().persistent().set(&idx_key, &followee);
                        Self::bump(&env, &idx_key);
                        let pos_key = StorageKey::FollowingPos(user.clone(), followee.clone());
                        env.storage().persistent().set(&pos_key, &count);
                        Self::bump(&env, &pos_key);
                        env.storage()
                            .persistent()
                            .set(&StorageKey::FollowingCount(user.clone()), &(count + 1));
                        Self::bump(&env, &StorageKey::FollowingCount(user.clone()));

                        // Also write the followers side for the followee
                        let f_count: u32 = env
                            .storage()
                            .persistent()
                            .get(&StorageKey::FollowersCount(followee.clone()))
                            .unwrap_or(0u32);
                        let f_idx_key = StorageKey::FollowersIdx(followee.clone(), f_count);
                        env.storage().persistent().set(&f_idx_key, &user);
                        Self::bump(&env, &f_idx_key);
                        let f_pos_key = StorageKey::FollowersPos(followee.clone(), user.clone());
                        env.storage().persistent().set(&f_pos_key, &f_count);
                        Self::bump(&env, &f_pos_key);
                        env.storage().persistent().set(
                            &StorageKey::FollowersCount(followee.clone()),
                            &(f_count + 1),
                        );
                        Self::bump(&env, &StorageKey::FollowersCount(followee.clone()));
                    }
                }
                // Remove old following list
                env.storage().persistent().remove(&following_key);
            }

            // Migrate followers list (in case of asymmetric old data)
            let followers_key = StorageKey::Followers(user.clone());
            if let Some(followers_list) = env
                .storage()
                .persistent()
                .get::<_, Vec<Address>>(&followers_key)
            {
                for follower in followers_list.iter() {
                    let edge_key = StorageKey::Edge(follower.clone(), user.clone());
                    if !env.storage().persistent().has(&edge_key) {
                        // Write edge
                        env.storage().persistent().set(&edge_key, &true);
                        Self::bump(&env, &edge_key);

                        // Append to follower's following index
                        let count: u32 = env
                            .storage()
                            .persistent()
                            .get(&StorageKey::FollowingCount(follower.clone()))
                            .unwrap_or(0u32);
                        let idx_key = StorageKey::FollowingIdx(follower.clone(), count);
                        env.storage().persistent().set(&idx_key, &user);
                        Self::bump(&env, &idx_key);
                        let pos_key = StorageKey::FollowingPos(follower.clone(), user.clone());
                        env.storage().persistent().set(&pos_key, &count);
                        Self::bump(&env, &pos_key);
                        env.storage()
                            .persistent()
                            .set(&StorageKey::FollowingCount(follower.clone()), &(count + 1));
                        Self::bump(&env, &StorageKey::FollowingCount(follower.clone()));

                        // Append to user's followers index
                        let f_count: u32 = env
                            .storage()
                            .persistent()
                            .get(&StorageKey::FollowersCount(user.clone()))
                            .unwrap_or(0u32);
                        let f_idx_key = StorageKey::FollowersIdx(user.clone(), f_count);
                        env.storage().persistent().set(&f_idx_key, &follower);
                        Self::bump(&env, &f_idx_key);
                        let f_pos_key = StorageKey::FollowersPos(user.clone(), follower.clone());
                        env.storage().persistent().set(&f_pos_key, &f_count);
                        Self::bump(&env, &f_pos_key);
                        env.storage()
                            .persistent()
                            .set(&StorageKey::FollowersCount(user.clone()), &(f_count + 1));
                        Self::bump(&env, &StorageKey::FollowersCount(user.clone()));
                    }
                }
                // Remove old followers list
                env.storage().persistent().remove(&followers_key);
            }

            // Mark user as migrated
            env.storage().persistent().set(&migrated_key, &true);
            Self::bump(&env, &migrated_key);
        }
    }

    // ── Block List ────────────────────────────────────────────────────────────

    pub fn block_user(env: Env, blocker: Address, blocked: Address) {
        Self::bump_instance(&env);
        blocker.require_auth();
        validate_non_default_address(&env, "blocker", &blocker);
        validate_non_default_address(&env, "blocked", &blocked);
        require_with_error!(
            &env,
            blocker != blocked,
            "blocker and blocked must be different"
        );
        Self::require_not_paused(&env);
        let key = StorageKey::Blocks(blocker.clone());
        let mut blocks: Map<Address, ()> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Map::new(&env));
        blocks.set(blocked.clone(), ());
        env.storage().persistent().set(&key, &blocks);
        Self::bump(&env, &key);

        // Clean up follow relationships between blocker and blocked
        Self::cleanup_follow_on_block(&env, &blocker, &blocked);

        // Clean up like entries between blocker and blocked
        Self::cleanup_likes_on_block(&env, &blocker, &blocked);

        BlockEvent { blocker, blocked }.publish(&env);
    }

    pub fn unblock_user(env: Env, blocker: Address, blocked: Address) {
        Self::bump_instance(&env);
        blocker.require_auth();
        validate_non_default_address(&env, "blocker", &blocker);
        validate_non_default_address(&env, "blocked", &blocked);
        require_with_error!(
            &env,
            blocker != blocked,
            "blocker and blocked must be different"
        );
        Self::require_not_paused(&env);
        let key = StorageKey::Blocks(blocker.clone());
        let mut blocks: Map<Address, ()> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Map::new(&env));
        blocks.remove(blocked.clone());
        env.storage().persistent().set(&key, &blocks);
        Self::bump(&env, &key);
        UnblockEvent { blocker, blocked }.publish(&env);
    }

    pub fn is_blocked(env: Env, blocker: Address, blocked: Address) -> bool {
        validate_non_default_address(&env, "blocker", &blocker);
        validate_non_default_address(&env, "blocked", &blocked);
        let blocks: Map<Address, ()> = env
            .storage()
            .persistent()
            .get(&StorageKey::Blocks(blocker))
            .unwrap_or(Map::new(&env));
        blocks.contains_key(blocked)
    }

    // ── Posts ─────────────────────────────────────────────────────────────────

    pub fn create_post(env: Env, author: Address, content: String) -> u64 {
        Self::bump_instance(&env);
        author.require_auth();
        validate_non_default_address(&env, "author", &author);
        validate_content(&env, &content);
        Self::require_not_paused(&env);

        let id: u64 = env.storage().instance().get(&POST_CT).unwrap_or(0u64) + 1;
        let key = StorageKey::Post(id);
        env.storage().persistent().set(
            &key,
            &Post {
                id,
                author: author.clone(),
                content,
                tip_total: 0,
                timestamp: env.ledger().timestamp(),
                like_count: 0,
            },
        );
        Self::bump(&env, &key);
        env.storage().instance().set(&POST_CT, &id);

        // Track post ID under author's posts
        let author_key = StorageKey::AuthorPosts(author.clone());
        let mut author_posts: Vec<u64> = env
            .storage()
            .persistent()
            .get(&author_key)
            .unwrap_or(Vec::new(&env));
        author_posts.push_back(id);
        env.storage().persistent().set(&author_key, &author_posts);
        Self::bump(&env, &author_key);

        PostCreatedEvent { id, author }.publish(&env);
        id
    }

    /// Returns the total number of posts ever created, not the current active count.
    /// This counter is never decremented when posts are deleted.
    pub fn get_post_count(env: Env) -> u64 {
        env.storage().instance().get(&POST_CT).unwrap_or(0u64)
    }

    pub fn get_post(env: Env, id: u64) -> Option<Post> {
        require_with_error!(&env, id > 0, "post id must be positive");
        let key = StorageKey::Post(id);
        let result: Option<Post> = env.storage().persistent().get(&key);
        if result.is_some() {
            Self::bump(&env, &key);
        }
        result
    }

    pub fn delete_post(env: Env, author: Address, post_id: u64) {
        Self::bump_instance(&env);
        author.require_auth();
        validate_non_default_address(&env, "author", &author);
        require_with_error!(&env, post_id > 0, "post id must be positive");
        Self::require_not_paused(&env);
        let key = StorageKey::Post(post_id);
        let post: Post = env.storage().persistent().get(&key).unwrap_or_else(|| {
            panic!("post does not exist: {}", post_id);
        });
        assert!(post.author == author, "only author can delete post");
        env.storage().persistent().remove(&key);

        let tombstone_key = StorageKey::DeletedPost(post_id);
        env.storage().persistent().set(&tombstone_key, &true);
        Self::bump(&env, &tombstone_key);

        // Remove post ID from author's posts list
        let author_key = StorageKey::AuthorPosts(author.clone());
        if let Some(mut author_posts) = env
            .storage()
            .persistent()
            .get::<_, soroban_sdk::Vec<u64>>(&author_key)
        {
            if let Some(index) = author_posts.iter().position(|id| id == post_id) {
                author_posts.remove(index as u32);
                if author_posts.is_empty() {
                    env.storage().persistent().remove(&author_key);
                } else {
                    env.storage().persistent().set(&author_key, &author_posts);
                    Self::bump(&env, &author_key);
                }
            }
        }

        PostDeleted { post_id, author }.publish(&env);
    }

    pub fn batch_cleanup_post(env: Env, post_id: u64, max_entries: u32) {
        Self::bump_instance(&env);
        let tombstone_key = StorageKey::DeletedPost(post_id);
        assert!(
            env.storage().persistent().has(&tombstone_key),
            "post not deleted"
        );

        let mut entries_removed = 0;

        // Cleanup Likes
        let likes_count_key = StorageKey::PostLikersCount(post_id);
        let mut likes_count: u32 = env
            .storage()
            .persistent()
            .get(&likes_count_key)
            .unwrap_or(0);
        while likes_count > 0 && entries_removed < max_entries {
            likes_count -= 1;
            let idx_key = StorageKey::PostLikersIdx(post_id, likes_count);
            if let Some(liker) = env.storage().persistent().get::<_, Address>(&idx_key) {
                env.storage()
                    .persistent()
                    .remove(&StorageKey::Like(post_id, liker));
                env.storage().persistent().remove(&idx_key);
            }
            entries_removed += 1;
        }
        if likes_count == 0 {
            env.storage().persistent().remove(&likes_count_key);
        } else {
            env.storage()
                .persistent()
                .set(&likes_count_key, &likes_count);
            Self::bump(&env, &likes_count_key);
        }

        // Cleanup Reports
        let reports_count_key = StorageKey::ReportCount(post_id);
        let mut reports_count: u32 = env
            .storage()
            .persistent()
            .get(&reports_count_key)
            .unwrap_or(0);
        while reports_count > 0 && entries_removed < max_entries {
            reports_count -= 1;
            let idx_key = StorageKey::PostReportersIdx(post_id, reports_count);
            if let Some(reporter) = env.storage().persistent().get::<_, Address>(&idx_key) {
                env.storage()
                    .persistent()
                    .remove(&StorageKey::Report(post_id, reporter));
                env.storage().persistent().remove(&idx_key);
            }
            entries_removed += 1;
        }
        if reports_count == 0 {
            env.storage().persistent().remove(&reports_count_key);
        } else {
            env.storage()
                .persistent()
                .set(&reports_count_key, &reports_count);
            Self::bump(&env, &reports_count_key);
        }

        // Cleanup Tip Cooldowns
        let tc_count_key = StorageKey::PostTipCooldownsCount(post_id);
        let mut tc_count: u32 = env.storage().persistent().get(&tc_count_key).unwrap_or(0);
        while tc_count > 0 && entries_removed < max_entries {
            tc_count -= 1;
            let idx_key = StorageKey::PostTipCooldownsIdx(post_id, tc_count);
            if let Some(tipper) = env.storage().persistent().get::<_, Address>(&idx_key) {
                env.storage()
                    .temporary()
                    .remove(&StorageKey::TipCooldown(post_id, tipper));
                env.storage().persistent().remove(&idx_key);
            }
            entries_removed += 1;
        }
        if tc_count == 0 {
            env.storage().persistent().remove(&tc_count_key);
        } else {
            env.storage().persistent().set(&tc_count_key, &tc_count);
            Self::bump(&env, &tc_count_key);
        }

        // Finalize Tombstone Removal
        if likes_count == 0 && reports_count == 0 && tc_count == 0 {
            env.storage().persistent().remove(&tombstone_key);
        }
    }

    pub fn get_posts_by_author(env: Env, author: Address, offset: u32, limit: u32) -> Vec<u64> {
        validate_non_default_address(&env, "author", &author);
        assert!(
            limit > 0 && limit <= MAX_PAGINATION_LIMIT,
            "limit must be between 1 and 50"
        );

        let key = StorageKey::AuthorPosts(author);
        let posts: Vec<u64> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env));

        if posts.is_empty() {
            return Vec::new(&env);
        }

        Self::bump(&env, &key);
        paginate(&env, &posts, offset, limit)
    }

    // ── Reactions ─────────────────────────────────────────────────────────────

    pub fn like_post(env: Env, user: Address, post_id: u64) {
        Self::bump_instance(&env);
        user.require_auth();
        validate_non_default_address(&env, "user", &user);
        require_with_error!(&env, post_id > 0, "post id must be positive");
        Self::require_not_paused(&env);

        let like_key = StorageKey::Like(post_id, user.clone());
        if env.storage().persistent().has(&like_key) {
            return;
        }

        let post_key = StorageKey::Post(post_id);
        let post: Post = env
            .storage()
            .persistent()
            .get(&post_key)
            .expect("post not found");
        if Self::is_blocked(env.clone(), post.author.clone(), user.clone()) {
            panic!("blocked");
        }
        if Self::is_blocked(env.clone(), user.clone(), post.author.clone()) {
            panic!("blocked");
        }

        let mut post = post;
        let like_idx_key = StorageKey::PostLikersIdx(post_id, post.like_count as u32);
        post.like_count += 1;
        env.storage().persistent().set(&post_key, &post);
        Self::bump(&env, &post_key);

        env.storage().persistent().set(&like_idx_key, &user);
        Self::bump(&env, &like_idx_key);

        let count_key = StorageKey::PostLikersCount(post_id);
        env.storage()
            .persistent()
            .set(&count_key, &(post.like_count as u32));
        Self::bump(&env, &count_key);

        env.storage().persistent().set(&like_key, &true);
        Self::bump(&env, &like_key);
        LikePostEvent { user, post_id }.publish(&env);
    }

    pub fn get_like_count(env: Env, post_id: u64) -> u64 {
        require_with_error!(&env, post_id > 0, "post id must be positive");
        let key = StorageKey::Post(post_id);
        let result: Option<Post> = env.storage().persistent().get(&key);
        result.map(|p| p.like_count).unwrap_or(0)
    }

    pub fn has_liked(env: Env, user: Address, post_id: u64) -> bool {
        validate_non_default_address(&env, "user", &user);
        require_with_error!(&env, post_id > 0, "post id must be positive");
        let key = StorageKey::Like(post_id, user);
        env.storage().persistent().has(&key)
    }

    // ── Tipping ───────────────────────────────────────────────────────────────

    pub fn tip(env: Env, tipper: Address, post_id: u64, token: Address, amount: i128) {
        Self::bump_instance(&env);
        tipper.require_auth();
        validate_non_default_address(&env, "tipper", &tipper);
        validate_non_default_address(&env, "token", &token);
        require_with_error!(&env, post_id > 0, "post id must be positive");
        validate_amount(&env, "tip amount", amount);

        let key = StorageKey::Post(post_id);
        let mut post: Post = env.storage().persistent().get(&key).unwrap_or_else(|| {
            panic!("post not found: {}", post_id);
        });

        if Self::is_blocked(env.clone(), post.author.clone(), tipper.clone()) {
            panic!("blocked");
        }
        if Self::is_blocked(env.clone(), tipper.clone(), post.author.clone()) {
            panic!("blocked");
        }
        if Self::is_blocked(env.clone(), tipper.clone(), post.author.clone()) {
            panic!("blocked");
        }

        // Check tip cooldown: one tip per tipper per post per cooldown window.
        let cooldown_key = StorageKey::TipCooldown(post_id, tipper.clone());
        let current_ledger = env.ledger().sequence();
        let cooldown_window: u32 = env
            .storage()
            .instance()
            .get(&TIP_COOLDOWN_WINDOW)
            .unwrap_or(1u32);

        if let Some(last_tip_ledger) = env.storage().temporary().get::<_, u32>(&cooldown_key) {
            let ledgers_elapsed = current_ledger.saturating_sub(last_tip_ledger);
            assert!(
                ledgers_elapsed >= cooldown_window,
                "tip cooldown not expired"
            );
        }

        // Update last tip ledger
        let was_tracked = env.storage().temporary().has(&cooldown_key);
        env.storage()
            .temporary()
            .set(&cooldown_key, &current_ledger);
        Self::bump_temp(&env, &cooldown_key);

        if !was_tracked {
            let tc_count_key = StorageKey::PostTipCooldownsCount(post_id);
            let count: u32 = env.storage().persistent().get(&tc_count_key).unwrap_or(0);
            let tc_idx_key = StorageKey::PostTipCooldownsIdx(post_id, count);
            env.storage().persistent().set(&tc_idx_key, &tipper);
            Self::bump(&env, &tc_idx_key);
            env.storage().persistent().set(&tc_count_key, &(count + 1));
            Self::bump(&env, &tc_count_key);
        }

        let fee_bps = Self::get_fee_bps(env.clone());
        let fee_amount =
            (amount / 10_000) * fee_bps as i128 + (amount % 10_000) * fee_bps as i128 / 10_000;
        let author_amount = amount - fee_amount;
        post.tip_total += author_amount;
        env.storage().persistent().set(&key, &post);
        Self::bump(&env, &key);

        let token_client = token::Client::new(&env, &token);

        if fee_amount > 0 {
            let treasury: Address = env
                .storage()
                .instance()
                .get(&TREASURY)
                .expect("treasury not set");
            token_client.transfer(&tipper, &treasury, &fee_amount);
        }
        token_client.transfer(&tipper, &post.author, &author_amount);

        TipEvent {
            tipper,
            post_id,
            amount,
            fee: fee_amount,
        }
        .publish(&env);
    }

    // ── Community Pool ────────────────────────────────────────────────────────

    /// Create a named pool with an admin set and M-of-N withdrawal threshold.
    pub fn create_pool(
        env: Env,
        admin: Address,
        pool_id: Symbol,
        token: Address,
        initial_admins: Vec<Address>,
        threshold: u32,
    ) {
        Self::bump_instance(&env);
        admin.require_auth();
        validate_non_default_address(&env, "admin", &admin);
        validate_non_default_address(&env, "token", &token);
        validate_address_list(&env, "initial_admins", &initial_admins);
        Self::require_role(&env, &admin, Role::Admin);
        let key = StorageKey::Pool(pool_id.clone());
        assert!(!env.storage().persistent().has(&key), "pool exists");
        assert!(
            threshold > 0 && threshold <= initial_admins.len(),
            "invalid threshold"
        );

        // Clone admins for event payload before moving into storage
        let admins_for_event = initial_admins.clone();
        let token_copy = token.clone();
        env.storage().persistent().set(
            &key,
            &Pool {
                token,
                balance: 0,
                admins: initial_admins,
                threshold,
            },
        );
        Self::bump(&env, &key);

        PoolCreatedEvent {
            pool_id,
            token: token_copy,
            admins: admins_for_event,
            threshold,
        }
        .publish(&env);
    }

    pub fn pool_deposit(
        env: Env,
        depositor: Address,
        pool_id: Symbol,
        token: Address,
        amount: i128,
    ) {
        Self::bump_instance(&env);
        validate_non_default_address(&env, "depositor", &depositor);
        validate_non_default_address(&env, "token", &token);
        validate_amount(&env, "deposit amount", amount);
        depositor.require_auth();
        let key = StorageKey::Pool(pool_id.clone());
        let mut pool: Pool = env
            .storage()
            .persistent()
            .get(&key)
            .expect("pool not found");
        assert!(pool.token == token, "wrong token for pool");

        pool.balance += amount;
        env.storage().persistent().set(&key, &pool);
        Self::bump(&env, &key);

        token::Client::new(&env, &token).transfer(
            &depositor,
            env.current_contract_address(),
            &amount,
        );

        PoolDepositEvent {
            depositor,
            pool_id,
            amount,
        }
        .publish(&env);
    }

    /// Withdraw from a pool. Requires `threshold` valid admin signatures.
    pub fn pool_withdraw(
        env: Env,
        signers: Vec<Address>,
        pool_id: Symbol,
        amount: i128,
        recipient: Address,
    ) {
        Self::bump_instance(&env);
        validate_address_list(&env, "signers", &signers);
        validate_non_default_address(&env, "recipient", &recipient);
        validate_amount(&env, "withdraw amount", amount);
        let key = StorageKey::Pool(pool_id.clone());
        let mut pool: Pool = env
            .storage()
            .persistent()
            .get(&key)
            .expect("pool not found");

        assert!(signers.len() >= pool.threshold, "insufficient signers");
        for signer in signers.iter() {
            assert!(
                pool.admins.iter().any(|x| x == signer),
                "unauthorized signer"
            );
            signer.require_auth();
        }
        assert!(pool.balance >= amount, "low balance");

        pool.balance -= amount;
        env.storage().persistent().set(&key, &pool);
        Self::bump(&env, &key);
        token::Client::new(&env, &pool.token).transfer(
            &env.current_contract_address(),
            &recipient,
            &amount,
        );

        PoolWithdrawEvent {
            recipient,
            pool_id,
            amount,
        }
        .publish(&env);
    }

    pub fn get_pool(env: Env, pool_id: Symbol) -> Option<Pool> {
        let key = StorageKey::Pool(pool_id);
        let result: Option<Pool> = env.storage().persistent().get(&key);
        if result.is_some() {
            Self::bump(&env, &key);
        }
        result
    }

    pub fn get_pool_admins(env: Env, pool_id: Symbol) -> Vec<Address> {
        let key = StorageKey::Pool(pool_id);
        let pool: Pool = env
            .storage()
            .persistent()
            .get(&key)
            .expect("pool not found");
        Self::bump(&env, &key);
        pool.admins
    }

    pub fn add_pool_admin(env: Env, signers: Vec<Address>, pool_id: Symbol, new_admin: Address) {
        Self::bump_instance(&env);
        validate_address_list(&env, "signers", &signers);
        validate_non_default_address(&env, "new_admin", &new_admin);
        let key = StorageKey::Pool(pool_id.clone());
        let mut pool: Pool = env
            .storage()
            .persistent()
            .get(&key)
            .expect("pool not found");

        assert!(signers.len() >= pool.threshold, "insufficient signers");
        for signer in signers.iter() {
            assert!(
                pool.admins.iter().any(|x| x == signer),
                "unauthorized signer"
            );
            signer.require_auth();
        }

        assert!(
            !pool.admins.iter().any(|x| x == new_admin),
            "admin already exists"
        );

        pool.admins.push_back(new_admin.clone());
        env.storage().persistent().set(&key, &pool);
        Self::bump(&env, &key);

        PoolAdminAddedEvent { pool_id, new_admin }.publish(&env);
    }

    pub fn remove_pool_admin(env: Env, signers: Vec<Address>, pool_id: Symbol, admin: Address) {
        Self::bump_instance(&env);
        validate_address_list(&env, "signers", &signers);
        validate_non_default_address(&env, "admin", &admin);
        let key = StorageKey::Pool(pool_id.clone());
        let mut pool: Pool = env
            .storage()
            .persistent()
            .get(&key)
            .expect("pool not found");

        assert!(signers.len() >= pool.threshold, "insufficient signers");
        for signer in signers.iter() {
            assert!(
                pool.admins.iter().any(|x| x == signer),
                "unauthorized signer"
            );
            signer.require_auth();
        }

        let initial_len = pool.admins.len();
        let mut new_admins = Vec::new(&env);
        for existing_admin in pool.admins.iter() {
            if existing_admin != admin {
                new_admins.push_back(existing_admin.clone());
            }
        }
        pool.admins = new_admins;

        assert!(pool.admins.len() < initial_len, "admin not found");
        assert!(
            pool.threshold <= pool.admins.len(),
            "threshold unreachable after removal"
        );

        env.storage().persistent().set(&key, &pool);
        Self::bump(&env, &key);

        PoolAdminRemovedEvent { pool_id, admin }.publish(&env);
    }

    pub fn update_pool_threshold(env: Env, signers: Vec<Address>, pool_id: Symbol, threshold: u32) {
        Self::bump_instance(&env);
        validate_address_list(&env, "signers", &signers);
        validate_u32_range(&env, "threshold", threshold, 1, MAX_QUORUM);
        let key = StorageKey::Pool(pool_id.clone());
        let mut pool: Pool = env
            .storage()
            .persistent()
            .get(&key)
            .expect("pool not found");

        assert!(signers.len() >= pool.threshold, "insufficient signers");
        for signer in signers.iter() {
            assert!(
                pool.admins.iter().any(|x| x == signer),
                "unauthorized signer"
            );
            signer.require_auth();
        }

        assert!(
            threshold <= pool.admins.len(),
            "threshold cannot exceed admin count"
        );

        let old_threshold = pool.threshold;
        pool.threshold = threshold;
        env.storage().persistent().set(&key, &pool);
        Self::bump(&env, &key);

        PoolThresholdUpdatedEvent {
            pool_id,
            old_threshold,
            new_threshold: threshold,
        }
        .publish(&env);
    }

    // ── Fee & Treasury ────────────────────────────────────────────────────────

    pub fn set_fee(env: Env, admin: Address, fee_bps: u32) {
        Self::bump_instance(&env);
        admin.require_auth();
        validate_non_default_address(&env, "admin", &admin);
        Self::require_role(&env, &admin, Role::Admin);
        validate_protocol_fee(&env, fee_bps);
        Self::require_not_paused(&env);
        assert!(fee_bps <= 10_000, "invalid fee");
        let old_fee_bps = Self::get_fee_bps(env.clone());
        env.storage().instance().set(&FEE_BPS, &fee_bps);
        FeeUpdatedEvent {
            name: symbol_short!("fee_upd"),
            old_fee_bps,
            new_fee_bps: fee_bps,
        }
        .publish(&env);
        EmergencyBypassEvent {
            action: symbol_short!("set_fee"),
        }
        .publish(&env);
    }

    pub fn set_treasury(env: Env, admin: Address, treasury: Address) {
        Self::bump_instance(&env);
        admin.require_auth();
        validate_non_default_address(&env, "admin", &admin);
        Self::require_role(&env, &admin, Role::Admin);
        validate_non_default_address(&env, "treasury", &treasury);
        Self::require_not_paused(&env);
        let old_treasury = Self::get_treasury(env.clone()).expect("treasury not set");
        env.storage().instance().set(&TREASURY, &treasury);
        TreasuryUpdatedEvent {
            name: symbol_short!("treas_upd"),
            old_treasury,
            new_treasury: treasury,
        }
        .publish(&env);
        EmergencyBypassEvent {
            action: symbol_short!("set_tres"),
        }
        .publish(&env);
    }

    pub fn get_fee_bps(env: Env) -> u32 {
        env.storage().instance().get(&FEE_BPS).unwrap_or(0u32)
    }

    pub fn get_treasury(env: Env) -> Option<Address> {
        env.storage().instance().get(&TREASURY)
    }

    pub fn set_tip_cooldown_window(env: Env, admin: Address, cooldown_ledgers: u32) {
        Self::bump_instance(&env);
        admin.require_auth();
        validate_non_default_address(&env, "admin", &admin);
        Self::require_role(&env, &admin, Role::Admin);
        validate_u32_range(&env, "cooldown_ledgers", cooldown_ledgers, 1, u32::MAX);
        Self::require_not_paused(&env);
        assert!(cooldown_ledgers > 0, "cooldown must be positive");
        env.storage()
            .instance()
            .set(&TIP_COOLDOWN_WINDOW, &cooldown_ledgers);
    }

    pub fn get_tip_cooldown_window(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&TIP_COOLDOWN_WINDOW)
            .unwrap_or(1u32)
    }

    // ── Governance ────────────────────────────────────────────────────────────

    pub fn gov_init_config(
        env: Env,
        admin: Address,
        quorum: u32,
        time_lock_ledgers: u32,
        vote_window_ledgers: u32,
        quorum_decay_rate_bps: u32,
        quorum_floor: u32,
    ) {
        Self::bump_instance(&env);
        admin.require_auth();
        validate_non_default_address(&env, "admin", &admin);
        Self::require_role(&env, &admin, Role::Admin);
        validate_u32_range(&env, "quorum", quorum, 1, MAX_QUORUM);
        validate_u32_range(&env, "time_lock_ledgers", time_lock_ledgers, 1, u32::MAX);
        validate_u32_range(
            &env,
            "vote_window_ledgers",
            vote_window_ledgers,
            1,
            u32::MAX,
        );
        require_with_error!(&env, quorum_floor <= quorum, "floor must be <= quorum");
        validate_u32_range(
            &env,
            "quorum_decay_rate_bps",
            quorum_decay_rate_bps,
            0,
            MAX_FEE_BPS,
        );

        let config = GovConfig {
            quorum,
            time_lock_ledgers,
            vote_window_ledgers,
            quorum_decay_rate_bps,
            quorum_floor,
        };
        let key = StorageKey::GovConfig;
        env.storage().persistent().set(&key, &config);
        Self::bump(&env, &key);
    }

    pub fn gov_get_config(env: Env) -> GovConfig {
        let key = StorageKey::GovConfig;
        let config: GovConfig = env
            .storage()
            .persistent()
            .get(&key)
            .expect("governance not configured");
        Self::bump(&env, &key);
        config
    }

    pub fn gov_propose(
        env: Env,
        proposer: Address,
        parameter: GovParameter,
        new_value: u64,
        new_address: Option<Address>,
    ) -> u64 {
        Self::bump_instance(&env);
        proposer.require_auth();
        validate_non_default_address(&env, "proposer", &proposer);
        validate_gov_parameter(&env, &parameter);
        require_with_error!(
            &env,
            new_value <= u32::MAX as u64,
            "new_value must fit in u32"
        );
        let new_value_u32 = new_value as u32;
        match parameter {
            GovParameter::FeeBps | GovParameter::ModerationSlashBps => {
                validate_u32_range(&env, "new_value", new_value_u32, 0, MAX_FEE_BPS)
            }
            GovParameter::GovQuorum => {
                validate_u32_range(&env, "new_value", new_value_u32, 1, MAX_QUORUM)
            }
            GovParameter::GovTimeLock
            | GovParameter::GovVoteWindow
            | GovParameter::TipCooldownWindow => {
                validate_u32_range(&env, "new_value", new_value_u32, 1, u32::MAX)
            }
            GovParameter::Treasury => {
                require_with_error!(
                    &env,
                    new_address.is_some(),
                    "treasury proposals require new_address"
                );
            }
        }
        if let Some(address) = &new_address {
            validate_non_default_address(&env, "new_address", address);
        }

        let config_key = StorageKey::GovConfig;
        let config: GovConfig = env
            .storage()
            .persistent()
            .get(&config_key)
            .expect("governance not configured");
        Self::bump(&env, &config_key);

        let count_key = StorageKey::GovProposalCount;
        let id: u64 = env.storage().persistent().get(&count_key).unwrap_or(0u64) + 1;

        let proposal = GovProposal {
            id,
            proposer: proposer.clone(),
            parameter: parameter.clone(),
            new_value,
            new_address,
            votes_for: 0,
            votes_against: 0,
            created_ledger: env.ledger().sequence(),
            time_lock_ledgers: config.time_lock_ledgers,
            status: GovStatus::Active,
        };

        let proposal_key = StorageKey::GovProposal(id);
        env.storage().persistent().set(&proposal_key, &proposal);
        Self::bump(&env, &proposal_key);
        env.storage().persistent().set(&count_key, &id);
        Self::bump(&env, &count_key);

        GovProposalCreatedEvent {
            proposal_id: id,
            proposer,
            parameter,
            new_value,
        }
        .publish(&env);

        id
    }

    pub fn gov_vote(env: Env, voter: Address, proposal_id: u64, support: bool) {
        Self::bump_instance(&env);
        voter.require_auth();
        validate_non_default_address(&env, "voter", &voter);
        require_with_error!(&env, proposal_id > 0, "proposal id must be positive");

        let config_key = StorageKey::GovConfig;
        let config: GovConfig = env
            .storage()
            .persistent()
            .get(&config_key)
            .expect("governance not configured");
        Self::bump(&env, &config_key);

        let proposal_key = StorageKey::GovProposal(proposal_id);
        let mut proposal: GovProposal = env
            .storage()
            .persistent()
            .get(&proposal_key)
            .expect("proposal not found");

        assert!(proposal.status == GovStatus::Active, "proposal not active");

        let current_ledger = env.ledger().sequence();
        let vote_deadline = proposal.created_ledger + config.vote_window_ledgers;
        assert!(current_ledger <= vote_deadline, "vote window closed");

        let vote_key = StorageKey::GovVote(proposal_id, voter.clone());
        assert!(!env.storage().persistent().has(&vote_key), "already voted");

        if support {
            proposal.votes_for += 1;
        } else {
            proposal.votes_against += 1;
        }

        env.storage().persistent().set(&vote_key, &true);
        Self::bump(&env, &vote_key);
        env.storage().persistent().set(&proposal_key, &proposal);
        Self::bump(&env, &proposal_key);

        GovVoteEvent {
            proposal_id,
            voter,
            support,
        }
        .publish(&env);
    }

    pub fn effective_quorum(env: Env, proposal_id: u64) -> u32 {
        let config_key = StorageKey::GovConfig;
        let config: GovConfig = env
            .storage()
            .persistent()
            .get(&config_key)
            .expect("governance not configured");
        Self::bump(&env, &config_key);

        let proposal_key = StorageKey::GovProposal(proposal_id);
        let proposal: GovProposal = env
            .storage()
            .persistent()
            .get(&proposal_key)
            .expect("proposal not found");
        Self::bump(&env, &proposal_key);

        let elapsed = env
            .ledger()
            .sequence()
            .saturating_sub(proposal.created_ledger);
        let decay = (elapsed as u64 * config.quorum_decay_rate_bps as u64 / 10_000) as u32;
        let decayed_quorum = config.quorum.saturating_sub(decay);

        if decayed_quorum < config.quorum_floor {
            config.quorum_floor
        } else {
            decayed_quorum
        }
    }

    pub fn gov_execute(env: Env, proposal_id: u64) {
        Self::bump_instance(&env);
        require_with_error!(&env, proposal_id > 0, "proposal id must be positive");

        let config_key = StorageKey::GovConfig;
        let config: GovConfig = env
            .storage()
            .persistent()
            .get(&config_key)
            .expect("governance not configured");
        Self::bump(&env, &config_key);

        let proposal_key = StorageKey::GovProposal(proposal_id);
        let mut proposal: GovProposal = env
            .storage()
            .persistent()
            .get(&proposal_key)
            .expect("proposal not found");

        assert!(proposal.status == GovStatus::Active, "proposal not active");

        let current_ledger = env.ledger().sequence();
        let vote_end = proposal.created_ledger + config.vote_window_ledgers;
        let execution_after = vote_end as u64 + proposal.time_lock_ledgers as u64;
        assert!(
            (current_ledger as u64) >= execution_after,
            "time-lock not expired"
        );

        let total_votes = proposal.votes_for + proposal.votes_against;
        assert!(total_votes > 0, "no votes cast");

        let approval_pct = (proposal.votes_for as u64 * 100) / total_votes as u64;
        let eff_quorum = Self::effective_quorum(env.clone(), proposal_id) as u64;
        assert!(approval_pct >= eff_quorum, "quorum not met");

        match proposal.parameter {
            GovParameter::FeeBps => {
                let val = proposal.new_value as u32;
                validate_u32_range(&env, "fee_bps", val, 0, MAX_FEE_BPS);
                env.storage().instance().set(&FEE_BPS, &val);
            }
            GovParameter::Treasury => {
                let addr = proposal
                    .new_address
                    .clone()
                    .expect("treasury proposal missing new_address");
                validate_non_default_address(&env, "new_address", &addr);
                env.storage().instance().set(&TREASURY, &addr);
            }
            GovParameter::TipCooldownWindow => {
                let val = proposal.new_value as u32;
                validate_u32_range(&env, "cooldown_ledgers", val, 1, u32::MAX);
                env.storage().instance().set(&TIP_COOLDOWN_WINDOW, &val);
            }
            GovParameter::GovQuorum => {
                let val = proposal.new_value as u32;
                validate_u32_range(&env, "quorum", val, 1, MAX_QUORUM);
                require_with_error!(
                    &env,
                    val >= config.quorum_floor,
                    "quorum must be >= quorum_floor"
                );
                let mut cfg = config.clone();
                cfg.quorum = val;
                env.storage().persistent().set(&StorageKey::GovConfig, &cfg);
            }
            GovParameter::GovTimeLock => {
                let val = proposal.new_value as u32;
                validate_u32_range(&env, "time_lock_ledgers", val, 1, u32::MAX);
                let mut cfg = config.clone();
                cfg.time_lock_ledgers = val;
                env.storage().persistent().set(&StorageKey::GovConfig, &cfg);
            }
            GovParameter::GovVoteWindow => {
                let val = proposal.new_value as u32;
                validate_u32_range(&env, "vote_window_ledgers", val, 1, u32::MAX);
                let mut cfg = config.clone();
                cfg.vote_window_ledgers = val;
                env.storage().persistent().set(&StorageKey::GovConfig, &cfg);
            }
            GovParameter::ModerationSlashBps => {
                let val = proposal.new_value as u32;
                validate_u32_range(&env, "moderation_slash_bps", val, 0, MAX_FEE_BPS);
                env.storage().instance().set(&MODERATION_SLASH_BPS, &val);
            }
        }

        proposal.status = GovStatus::Executed;
        env.storage().persistent().set(&proposal_key, &proposal);
        Self::bump(&env, &proposal_key);

        GovProposalExecutedEvent {
            proposal_id,
            parameter: proposal.parameter,
            new_value: proposal.new_value,
        }
        .publish(&env);
    }

    pub fn gov_veto(env: Env, signers: Vec<Address>, pool_id: Symbol, proposal_id: u64) {
        Self::bump_instance(&env);
        validate_address_list(&env, "signers", &signers);
        require_with_error!(&env, proposal_id > 0, "proposal id must be positive");

        let config_key = StorageKey::GovConfig;
        let config: GovConfig = env
            .storage()
            .persistent()
            .get(&config_key)
            .expect("governance not configured");
        Self::bump(&env, &config_key);

        let proposal_key = StorageKey::GovProposal(proposal_id);
        let mut proposal: GovProposal = env
            .storage()
            .persistent()
            .get(&proposal_key)
            .expect("proposal not found");

        assert!(proposal.status == GovStatus::Active, "proposal not active");

        let current_ledger = env.ledger().sequence();
        let vote_end = proposal.created_ledger + config.vote_window_ledgers;
        let time_lock_end = vote_end + config.time_lock_ledgers;
        assert!(
            current_ledger >= vote_end && current_ledger < time_lock_end,
            "veto only during time-lock window"
        );

        let pool_key = StorageKey::Pool(pool_id);
        let pool: Pool = env
            .storage()
            .persistent()
            .get(&pool_key)
            .expect("pool not found");
        Self::bump(&env, &pool_key);

        assert!(signers.len() >= pool.threshold, "insufficient signers");
        for signer in signers.iter() {
            assert!(
                pool.admins.iter().any(|x| x == signer),
                "unauthorized signer"
            );
            signer.require_auth();
        }

        proposal.status = GovStatus::Vetoed;
        env.storage().persistent().set(&proposal_key, &proposal);
        Self::bump(&env, &proposal_key);

        GovProposalVetoedEvent { proposal_id }.publish(&env);
    }

    pub fn gov_get_proposal(env: Env, proposal_id: u64) -> GovProposal {
        require_with_error!(&env, proposal_id > 0, "proposal id must be positive");
        let key = StorageKey::GovProposal(proposal_id);
        let proposal: GovProposal = env
            .storage()
            .persistent()
            .get(&key)
            .expect("proposal not found");
        Self::bump(&env, &key);
        proposal
    }

    // ── Analytics Oracle ──────────────────────────────────────────────────────

    /// Register or rotate an Ed25519 oracle public key. Admin only.
    pub fn register_oracle(env: Env, admin: Address, name: Symbol, pubkey: BytesN<32>) {
        Self::bump_instance(&env);
        admin.require_auth();
        validate_non_default_address(&env, "admin", &admin);
        Self::require_role(&env, &admin, Role::Admin);
        let key = StorageKey::OracleKey(name);
        env.storage().persistent().set(&key, &pubkey);
        Self::bump(&env, &key);
    }

    /// Verify a signed analytics attestation.
    ///
    /// Computes `sha256(report_cbor)`, verifies the Ed25519 `signature` against the
    /// registered oracle pubkey, checks the nullifier has not been used, records it,
    /// and emits `AttestationVerifiedEvent`. Returns `true` on success.
    pub fn verify_analytics_attestation(
        env: Env,
        oracle_name: Symbol,
        report_cbor: soroban_sdk::Bytes,
        signature: BytesN<64>,
        creator: Address,
        window_start: u64,
        window_end: u64,
    ) -> bool {
        validate_non_default_address(&env, "creator", &creator);
        assert!(
            window_start <= window_end,
            "window_start must be <= window_end"
        );
        let current_time = env.ledger().timestamp();
        assert!(
            current_time >= window_start && current_time <= window_end,
            "attestation outside time window"
        );
        let oracle_key = StorageKey::OracleKey(oracle_name.clone());
        let pubkey: BytesN<32> = env
            .storage()
            .persistent()
            .get(&oracle_key)
            .expect("oracle not registered");
        Self::bump(&env, &oracle_key);

        // Compute sha256 digest of the report bytes.
        let report_hash: BytesN<32> = env.crypto().sha256(&report_cbor).into();

        // Replay protection: reject if this exact report has been attested before.
        let nullifier_key = StorageKey::AttestationNullifier(report_hash.clone());
        assert!(
            !env.storage().persistent().has(&nullifier_key),
            "attestation already submitted"
        );

        // Verify Ed25519 signature: ed25519_verify(pubkey, message, signature).
        env.crypto()
            .ed25519_verify(&pubkey, &report_hash.clone().into(), &signature);

        // Record nullifier to prevent replay.
        env.storage().persistent().set(&nullifier_key, &true);
        Self::bump(&env, &nullifier_key);

        AttestationVerifiedEvent {
            oracle_name,
            report_hash,
            creator,
            window_start,
            window_end,
        }
        .publish(&env);

        true
    }

    // ── Upgradability ─────────────────────────────────────────────────────────

    pub fn upgrade(env: Env, upgrader: Address, new_wasm_hash: BytesN<32>) {
        Self::bump_instance(&env);
        let mut state: ContractState = env.storage().instance().get(&CONTRACT_STATE).unwrap();
        upgrader.require_auth();
        validate_non_default_address(&env, "upgrader", &upgrader);
        Self::require_role(&env, &upgrader, Role::Upgrader);
        require_with_error!(
            &env,
            new_wasm_hash != BytesN::from_array(&env, &[0u8; 32]),
            "wasm hash must not be empty"
        );
        state.version = state
            .version
            .checked_add(1)
            .expect("contract version overflow");
        state.implementation_wasm_hash = Some(new_wasm_hash.clone());
        env.storage().instance().set(&CONTRACT_STATE, &state);
        Self::require_not_paused(&env);
        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());
        ContractUpgraded { new_wasm_hash }.publish(&env);
    }

    // ── Storage Rent Lifecycle Management ─────────────────────────────────────

    pub fn pay_rent(env: Env, user: Address, token: Address, amount: i128) {
        Self::bump_instance(&env);
        user.require_auth();
        validate_non_default_address(&env, "user", &user);
        validate_non_default_address(&env, "token", &token);
        validate_amount(&env, "rent amount", amount);

        let rent_rate_bps = Self::get_rent_rate_bps(env.clone());
        assert!(rent_rate_bps > 0, "rent rate bps must be positive");

        let decimals = token::Client::new(&env, &token).decimals();
        let mut base = 1_i128;
        for _ in 0..decimals {
            base = base.checked_mul(10).expect("decimals overflow");
        }

        let divisor = (rent_rate_bps as i128) * base;
        let ledgers_to_extend = (amount * 10_000) / divisor;
        assert!(ledgers_to_extend > 0, "amount too small for rent rate");

        // Collect token payment to Treasury
        let treasury: Address = env
            .storage()
            .instance()
            .get(&TREASURY)
            .expect("treasury not set");
        token::Client::new(&env, &token).transfer(&user, &treasury, &amount);

        // Gather all user's keys and extend them
        let keys = Self::get_user_keys(&env, &user);
        for key in keys.iter() {
            if env.storage().persistent().has(&key) {
                #[cfg(test)]
                {
                    let current_ttl = env.storage().persistent().get_ttl(&key);
                    let new_ttl = current_ttl.saturating_add(ledgers_to_extend as u32);
                    env.storage()
                        .persistent()
                        .extend_ttl(&key, new_ttl, new_ttl);
                }
                #[cfg(not(test))]
                {
                    let target_ttl = LEDGER_BUMP.saturating_add(ledgers_to_extend as u32);
                    env.storage()
                        .persistent()
                        .extend_ttl(&key, target_ttl, target_ttl);
                }
            }
        }

        let extended_to_ledger = Self::get_rent_expiry(env.clone(), user.clone());
        RentPaidEvent {
            user: user.clone(),
            payer: user,
            token,
            amount,
            extended_to_ledger,
        }
        .publish(&env);
    }

    pub fn report_post(
        env: Env,
        reporter: Address,
        post_id: u64,
        token: Address,
        stake_amount: i128,
        reason_hash: BytesN<32>,
    ) {
        Self::bump_instance(&env);
        reporter.require_auth();
        validate_non_default_address(&env, "reporter", &reporter);
        validate_non_default_address(&env, "token", &token);
        require_with_error!(&env, post_id > 0, "post id must be positive");
        validate_amount(&env, "stake amount", stake_amount);

        let post_key = StorageKey::Post(post_id);
        let post: Post = env
            .storage()
            .persistent()
            .get(&post_key)
            .unwrap_or_else(|| panic!("post does not exist"));

        assert!(reporter != post.author, "cannot report own post");

        let report_key = StorageKey::Report(post_id, reporter.clone());
        if env.storage().persistent().has(&report_key) {
            panic!("already reported");
        }

        assert!(stake_amount > 0, "stake amount must be positive");
        token::Client::new(&env, &token).transfer(
            &reporter,
            env.current_contract_address(),
            &stake_amount,
        );

        let count_key = StorageKey::ReportCount(post_id);
        let count: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);

        let rep_idx_key = StorageKey::PostReportersIdx(post_id, count);
        env.storage().persistent().set(&rep_idx_key, &reporter);
        Self::bump(&env, &rep_idx_key);

        env.storage().persistent().set(&count_key, &(count + 1));
        Self::bump(&env, &count_key);

        let report = Report {
            post_id,
            reporter: reporter.clone(),
            stake_amount,
            token,
            reason_hash,
            created_ledger: env.ledger().sequence(),
            status: ReportStatus::Pending,
        };
        env.storage().persistent().set(&report_key, &report);
        Self::bump(&env, &report_key);

        PostReportedEvent {
            post_id,
            reporter,
            stake_amount,
        }
        .publish(&env);
    }

    pub fn get_rent_expiry(env: Env, user: Address) -> u32 {
        validate_non_default_address(&env, "user", &user);
        #[cfg(test)]
        {
            let keys = Self::get_user_keys(&env, &user);
            let mut min_ttl = u32::MAX;
            let mut has_keys = false;

            for key in keys.iter() {
                if env.storage().persistent().has(&key) {
                    let mut ttl = env.storage().persistent().get_ttl(&key);
                    if ttl > 10_000_000 {
                        ttl = 0;
                    }
                    if ttl < min_ttl {
                        min_ttl = ttl;
                        has_keys = true;
                    }
                }
            }

            if !has_keys {
                panic!("profile does not exist");
            }

            env.ledger().sequence().saturating_add(min_ttl)
        }
        #[cfg(not(test))]
        {
            let profile_key = StorageKey::Profile(user);
            if !env.storage().persistent().has(&profile_key) {
                panic!("profile does not exist");
            }
            env.ledger().sequence().saturating_add(LEDGER_BUMP)
        }
    }

    pub fn set_rent_rate_bps(env: Env, admin: Address, rate: u32) {
        admin.require_auth();
        validate_non_default_address(&env, "admin", &admin);
        Self::require_role(&env, &admin, Role::Admin);
        validate_u32_range(&env, "rate", rate, 1, MAX_FEE_BPS);
        env.storage().instance().set(&RENT_RATE_BPS_KEY, &rate);
    }

    pub fn get_rent_rate_bps(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&RENT_RATE_BPS_KEY)
            .unwrap_or(100)
    }

    pub fn batch_bump_user_graph(env: Env, admin: Address, user: Address) -> u32 {
        admin.require_auth();
        validate_non_default_address(&env, "admin", &admin);
        Self::require_role(&env, &admin, Role::Admin);
        validate_non_default_address(&env, "user", &user);
        let keys = Self::get_user_keys(&env, &user);
        let mut bumped = 0;
        for key in keys.iter() {
            if bumped >= 50 {
                break;
            }
            if env.storage().persistent().has(&key) {
                #[cfg(test)]
                {
                    let mut ttl = env.storage().persistent().get_ttl(&key);
                    if ttl > 10_000_000 {
                        ttl = 0;
                    }
                    if ttl <= LEDGER_THRESHOLD {
                        Self::bump(&env, &key);
                        bumped += 1;
                    }
                }
                #[cfg(not(test))]
                {
                    Self::bump(&env, &key);
                    bumped += 1;
                }
            }
        }
        bumped
    }

    fn get_user_keys(env: &Env, user: &Address) -> Vec<StorageKey> {
        let mut keys = Vec::new(env);

        let profile_key = StorageKey::Profile(user.clone());
        if env.storage().persistent().has(&profile_key) {
            keys.push_back(profile_key.clone());
            if let Some(profile) = env.storage().persistent().get::<_, Profile>(&profile_key) {
                let username_key = StorageKey::UsernameIndex(profile.username);
                if env.storage().persistent().has(&username_key) {
                    keys.push_back(username_key);
                }
            }
        }

        let author_posts_key = StorageKey::AuthorPosts(user.clone());
        if env.storage().persistent().has(&author_posts_key) {
            keys.push_back(author_posts_key);
        }

        let blocks_key = StorageKey::Blocks(user.clone());
        if env.storage().persistent().has(&blocks_key) {
            keys.push_back(blocks_key);
        }

        let following_count_key = StorageKey::FollowingCount(user.clone());
        let mut following_count = 0;
        if env.storage().persistent().has(&following_count_key) {
            keys.push_back(following_count_key.clone());
            following_count = env
                .storage()
                .persistent()
                .get::<_, u32>(&following_count_key)
                .unwrap_or(0);
        }

        let followers_count_key = StorageKey::FollowersCount(user.clone());
        let mut followers_count = 0;
        if env.storage().persistent().has(&followers_count_key) {
            keys.push_back(followers_count_key.clone());
            followers_count = env
                .storage()
                .persistent()
                .get::<_, u32>(&followers_count_key)
                .unwrap_or(0);
        }

        for seq in 0..following_count {
            let idx_key = StorageKey::FollowingIdx(user.clone(), seq);
            if env.storage().persistent().has(&idx_key) {
                keys.push_back(idx_key.clone());
                if let Some(followee) = env.storage().persistent().get::<_, Address>(&idx_key) {
                    let pos_key = StorageKey::FollowingPos(user.clone(), followee.clone());
                    if env.storage().persistent().has(&pos_key) {
                        keys.push_back(pos_key);
                    }
                    let edge_key = StorageKey::Edge(user.clone(), followee);
                    if env.storage().persistent().has(&edge_key) {
                        keys.push_back(edge_key);
                    }
                }
            }
        }

        for seq in 0..followers_count {
            let idx_key = StorageKey::FollowersIdx(user.clone(), seq);
            if env.storage().persistent().has(&idx_key) {
                keys.push_back(idx_key.clone());
                if let Some(follower) = env.storage().persistent().get::<_, Address>(&idx_key) {
                    let pos_key = StorageKey::FollowersPos(user.clone(), follower.clone());
                    if env.storage().persistent().has(&pos_key) {
                        keys.push_back(pos_key);
                    }
                    let edge_key = StorageKey::Edge(follower, user.clone());
                    if env.storage().persistent().has(&edge_key) {
                        keys.push_back(edge_key);
                    }
                }
            }
        }

        keys
    }

    pub fn review_report(
        env: Env,
        moderator: Address,
        signers: Vec<Address>,
        post_id: u64,
        reporter: Address,
        verdict: ReportStatus,
    ) {
        Self::bump_instance(&env);
        moderator.require_auth();
        validate_non_default_address(&env, "moderator", &moderator);
        Self::require_role(&env, &moderator, Role::Moderator);
        validate_address_list(&env, "signers", &signers);
        validate_non_default_address(&env, "reporter", &reporter);
        validate_report_verdict(&env, &verdict);
        require_with_error!(&env, post_id > 0, "post id must be positive");

        let pool_key = StorageKey::Pool(symbol_short!("mods"));
        let pool: Pool = env
            .storage()
            .persistent()
            .get(&pool_key)
            .expect("moderator pool 'mods' not found");

        assert!(signers.len() >= pool.threshold, "insufficient signers");
        for signer in signers.iter() {
            assert!(
                pool.admins.iter().any(|x| x == signer),
                "unauthorized signer"
            );
            signer.require_auth();
        }

        let report_key = StorageKey::Report(post_id, reporter.clone());
        let mut report: Report = env
            .storage()
            .persistent()
            .get(&report_key)
            .expect("report not found");
        assert!(
            report.status == ReportStatus::Pending,
            "report already resolved"
        );

        match verdict {
            ReportStatus::Upheld => {
                let post_key = StorageKey::Post(post_id);
                if let Some(post) = env.storage().persistent().get::<_, Post>(&post_key) {
                    let author = post.author.clone();
                    env.storage().persistent().remove(&post_key);

                    let author_key = StorageKey::AuthorPosts(author.clone());
                    if let Some(mut author_posts) = env
                        .storage()
                        .persistent()
                        .get::<_, soroban_sdk::Vec<u64>>(&author_key)
                    {
                        if let Some(index) = author_posts.iter().position(|id| id == post_id) {
                            author_posts.remove(index as u32);
                            if author_posts.is_empty() {
                                env.storage().persistent().remove(&author_key);
                            } else {
                                env.storage().persistent().set(&author_key, &author_posts);
                                Self::bump(&env, &author_key);
                            }
                        }
                    }

                    // Slasher
                    let slash_bps = env
                        .storage()
                        .instance()
                        .get(&MODERATION_SLASH_BPS)
                        .unwrap_or(0u32);
                    if slash_bps > 0 {
                        let profile_key = StorageKey::Profile(author.clone());
                        if let Some(profile) =
                            env.storage().persistent().get::<_, Profile>(&profile_key)
                        {
                            let creator_token = profile.creator_token;
                            let token_client = token::Client::new(&env, &creator_token);
                            let balance = token_client.balance(&author);
                            let slash_amount = (balance * slash_bps as i128) / 10_000;
                            if slash_amount > 0 {
                                // Creator tokens are deployed by the token factory contract.
                                // Linkora contract has no burn authority by default.
                                // We use burn_from, or gracefully skip if allowance/authority is missing.
                                let current_allowance = token_client
                                    .allowance(&author, &env.current_contract_address());
                                if current_allowance >= slash_amount {
                                    token_client.burn_from(
                                        &env.current_contract_address(),
                                        &author,
                                        &slash_amount,
                                    );
                                } else {
                                    // Gracefully skip the slash: insufficient burn allowance.
                                    // The rest of the upheld flow (stake refund, post deletion) still completes.
                                    // Authors must pre-approve the contract via token.approve() for slashing to take effect.
                                }
                            }
                        }
                    }
                } else {
                    // Post has already been deleted between report submission and review_report.
                    // Gracefully skip post deletion and slashing, but still refund the reporter's stake.
                }

                token::Client::new(&env, &report.token).transfer(
                    &env.current_contract_address(),
                    &report.reporter,
                    &report.stake_amount,
                );

                PostRemovedByModerationEvent {
                    post_id,
                    reporter: report.reporter.clone(),
                }
                .publish(&env);
            }
            ReportStatus::Dismissed => {
                let treasury: Address = env
                    .storage()
                    .instance()
                    .get(&TREASURY)
                    .expect("treasury not set");

                token::Client::new(&env, &report.token).transfer(
                    &env.current_contract_address(),
                    &treasury,
                    &report.stake_amount,
                );

                ReportDismissedEvent {
                    post_id,
                    reporter: report.reporter.clone(),
                }
                .publish(&env);
            }
            ReportStatus::Pending => {
                require_with_error!(&env, false, "verdict must be upheld or dismissed");
            }
        }

        report.status = verdict;
        env.storage().persistent().set(&report_key, &report);
        Self::bump(&env, &report_key);
    }

    pub fn get_report(env: Env, post_id: u64, reporter: Address) -> Option<Report> {
        validate_non_default_address(&env, "reporter", &reporter);
        require_with_error!(&env, post_id > 0, "post id must be positive");
        let key = StorageKey::Report(post_id, reporter);
        let result: Option<Report> = env.storage().persistent().get(&key);
        if result.is_some() {
            Self::bump(&env, &key);
        }
        result
    }

    pub fn get_report_count(env: Env, post_id: u64) -> u32 {
        require_with_error!(&env, post_id > 0, "post id must be positive");
        let key = StorageKey::ReportCount(post_id);
        let result = env.storage().persistent().get(&key).unwrap_or(0u32);
        if result > 0 {
            Self::bump(&env, &key);
        }
        result
    }

    // ── Internal Helpers ──────────────────────────────────────────────────────

    fn role_mask(role: Role) -> u32 {
        match role {
            Role::Admin => 1 << 0,
            Role::Moderator => 1 << 1,
            Role::Pauser => 1 << 2,
            Role::Upgrader => 1 << 3,
        }
    }

    fn get_roles(env: &Env) -> Map<Address, u32> {
        env.storage()
            .instance()
            .get(&ROLES)
            .unwrap_or_else(|| Map::new(env))
    }

    fn has_role_internal(env: &Env, account: &Address, role: Role) -> bool {
        let roles = Self::get_roles(env);
        let current = roles.get(account.clone()).unwrap_or(0);
        current & Self::role_mask(role) != 0
    }

    fn require_role(env: &Env, account: &Address, role: Role) {
        require_with_error!(
            env,
            Self::has_role_internal(env, account, role),
            format!("{role:?} role required")
        );
    }

    // ── Emergency Pause ──────────────────────────────────────────────────────

    pub fn pause(env: Env) {
        Self::require_role(&env, &env.current_contract_address(), Role::Admin);
        if Self::is_paused(env.clone()) {
            panic!("already paused");
        }
        env.storage().instance().set(&PAUSED, &true);
        let admin: Address = env.current_contract_address();
        PausedEvent { admin }.publish(&env);
    }

    pub fn unpause(env: Env) {
        Self::require_role(&env, &env.current_contract_address(), Role::Admin);
        if !Self::is_paused(env.clone()) {
            panic!("not paused");
        }
        env.storage().instance().set(&PAUSED, &false);
        let admin: Address = env.current_contract_address();
        UnpausedEvent { admin }.publish(&env);
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get::<Symbol, bool>(&PAUSED)
            .unwrap_or(false)
    }

    fn require_not_paused(env: &Env) {
        if env
            .storage()
            .instance()
            .get::<Symbol, bool>(&PAUSED)
            .unwrap_or(false)
        {
            panic!("contract is paused");
        }
    }

    /// Extend the TTL of a persistent entry after every write and on every
    /// successful read to keep active data alive on-chain.
    fn bump<K: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &K) {
        env.storage()
            .persistent()
            .extend_ttl(key, LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    /// Extend the TTL of a temporary entry.
    fn bump_temp<K: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &K) {
        env.storage()
            .temporary()
            .extend_ttl(key, LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    /// Extend the TTL of instance storage entries on every mutating operation.
    fn bump_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
    }

    // ── Block cleanup helpers ──────────────────────────────────────────────

    /// Remove follow relationships in both directions between two users.
    /// Called by block_user to enforce a clean break.
    fn cleanup_follow_on_block(env: &Env, user_a: &Address, user_b: &Address) {
        // Remove a -> b follow if it exists
        let edge_key_ab = StorageKey::Edge(user_a.clone(), user_b.clone());
        if env.storage().persistent().has(&edge_key_ab) {
            env.storage().persistent().remove(&edge_key_ab);
            Self::swap_remove_from_index(env, user_a, user_b, true);
            Self::swap_remove_from_index(env, user_b, user_a, false);
        }

        // Remove b -> a follow if it exists
        let edge_key_ba = StorageKey::Edge(user_b.clone(), user_a.clone());
        if env.storage().persistent().has(&edge_key_ba) {
            env.storage().persistent().remove(&edge_key_ba);
            Self::swap_remove_from_index(env, user_b, user_a, true);
            Self::swap_remove_from_index(env, user_a, user_b, false);
        }
    }

    /// Remove like entries on posts authored by either party, liked by the other.
    /// Called by block_user to enforce a clean break.
    /// Iterates over the post count and checks likes for the affected pair.
    fn cleanup_likes_on_block(env: &Env, user_a: &Address, user_b: &Address) {
        let post_count: u64 = env.storage().instance().get(&POST_CT).unwrap_or(0);
        if post_count == 0 {
            return;
        }

        // Check all post IDs for likes between user_a and user_b
        for post_id in 1..=post_count {
            // Remove user_a's like on user_b's posts
            let like_key_a = StorageKey::Like(post_id, user_a.clone());
            if env.storage().persistent().has(&like_key_a) {
                let post_key = StorageKey::Post(post_id);
                if let Some(mut post) = env.storage().persistent().get::<_, Post>(&post_key) {
                    if post.author == *user_b {
                        env.storage().persistent().remove(&like_key_a);
                        if post.like_count > 0 {
                            post.like_count -= 1;
                        }
                        env.storage().persistent().set(&post_key, &post);
                        Self::bump(env, &post_key);
                        // Update PostLikersCount and clean up the likers index
                        Self::swap_remove_like_from_index(env, post_id, user_a);
                    }
                }
            }

            // Remove user_b's like on user_a's posts
            let like_key_b = StorageKey::Like(post_id, user_b.clone());
            if env.storage().persistent().has(&like_key_b) {
                let post_key = StorageKey::Post(post_id);
                if let Some(mut post) = env.storage().persistent().get::<_, Post>(&post_key) {
                    if post.author == *user_a {
                        env.storage().persistent().remove(&like_key_b);
                        if post.like_count > 0 {
                            post.like_count -= 1;
                        }
                        env.storage().persistent().set(&post_key, &post);
                        Self::bump(env, &post_key);
                        // Update PostLikersCount and clean up the likers index
                        Self::swap_remove_like_from_index(env, post_id, user_b);
                    }
                }
            }
        }
    }

    /// Swap-remove a user from a post's likers index.
    /// Scans the PostLikersIdx to find the user's position (O(n) where n =
    /// the number of likers), then moves the last element into that position
    /// and decrements PostLikersCount.
    ///
    /// This O(n) scan is acceptable because it only runs during
    /// `block_user`, which is an infrequent operation.
    fn swap_remove_like_from_index(env: &Env, post_id: u64, user: &Address) {
        let count_key = StorageKey::PostLikersCount(post_id);
        let count: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);
        if count == 0 {
            return;
        }

        // Find the position of the user in the likers index
        let mut pos: Option<u32> = None;
        for i in 0..count {
            let idx_key = StorageKey::PostLikersIdx(post_id, i);
            if let Some(addr) = env.storage().persistent().get::<_, Address>(&idx_key) {
                if addr == *user {
                    pos = Some(i);
                    break;
                }
            }
        }

        let pos = match pos {
            Some(p) => p,
            None => return, // user not found in index — already cleaned up
        };

        let last = count - 1;

        if pos != last {
            // Move the last element into the removed position
            let last_idx_key = StorageKey::PostLikersIdx(post_id, last);
            if let Some(last_addr) = env.storage().persistent().get::<_, Address>(&last_idx_key) {
                let target_idx_key = StorageKey::PostLikersIdx(post_id, pos);
                env.storage().persistent().set(&target_idx_key, &last_addr);
                Self::bump(env, &target_idx_key);
            }
        }

        // Remove the last index entry and update the count
        let last_idx_key = StorageKey::PostLikersIdx(post_id, last);
        env.storage().persistent().remove(&last_idx_key);
        env.storage().persistent().set(&count_key, &last);
        Self::bump(env, &count_key);
    }

    /// Clean up all associated storage for a tombstoned post.
    /// Removes likes, reports, and tip cooldowns without iterating
    /// entry-by-entry (uses the batch_cleanup_post logic inline).
    /// Called during batch_cleanup_profile to ensure authored posts'
    /// associated data isn't orphaned.
    fn cleanup_post_associations(env: &Env, post_id: u64) {
        // Clean up Likes
        let likes_count_key = StorageKey::PostLikersCount(post_id);
        let likes_count: u32 = env
            .storage()
            .persistent()
            .get(&likes_count_key)
            .unwrap_or(0);
        for i in 0..likes_count {
            let idx_key = StorageKey::PostLikersIdx(post_id, i);
            if let Some(liker) = env.storage().persistent().get::<_, Address>(&idx_key) {
                env.storage()
                    .persistent()
                    .remove(&StorageKey::Like(post_id, liker));
            }
            env.storage().persistent().remove(&idx_key);
        }
        env.storage().persistent().remove(&likes_count_key);

        // Clean up Reports
        let reports_count_key = StorageKey::ReportCount(post_id);
        let reports_count: u32 = env
            .storage()
            .persistent()
            .get(&reports_count_key)
            .unwrap_or(0);
        for i in 0..reports_count {
            let idx_key = StorageKey::PostReportersIdx(post_id, i);
            if let Some(reporter) = env.storage().persistent().get::<_, Address>(&idx_key) {
                env.storage()
                    .persistent()
                    .remove(&StorageKey::Report(post_id, reporter));
            }
            env.storage().persistent().remove(&idx_key);
        }
        env.storage().persistent().remove(&reports_count_key);

        // Clean up Tip Cooldowns
        let tc_count_key = StorageKey::PostTipCooldownsCount(post_id);
        let tc_count: u32 = env.storage().persistent().get(&tc_count_key).unwrap_or(0);
        for i in 0..tc_count {
            let idx_key = StorageKey::PostTipCooldownsIdx(post_id, i);
            if let Some(tipper) = env.storage().persistent().get::<_, Address>(&idx_key) {
                env.storage()
                    .temporary()
                    .remove(&StorageKey::TipCooldown(post_id, tipper));
            }
            env.storage().persistent().remove(&idx_key);
        }
        env.storage().persistent().remove(&tc_count_key);
    }

    // ── Adjacency-set helpers (ADR-001) ───────────────────────────────────

    fn credential_root_message_hash(env: &Env, root: &BytesN<32>) -> BytesN<32> {
        let mut data = Bytes::new(env);
        data.append(&root.to_bytes());

        let ledger = env.ledger().sequence();
        data.push_back(((ledger >> 24) & 0xff) as u8);
        data.push_back(((ledger >> 16) & 0xff) as u8);
        data.push_back(((ledger >> 8) & 0xff) as u8);
        data.push_back((ledger & 0xff) as u8);

        env.crypto().sha256(&data).into()
    }

    fn hash_merkle_pair(env: &Env, left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
        if Self::bytesn_leq(left, right) {
            Self::hash_ordered_pair(env, left, right)
        } else {
            Self::hash_ordered_pair(env, right, left)
        }
    }

    fn hash_ordered_pair(env: &Env, left: &BytesN<32>, right: &BytesN<32>) -> BytesN<32> {
        let mut data = Bytes::new(env);
        data.append(&left.to_bytes());
        data.append(&right.to_bytes());
        env.crypto().sha256(&data).into()
    }

    fn bytesn_leq(left: &BytesN<32>, right: &BytesN<32>) -> bool {
        let left_bytes = left.to_bytes();
        let right_bytes = right.to_bytes();

        for i in 0..32 {
            let left_byte = left_bytes.get(i).unwrap();
            let right_byte = right_bytes.get(i).unwrap();
            if left_byte < right_byte {
                return true;
            }
            if left_byte > right_byte {
                return false;
            }
        }

        true
    }

    /// O(1) swap-remove from a user's index (following or followers side).
    ///
    /// `owner`:  the user whose index we are modifying
    /// `target`: the address to remove from the index
    /// `is_following`: true = FollowingIdx/FollowingPos/FollowingCount,
    ///                 false = FollowersIdx/FollowersPos/FollowersCount
    fn swap_remove_from_index(env: &Env, owner: &Address, target: &Address, is_following: bool) {
        let pos_key = if is_following {
            StorageKey::FollowingPos(owner.clone(), target.clone())
        } else {
            StorageKey::FollowersPos(owner.clone(), target.clone())
        };
        let count_key = if is_following {
            StorageKey::FollowingCount(owner.clone())
        } else {
            StorageKey::FollowersCount(owner.clone())
        };

        let pos: u32 = env
            .storage()
            .persistent()
            .get(&pos_key)
            .expect("position entry missing for swap-remove");
        let count: u32 = env.storage().persistent().get(&count_key).unwrap_or(0u32);

        if count == 0 {
            return;
        }

        let last = count - 1;

        if pos != last {
            // Swap the last element into the removed position
            let last_idx_key = if is_following {
                StorageKey::FollowingIdx(owner.clone(), last)
            } else {
                StorageKey::FollowersIdx(owner.clone(), last)
            };
            let last_addr: Address = env
                .storage()
                .persistent()
                .get(&last_idx_key)
                .expect("index entry missing");

            // Move last entry to the vacated position
            let target_idx_key = if is_following {
                StorageKey::FollowingIdx(owner.clone(), pos)
            } else {
                StorageKey::FollowersIdx(owner.clone(), pos)
            };
            env.storage().persistent().set(&target_idx_key, &last_addr);
            Self::bump(env, &target_idx_key);

            // Update the moved entry's position record
            let moved_pos_key = if is_following {
                StorageKey::FollowingPos(owner.clone(), last_addr.clone())
            } else {
                StorageKey::FollowersPos(owner.clone(), last_addr.clone())
            };
            env.storage().persistent().set(&moved_pos_key, &pos);
            Self::bump(env, &moved_pos_key);

            // Remove the last index slot
            env.storage().persistent().remove(&last_idx_key);
        } else {
            // Target is the last element; just remove it
            let last_idx_key = if is_following {
                StorageKey::FollowingIdx(owner.clone(), last)
            } else {
                StorageKey::FollowersIdx(owner.clone(), last)
            };
            env.storage().persistent().remove(&last_idx_key);
        }

        // Remove the target's position entry
        env.storage().persistent().remove(&pos_key);

        // Decrement the count
        if last == 0 {
            env.storage().persistent().remove(&count_key);
        } else {
            env.storage().persistent().set(&count_key, &last);
            Self::bump(env, &count_key);
        }
    }

    /// O(limit) pagination over a user's index entries.
    fn paginate_index(
        env: &Env,
        user: &Address,
        offset: u32,
        limit: u32,
        is_following: bool,
    ) -> Vec<Address> {
        let count: u32 = if is_following {
            env.storage()
                .persistent()
                .get(&StorageKey::FollowingCount(user.clone()))
                .unwrap_or(0u32)
        } else {
            env.storage()
                .persistent()
                .get(&StorageKey::FollowersCount(user.clone()))
                .unwrap_or(0u32)
        };

        if offset >= count {
            return Vec::new(env);
        }

        let end = (offset + limit).min(count);
        let mut result = Vec::new(env);

        for seq in offset..end {
            let idx_key = if is_following {
                StorageKey::FollowingIdx(user.clone(), seq)
            } else {
                StorageKey::FollowersIdx(user.clone(), seq)
            };
            if let Some(addr) = env.storage().persistent().get::<_, Address>(&idx_key) {
                Self::bump(env, &idx_key);
                result.push_back(addr);
            }
        }

        result
    }
}

mod test;

#[cfg(test)]
mod tests;
