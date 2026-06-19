#![no_std]
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, symbol_short, token, Address, BytesN, Env,
    Map, String, Symbol, Vec,
};

// ── Storage Key Enum ──────────────────────────────────────────────────────────

#[contracttype]
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
    // ── Governance ────────────────────────────────────────────────────────
    GovProposal(u64),      // persistent: proposal_id -> GovProposal
    GovVote(u64, Address), // persistent: (proposal_id, voter) -> bool (prevents double-voting)
    GovConfig,             // persistent: governance configuration
    GovProposalCount,      // persistent: next proposal id counter
    Report(u64, Address),  // persistent: (post_id, reporter) -> Report
    ReportCount(u64),      // persistent: post_id -> u32 count of reports
}

// ── Instance-storage key constants (small scalars, not contracttype) ──────────

const POST_CT: Symbol = symbol_short!("POST_CT");
const PROFILE_CREATED_CT: Symbol = symbol_short!("PROF_CT");
const ADMIN: Symbol = symbol_short!("ADMIN");
const TREASURY: Symbol = symbol_short!("TREASURY");
const FEE_BPS: Symbol = symbol_short!("FEE_BPS");
const INITIALIZED: Symbol = symbol_short!("INIT");
const TIP_COOLDOWN_WINDOW: Symbol = symbol_short!("TIP_CD_W");
const MODERATION_SLASH_BPS: Symbol = symbol_short!("MOD_SL_B");

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

// ── Validation Constants ──────────────────────────────────────────────────────

const MIN_USERNAME_LEN: u32 = 3;
const MAX_USERNAME_LEN: u32 = 32;
const MIN_CONTENT_LEN: u32 = 1;
const MAX_CONTENT_LEN: u32 = 280;

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
pub struct PostDeleted {
    #[topic]
    pub post_id: u64,
    #[topic]
    pub author: Address,
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

fn validate_username(username: &String) -> Result<(), &'static str> {
    let len = username.len();
    if len < MIN_USERNAME_LEN {
        return Err("username too short");
    }
    if len > MAX_USERNAME_LEN {
        return Err("username too long");
    }
    let bytes = username.to_bytes();
    for i in 0..bytes.len() {
        let c = bytes.get(i).unwrap() as char;
        if !c.is_ascii_alphanumeric() && c != '_' {
            return Err("invalid username character");
        }
    }
    Ok(())
}

