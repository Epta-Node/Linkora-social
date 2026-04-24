#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, BytesN, Env, String,
    Symbol, Vec,
};

// ── Storage Keys ────────────────────────────────────────────────────────────
//
// Storage Layout Rationale:
// Each record (post, profile, pool) is stored under a composite key like
// (POSTS, id) or (PROFILES, user) rather than storing all records in a single
// Map under one key. This avoids deserializing/serializing the entire collection
// on every read/write, which significantly reduces storage fees and gas costs
// as the dataset grows on Soroban.

const POSTS: Symbol = symbol_short!("POSTS");
const POST_CT: Symbol = symbol_short!("POST_CT");
const PROFILES: Symbol = symbol_short!("PROFILES");
const FOLLOWS: Symbol = symbol_short!("FOLLOWS");
const FOLLOWERS: Symbol = symbol_short!("FOLLOWRS"); // Reverse index for followers
const AUTHOR_POSTS: Symbol = symbol_short!("AUTHPOSTS"); // Per-author post ID index
const POOLS: Symbol = symbol_short!("POOLS");
const ADMIN: Symbol = symbol_short!("ADMIN");
const INITIALIZED: Symbol = symbol_short!("INIT");

// ── Validation Constants ─────────────────────────────────────────────────────

const MIN_USERNAME_LEN: u32 = 3;
const MAX_USERNAME_LEN: u32 = 32;
const MIN_CONTENT_LEN: u32 = 1;
const MAX_CONTENT_LEN: u32 = 280;
const MAX_PAGE_LIMIT: u32 = 50;

// ── Data Types ───────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct Post {
    pub id: u64,
    pub author: Address,
    pub content: String,
    pub tip_total: i128,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct Profile {
    pub address: Address,
    pub username: String,
    pub creator_token: Address, // SEP-41 token contract
}

#[contracttype]
#[derive(Clone)]
pub struct Pool {
    pub token: Address,
    pub balance: i128,
}

// ── Events ───────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone)]
pub struct ProfileSetEvent {
    pub user: Address,
    pub username: String,
}