fn validate_content(content: &String) -> Result<(), &'static str> {
    let len = content.len();
    if len < MIN_CONTENT_LEN {
        return Err("empty content");
    }
    if len > MAX_CONTENT_LEN {
        return Err("content too long");
    }
    Ok(())
}

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
        assert!(fee_bps <= 10_000, "invalid fee");
        env.storage().instance().set(&INITIALIZED, &true);
        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&TREASURY, &treasury);
        env.storage().instance().set(&FEE_BPS, &fee_bps);
        env.storage()
            .instance()
            .set(&TIP_COOLDOWN_WINDOW, &TIP_COOLDOWN_LEDGERS);
        env.storage()
            .instance()
            .set(&MODERATION_SLASH_BPS, &0u32);
    }

    // ── Profiles ──────────────────────────────────────────────────────────────

    pub fn set_profile(env: Env, user: Address, username: String, creator_token: Address) {
        Self::bump_instance(&env);
        user.require_auth();
        validate_username(&username).expect("invalid username");

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
        let key = StorageKey::Profile(user);
        let result: Option<Profile> = env.storage().persistent().get(&key);
        if result.is_some() {
            Self::bump(&env, &key);
        }
        result
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
        let key = StorageKey::Profile(user.clone());
        let profile: Profile = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("profile does not exist"));

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
    }

    pub fn get_address_by_username(env: Env, username: String) -> Option<Address> {
        let key = StorageKey::UsernameIndex(username);
        let result: Option<Address> = env.storage().persistent().get(&key);
        if result.is_some() {
            Self::bump(&env, &key);
        }
        result
    }

    // ── DM Key Management ─────────────────────────────────────────────────────

    /// Publish a user's X25519 public key for encrypted direct messages.
    /// This key is separate from the Stellar signing key for security reasons.
    pub fn publish_dm_key(env: Env, user: Address, x25519_pubkey: BytesN<32>) {
        Self::bump_instance(&env);
        user.require_auth();

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

        if Self::is_blocked(env.clone(), followee.clone(), follower.clone()) {
            panic!("blocked");
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
        assert!(
            limit > 0 && limit <= MAX_PAGINATION_LIMIT,
            "limit must be between 1 and 50"
        );
        Self::paginate_index(&env, &user, offset, limit, true)
    }

    pub fn get_followers(env: Env, user: Address, offset: u32, limit: u32) -> Vec<Address> {
        assert!(
            limit > 0 && limit <= MAX_PAGE_LIMIT,
            "limit must be between 1 and 50"
        );
        Self::paginate_index(&env, &user, offset, limit, false)
    }

    /// Admin function to migrate users from the legacy Vec-based social graph
    /// to the new adjacency-set layout. Processable in chunks of up to 50
    /// users per call. Idempotent: already-migrated edges are skipped.
    pub fn migrate_follow_graph(env: Env, users: Vec<Address>) {
        Self::bump_instance(&env);
        Self::require_admin(&env);

        assert!(users.len() <= 50, "batch size must not exceed 50 users");

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
        let key = StorageKey::Blocks(blocker.clone());
        let mut blocks: Map<Address, ()> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Map::new(&env));
        blocks.set(blocked.clone(), ());
        env.storage().persistent().set(&key, &blocks);
        Self::bump(&env, &key);
        BlockEvent { blocker, blocked }.publish(&env);
    }

    pub fn unblock_user(env: Env, blocker: Address, blocked: Address) {
        Self::bump_instance(&env);
        blocker.require_auth();
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
        validate_content(&content).expect("invalid content");

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
        let key = StorageKey::Post(post_id);
        let post: Post = env.storage().persistent().get(&key).unwrap_or_else(|| {
            panic!("post does not exist: {}", post_id);
        });
        assert!(post.author == author, "only author can delete post");
        env.storage().persistent().remove(&key);

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

    pub fn get_posts_by_author(env: Env, author: Address, offset: u32, limit: u32) -> Vec<u64> {
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

        let like_key = StorageKey::Like(post_id, user.clone());
        if env.storage().persistent().has(&like_key) {
            return;
        }

        let post_key = StorageKey::Post(post_id);
        let mut post: Post = env
            .storage()
            .persistent()
            .get(&post_key)
            .expect("post not found");
        post.like_count += 1;
        env.storage().persistent().set(&post_key, &post);
        Self::bump(&env, &post_key);
        env.storage().persistent().set(&like_key, &true);
        Self::bump(&env, &like_key);
        LikePostEvent { user, post_id }.publish(&env);
    }

    pub fn get_like_count(env: Env, post_id: u64) -> u64 {
        let key = StorageKey::Post(post_id);
        let result: Option<Post> = env.storage().persistent().get(&key);
        result.map(|p| p.like_count).unwrap_or(0)
    }

    pub fn has_liked(env: Env, user: Address, post_id: u64) -> bool {
        let key = StorageKey::Like(post_id, user);
        env.storage().persistent().has(&key)
    }

    // ── Tipping ───────────────────────────────────────────────────────────────

    pub fn tip(env: Env, tipper: Address, post_id: u64, token: Address, amount: i128) {
        Self::bump_instance(&env);
        assert!(amount > 0, "tip amount must be positive");
        tipper.require_auth();

        let key = StorageKey::Post(post_id);
        let mut post: Post = env.storage().persistent().get(&key).unwrap_or_else(|| {
            panic!("post not found: {}", post_id);
        });

        if Self::is_blocked(env.clone(), post.author.clone(), tipper.clone()) {
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
        env.storage()
            .temporary()
            .set(&cooldown_key, &current_ledger);
        Self::bump_temp(&env, &cooldown_key);

        let fee_bps = Self::get_fee_bps(env.clone());
        let fee_amount = (amount * fee_bps as i128) / 10_000;
        let author_amount = amount - fee_amount;
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

        post.tip_total += amount;
        env.storage().persistent().set(&key, &post);
        Self::bump(&env, &key);

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
        Self::require_admin(&env);
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
        assert!(amount > 0, "must be positive");
        depositor.require_auth();
        let key = StorageKey::Pool(pool_id.clone());
        let mut pool: Pool = env
            .storage()
            .persistent()
            .get(&key)
            .expect("pool not found");
        assert!(pool.token == token, "wrong token for pool");

        token::Client::new(&env, &token).transfer(
            &depositor,
            env.current_contract_address(),
            &amount,
        );
        pool.balance += amount;
        env.storage().persistent().set(&key, &pool);
        Self::bump(&env, &key);

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
        assert!(amount > 0, "must be positive");
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
        assert!(threshold > 0, "threshold must be positive");
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

    pub fn set_fee(env: Env, fee_bps: u32) {
        Self::bump_instance(&env);
        Self::require_admin(&env);
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

    pub fn set_treasury(env: Env, treasury: Address) {
        Self::bump_instance(&env);
        Self::require_admin(&env);
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

    pub fn set_tip_cooldown_window(env: Env, cooldown_ledgers: u32) {
        Self::bump_instance(&env);
        Self::require_admin(&env);
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
        quorum: u32,
        time_lock_ledgers: u32,
        vote_window_ledgers: u32,
        quorum_decay_rate_bps: u32,
        quorum_floor: u32,
    ) {
        Self::bump_instance(&env);
        Self::require_admin(&env);
        assert!(quorum > 0 && quorum <= 100, "quorum must be 1-100");
        assert!(quorum_floor <= quorum, "floor must be <= quorum");
        assert!(time_lock_ledgers > 0, "time_lock must be positive");
        assert!(vote_window_ledgers > 0, "vote_window must be positive");

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

        if parameter == GovParameter::Treasury {
            assert!(
                new_address.is_some(),
                "treasury proposals require new_address"
            );
        }

        let config_key = StorageKey::GovConfig;
        let _config: GovConfig = env
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
        let execution_after = vote_end + config.time_lock_ledgers;
        assert!(current_ledger >= execution_after, "time-lock not expired");

        let total_votes = proposal.votes_for + proposal.votes_against;
        assert!(total_votes > 0, "no votes cast");

        let approval_pct = (proposal.votes_for as u64 * 100) / total_votes as u64;
        let eff_quorum = Self::effective_quorum(env.clone(), proposal_id) as u64;
        assert!(approval_pct >= eff_quorum, "quorum not met");

        match proposal.parameter {
            GovParameter::FeeBps => {
                let val = proposal.new_value as u32;
                assert!(val <= 10_000, "invalid fee");
                env.storage().instance().set(&FEE_BPS, &val);
            }
            GovParameter::Treasury => {
                let addr = proposal
                    .new_address
                    .clone()
                    .expect("treasury proposal missing new_address");
                env.storage().instance().set(&TREASURY, &addr);
            }
            GovParameter::TipCooldownWindow => {
                let val = proposal.new_value as u32;
                assert!(val > 0, "cooldown must be positive");
                env.storage().instance().set(&TIP_COOLDOWN_WINDOW, &val);
            }
            GovParameter::GovQuorum => {
                let val = proposal.new_value as u32;
                assert!(val > 0 && val <= 100, "quorum must be 1-100");
                let mut cfg = config.clone();
                cfg.quorum = val;
                env.storage().persistent().set(&StorageKey::GovConfig, &cfg);
            }
            GovParameter::GovTimeLock => {
                let val = proposal.new_value as u32;
                assert!(val > 0, "time_lock must be positive");
                let mut cfg = config.clone();
                cfg.time_lock_ledgers = val;
                env.storage().persistent().set(&StorageKey::GovConfig, &cfg);
            }
            GovParameter::GovVoteWindow => {
                let val = proposal.new_value as u32;
                assert!(val > 0, "vote_window must be positive");
                let mut cfg = config.clone();
                cfg.vote_window_ledgers = val;
                env.storage().persistent().set(&StorageKey::GovConfig, &cfg);
            }
            GovParameter::ModerationSlashBps => {
                let val = proposal.new_value as u32;
                assert!(val <= 10_000, "invalid slash bps");
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
        let key = StorageKey::GovProposal(proposal_id);
        let proposal: GovProposal = env
            .storage()
            .persistent()
            .get(&key)
            .expect("proposal not found");
        Self::bump(&env, &key);
        proposal
    }

    // ── Upgradability ─────────────────────────────────────────────────────────

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        Self::bump_instance(&env);
        Self::require_admin(&env);
        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());
        ContractUpgraded { new_wasm_hash }.publish(&env);
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
            &env.current_contract_address(),
            &stake_amount,
        );

        let count_key = StorageKey::ReportCount(post_id);
        let count: u32 = env.storage().persistent().get(&count_key).unwrap_or(0);
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

    pub fn review_report(
        env: Env,
        signers: Vec<Address>,
        post_id: u64,
        reporter: Address,
        verdict: ReportStatus,
    ) {
        Self::bump_instance(&env);
        assert!(verdict != ReportStatus::Pending, "invalid verdict");

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
        assert!(report.status == ReportStatus::Pending, "report already resolved");

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
                        if let Some(profile) = env.storage().persistent().get::<_, Profile>(&profile_key) {
                            let creator_token = profile.creator_token;
                            let token_client = token::Client::new(&env, &creator_token);
                            let balance = token_client.balance(&author);
                            let slash_amount = (balance * slash_bps as i128) / 10_000;
                            if slash_amount > 0 {
                                // Creator tokens are deployed by the token factory contract.
                                // Linkora contract has no burn authority by default.
                                // We use burn_from, or gracefully skip if allowance/authority is missing.
                                let current_allowance = token_client.allowance(&author, &env.current_contract_address());
                                if current_allowance >= slash_amount {
                                    token_client.burn_from(&env.current_contract_address(), &author, &slash_amount);
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
                panic!("invalid verdict");
            }
        }

        report.status = verdict;
        env.storage().persistent().set(&report_key, &report);
        Self::bump(&env, &report_key);
    }

    pub fn get_report(env: Env, post_id: u64, reporter: Address) -> Option<Report> {
        let key = StorageKey::Report(post_id, reporter);
        let result: Option<Report> = env.storage().persistent().get(&key);
        if result.is_some() {
            Self::bump(&env, &key);
        }
        result
    }

    pub fn get_report_count(env: Env, post_id: u64) -> u32 {
        let key = StorageKey::ReportCount(post_id);
        let result = env.storage().persistent().get(&key).unwrap_or(0u32);
        if result > 0 {
            Self::bump(&env, &key);
        }
        result
    }

    // ── Internal Helpers ──────────────────────────────────────────────────────

    fn require_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .expect("not initialized");
        admin.require_auth();
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

    // ── Adjacency-set helpers (ADR-001) ───────────────────────────────────

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