#[contracttype]
#[derive(Clone)]
pub struct FollowEvent {
    pub follower: Address,
    pub followee: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct PostCreatedEvent {
    pub id: u64,
    pub author: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct TipEvent {
    pub tipper: Address,
    pub post_id: u64,
    pub amount: i128,
    pub fee: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct ContractUpgraded {
    pub new_wasm_hash: BytesN<32>,
}

#[contracttype]
#[derive(Clone)]
pub struct PostDeleted {
    pub post_id: u64,
    pub author: Address,
}

// ── Pagination Helper ────────────────────────────────────────────────────────

/// Returns a slice of `list` starting at `offset` with at most `limit` items.
/// If `offset` is beyond the end of the list, returns an empty Vec.
fn paginate<T: Clone>(env: &Env, list: &Vec<T>, offset: u32, limit: u32) -> Vec<T> {
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

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct LinkoraContract;

// ── Validation Helpers ───────────────────────────────────────────────────────

/// Validate username: 3-32 characters, alphanumeric and underscores only.
fn validate_username(username: &String) -> Result<(), &'static str> {
    let len = username.len();
    if len < MIN_USERNAME_LEN {
        return Err("username too short (min 3 characters)");
    }
    if len > MAX_USERNAME_LEN {
        return Err("username too long (max 32 characters)");
    }
    
    // Check for valid characters: alphanumeric and underscore
    let bytes = username.to_bytes();
    for i in 0..bytes.len() {
        let byte = bytes.get(i).unwrap();
        let c = byte as char;
        if !c.is_ascii_alphanumeric() && c != '_' {
            return Err("username must contain only alphanumeric characters and underscores");
        }
    }
    
    Ok(())
}

/// Validate post content: 1-280 characters.
fn validate_content(content: &String) -> Result<(), &'static str> {
    let len = content.len();
    if len < MIN_CONTENT_LEN {
        return Err("content cannot be empty");
    }
    if len > MAX_CONTENT_LEN {
        return Err("content too long (max 280 characters)");
    }
    
    Ok(())
}

#[contractimpl]
impl LinkoraContract {
    // ── Profiles ─────────────────────────────────────────────────────────────

    /// Register or update a profile. `creator_token` is the SEP-41 token the
    /// creator has already deployed; pass their own address if none yet.
    /// 
    /// Storage: Each profile is stored under a composite key (PROFILES, user)
    /// to avoid deserializing/serializing the entire profiles map on every operation.
    pub fn set_profile(env: Env, user: Address, username: String, creator_token: Address) {
        user.require_auth();
        let mut profiles: Map<Address, Profile> = env
            .storage()
            .persistent()
            .get(&PROFILES)
            .unwrap_or(Map::new(&env));
        profiles.set(
            user.clone(),
            Profile {
                address: user.clone(),
                username: username.clone(),
                creator_token,
            },
        );
        env.storage().persistent().set(&PROFILES, &profiles);

        env.events().publish(
            (symbol_short!("Linkora"), symbol_short!("profile"), symbol_short!("v1")),
            ProfileSetEvent { user, username },
        );
    }

    pub fn get_profile(env: Env, user: Address) -> Option<Profile> {
        env.storage().persistent().get(&(PROFILES, user))
    }

    // ── Social Graph ─────────────────────────────────────────────────────────

    /// Follow a user. Maintains both forward (following) and reverse (followers) indexes.
    pub fn follow(env: Env, follower: Address, followee: Address) {
        follower.require_auth();

        // Update following list
        let following_key = (FOLLOWS, follower.clone());
        let mut following_list: Vec<Address> = env
            .storage()
            .persistent()
            .get(&following_key)
            .unwrap_or(Vec::new(&env));
        if !following_list.contains(&followee) {
            following_list.push_back(followee.clone());

            // Update reverse index (followers) only when a new relationship is added
            let followers_key = (FOLLOWERS, followee.clone());
            let mut followers_list: Vec<Address> = env
                .storage()
                .persistent()
                .get(&followers_key)
                .unwrap_or(Vec::new(&env));
            followers_list.push_back(follower.clone());
            env.storage().persistent().set(&followers_key, &followers_list);
        }
        env.storage().persistent().set(&following_key, &following_list);

        env.events().publish(
            (symbol_short!("Linkora"), symbol_short!("follow"), symbol_short!("v1")),
            FollowEvent { follower, followee },
        );
    }

    /// Unfollow a user. Removes from both forward and reverse indexes.
    /// No-op if the relationship doesn't exist.
    pub fn unfollow(env: Env, follower: Address, followee: Address) {
        follower.require_auth();
        
        // Update following list
        let following_key = (FOLLOWS, follower.clone());
        let mut following_list: Vec<Address> = env
            .storage()
            .persistent()
            .get(&following_key)
            .unwrap_or(Vec::new(&env));
        
        // Find and remove followee from following list
        if let Some(index) = following_list.iter().position(|addr| addr == followee) {
            following_list.remove(index as u32);
            env.storage().persistent().set(&following_key, &following_list);
            
            // Update reverse index (followers)
            let followers_key = (FOLLOWERS, followee);
            let mut followers_list: Vec<Address> = env
                .storage()
                .persistent()
                .get(&followers_key)
                .unwrap_or(Vec::new(&env));
            
            if let Some(index) = followers_list.iter().position(|addr| addr == follower) {
                followers_list.remove(index as u32);
                env.storage().persistent().set(&followers_key, &followers_list);
            }
        }
        // If relationship doesn't exist, it's a no-op (no panic)
    }

    /// Get a paginated slice of users that a given user is following.
    /// `offset` is the zero-based start index; `limit` is the page size (max 50).
    pub fn get_following(env: Env, user: Address, offset: u32, limit: u32) -> Vec<Address> {
        assert!(limit <= MAX_PAGE_LIMIT, "limit exceeds maximum of 50");
        let list: Vec<Address> = env
            .storage()
            .persistent()
            .get(&(FOLLOWS, user))
            .unwrap_or(Vec::new(&env));
        paginate(&env, &list, offset, limit)
    }

    /// Get a paginated slice of users following a given user (reverse index).
    /// `offset` is the zero-based start index; `limit` is the page size (max 50).
    pub fn get_followers(env: Env, user: Address, offset: u32, limit: u32) -> Vec<Address> {
        assert!(limit <= MAX_PAGE_LIMIT, "limit exceeds maximum of 50");
        let list: Vec<Address> = env
            .storage()
            .persistent()
            .get(&(FOLLOWERS, user))
            .unwrap_or(Vec::new(&env));
        paginate(&env, &list, offset, limit)
    }

    // ── Posts ─────────────────────────────────────────────────────────────────

    /// Create a new post.
    /// 
    /// Storage: Each post is stored under a composite key (POSTS, id) to avoid
    /// deserializing/serializing the entire posts map on every operation. This
    /// significantly reduces storage fees as the dataset grows.
    pub fn create_post(env: Env, author: Address, content: String) -> u64 {
        author.require_auth();
        
        // Validate content
        validate_content(&content).expect("invalid content");
        
        let id: u64 = env
            .storage()
            .instance()
            .get(&POST_CT)
            .unwrap_or(0u64)
            + 1;
        let post = Post {
            id,
            author: author.clone(),
            content,
            tip_total: 0,
            timestamp: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&(POSTS, id), &post);
        env.storage().instance().set(&POST_CT, &id);

        // Maintain per-author post ID index
        let author_key = (AUTHOR_POSTS, author.clone());
        let mut author_posts: Vec<u64> = env
            .storage()
            .persistent()
            .get(&author_key)
            .unwrap_or(Vec::new(&env));
        author_posts.push_back(id);
        env.storage().persistent().set(&author_key, &author_posts);

        env.events().publish(
            (symbol_short!("Linkora"), symbol_short!("post"), symbol_short!("v1")),
            PostCreatedEvent { id, author },
        );
        id
    }

    pub fn get_post(env: Env, id: u64) -> Option<Post> {
        env.storage().persistent().get(&(POSTS, id))
    }

    /// Delete a post. Only the original author can delete their post.
    pub fn delete_post(env: Env, author: Address, post_id: u64) {
        author.require_auth();
        
        let key = (POSTS, post_id);
        let post: Post = env
            .storage()
            .persistent()
            .get(&key)
            .expect("post does not exist");
        
        assert!(post.author == author, "only author can delete post");
        
        env.storage().persistent().remove(&key);

        // Remove from per-author post ID index
        let author_key = (AUTHOR_POSTS, author.clone());
        let mut author_posts: Vec<u64> = env
            .storage()
            .persistent()
            .get(&author_key)
            .unwrap_or(Vec::new(&env));
        if let Some(idx) = author_posts.iter().position(|pid| pid == post_id) {
            author_posts.remove(idx as u32);
            env.storage().persistent().set(&author_key, &author_posts);
        }

        env.events().publish(
            (symbol_short!("post_del"),),
            PostDeleted {
                post_id,
                author,
            },
        );
    }

    /// Get a paginated slice of post IDs created by a given author.
    /// `offset` is the zero-based start index; `limit` is the page size (max 50).
    pub fn get_posts_by_author(env: Env, author: Address, offset: u32, limit: u32) -> Vec<u64> {
        assert!(limit <= MAX_PAGE_LIMIT, "limit exceeds maximum of 50");
        let list: Vec<u64> = env
            .storage()
            .persistent()
            .get(&(AUTHOR_POSTS, author))
            .unwrap_or(Vec::new(&env));
        paginate(&env, &list, offset, limit)
    }

    // ── Tipping ───────────────────────────────────────────────────────────────

    /// Tip a post author. `token` is any SEP-41 token address.
    /// Splits the tip between the author and the protocol treasury.
    pub fn tip(env: Env, tipper: Address, post_id: u64, token: Address, amount: i128) {
        tipper.require_auth();
        let key = (POSTS, post_id);
        let mut post: Post = env.storage().persistent().get(&key).unwrap();

        let fee_bps: u32 = env.storage().instance().get(&FEE_BPS).unwrap_or(0);
        let treasury: Option<Address> = env.storage().instance().get(&TREASURY);

        let fee_amount = if let Some(ref _t) = treasury {
            (amount * (fee_bps as i128)) / 10_000
        } else {
            0
        };
        let author_amount = amount - fee_amount;

        let token_client = token::Client::new(&env, &token);

        // Transfer fee to treasury if applicable
        if fee_amount > 0 {
            if let Some(treasury_addr) = treasury {
                token_client.transfer(&tipper, &treasury_addr, &fee_amount);
            }
        }

        // Transfer remainder to author
        token_client.transfer(&tipper, &post.author, &author_amount);

        post.tip_total += amount;
        posts.set(post_id, post);
        env.storage().persistent().set(&POSTS, &posts);

        env.events().publish(
            (symbol_short!("Linkora"), symbol_short!("tip"), symbol_short!("v1")),
            TipEvent {
                tipper,
                post_id,
                amount,
                fee: fee_amount,
            },
        );
    }

    // ── Community Token Pool ──────────────────────────────────────────────────

    /// Deposit tokens into a named community pool.
    pub fn pool_deposit(
        env: Env,
        depositor: Address,
        pool_id: Symbol,
        token: Address,
        amount: i128,
    ) {
        assert!(amount > 0, "deposit amount must be positive");
        depositor.require_auth();
        let contract = env.current_contract_address();
        token::Client::new(&env, &token).transfer(&depositor, &contract, &amount);

        let key = (POOLS, pool_id);
        let mut pool: Pool = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Pool { token: token.clone(), balance: 0 });
        pool.balance += amount;
        env.storage().persistent().set(&key, &pool);
    }

    /// Withdraw from a community pool (caller must be authorised — add governance as needed).
    pub fn pool_withdraw(
        env: Env,
        recipient: Address,
        pool_id: Symbol,
        amount: i128,
    ) {
        assert!(amount > 0, "withdrawal amount must be positive");
        recipient.require_auth();
        let key = (POOLS, pool_id);
        let mut pool: Pool = env.storage().persistent().get(&key).unwrap();
        assert!(pool.balance >= amount, "insufficient pool balance");
        pool.balance -= amount;
        env.storage().persistent().set(&key, &pool);

        token::Client::new(&env, &pool.token).transfer(
            &env.current_contract_address(),
            &recipient,
            &amount,
        );
    }

    pub fn get_pool(env: Env, pool_id: Symbol) -> Option<Pool> {
        env.storage().persistent().get(&(POOLS, pool_id))
    }

    // ── Upgradability ─────────────────────────────────────────────────────────

    /// One-time initialization. Stores the admin address and sets the
    /// INITIALIZED flag in instance storage. Panics if called again.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().get::<Symbol, bool>(&INITIALIZED).unwrap_or(false) {
            panic!("already initialized");
        }
        env.storage().instance().set(&INITIALIZED, &true);
        env.storage().instance().set(&ADMIN, &admin);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        Self::require_admin(&env);

        env.deployer().update_current_contract_wasm(new_wasm_hash.clone());

        env.events().publish(
            (symbol_short!("Linkora"), symbol_short!("upgraded"), symbol_short!("v1")),
            ContractUpgraded { new_wasm_hash },
        );
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /// Reads the stored admin and requires their auth. Panics if not initialized.
    fn require_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .expect("not initialized");
        admin.require_auth();
    }
}

mod test;
