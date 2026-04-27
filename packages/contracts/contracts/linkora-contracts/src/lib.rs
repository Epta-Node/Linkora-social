#![no_std]
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, symbol_short, token, Address, BytesN,
    Env, Event, IntoVal, Map, String, Symbol, Vec, vec,
    contract, contractevent, contractimpl, contracttype, symbol_short, token, Address, BytesN, Env, Map,
    String, Symbol, Vec,
};

// ── Storage Keys ─────────────────────────────────────────────────────────────

// Typed storage key enum for type-safe persistent storage access
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StorageKey {
    Post(u64),
    Profile(Address),
    Following(Address),
    Followers(Address),
    Pool(Symbol),
    Like(u64, Address),
}

// Instance-level storage keys (simple Symbol keys)
const POST_CT: Symbol = symbol_short!("POST_CT");
const PROFILE_CT: Symbol = symbol_short!("PROF_CT");
const ADMIN: Symbol = symbol_short!("ADMIN");
const TREASURY: Symbol = symbol_short!("TREASURY");
const FEE_BPS: Symbol = symbol_short!("FEE_BPS");
const INITIALIZED: Symbol = symbol_short!("INIT");
const BLOCKS: Symbol = symbol_short!("BLOCKS");

#[contracttype]
pub enum StorageKey {
    Posts(u64),
    AuthorPosts(Address),
}

// ── TTL Constants ─────────────────────────────────────────────────────────────
//
// LEDGER_BUMP: target TTL (~30 days at 5s/ledger).
// LEDGER_THRESHOLD: extend only when remaining TTL falls below this value.

const LEDGER_BUMP: u32 = 535_000;
const LEDGER_THRESHOLD: u32 = 535_000 - 100;

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

#[contracttype]
#[derive(Clone)]
pub struct UnfollowEvent {
    pub follower: Address,
    pub followee: Address,
}

impl Event for UnfollowEvent {
    fn topics(&self, env: &Env) -> Vec<soroban_sdk::Val> {
        vec![
            &env,
            symbol_short!("Linkora").into_val(env),
            symbol_short!("unfollow").into_val(env),
            symbol_short!("v1").into_val(env),
        ]
    }

    fn data(&self, env: &Env) -> soroban_sdk::Val {
        self.clone().into_val(env)
    }
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
pub struct ContractUpgraded {
    pub new_wasm_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone)]
pub struct PostDeleted {
    pub post_id: u64,
    pub author: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct LikePostEvent {
    #[topic]
    pub user: Address,
    #[topic]
    pub post_id: u64,
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
        return Err("content cannot be empty");
    }
    if len > MAX_CONTENT_LEN {
        return Err("content too long");
    }
    Ok(())
}

#[contractimpl]
impl LinkoraContract {
    // ── Initialization ────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address, treasury: Address, fee_bps: u32) {
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
    }

    // ── Profiles ──────────────────────────────────────────────────────────────

    pub fn set_profile(env: Env, user: Address, username: String, creator_token: Address) {
        user.require_auth();
        validate_username(&username).expect("invalid username");

        let key = StorageKey::Profile(user.clone());
        if !env.storage().persistent().has(&key) {
            let count: u64 = env.storage().instance().get(&PROFILE_CT).unwrap_or(0);
            env.storage().instance().set(&PROFILE_CT, &(count + 1));
        }
        env.storage().persistent().set(
            &key,
            &Profile {
                address: user.clone(),
                username: username.clone(),
                creator_token,
            },
        );
        Self::bump(&env, &key);
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

    pub fn get_profile_count(env: Env) -> u64 {
        env.storage().instance().get(&PROFILE_CT).unwrap_or(0)
    }

    // ── Social Graph ──────────────────────────────────────────────────────────

    pub fn follow(env: Env, follower: Address, followee: Address) {
        follower.require_auth();

        if Self::is_blocked(env.clone(), followee.clone(), follower.clone()) {
            panic!("blocked");
        }

        let following_key = StorageKey::Following(follower.clone());
        let mut following_list: Vec<Address> = env
            .storage()
            .persistent()
            .get(&following_key)
            .unwrap_or(Vec::new(&env));

        if !following_list.iter().any(|x| x == followee) {
            following_list.push_back(followee.clone());
            env.storage()
                .persistent()
                .set(&following_key, &following_list);
            Self::bump(&env, &following_key);

            let followers_key = StorageKey::Followers(followee.clone());
            let mut followers_list: Vec<Address> = env
                .storage()
                .persistent()
                .get(&followers_key)
                .unwrap_or(Vec::new(&env));
            followers_list.push_back(follower.clone());
            env.storage()
                .persistent()
                .set(&followers_key, &followers_list);
            Self::bump(&env, &followers_key);
        }

        FollowEvent { follower, followee }.publish(&env);
    }

    pub fn unfollow(env: Env, follower: Address, followee: Address) {
        follower.require_auth();

        let following_key = StorageKey::Following(follower.clone());
        let mut following_list: Vec<Address> = env
            .storage()
            .persistent()
            .get(&following_key)
            .unwrap_or(Vec::new(&env));

        if let Some(index) = following_list.iter().position(|addr| addr == followee) {
            following_list.remove(index as u32);
            env.storage()
                .persistent()
                .set(&following_key, &following_list);
            Self::bump(&env, &following_key);

            let followers_key = StorageKey::Followers(followee.clone());
            let mut followers_list: Vec<Address> = env
                .storage()
                .persistent()
                .get(&followers_key)
                .unwrap_or(Vec::new(&env));
            if let Some(f_index) = followers_list.iter().position(|addr| addr == follower) {
                followers_list.remove(f_index as u32);
                env.storage()
                    .persistent()
                    .set(&followers_key, &followers_list);
                Self::bump(&env, &followers_key);
            }

            env.events()
                .publish_event(&UnfollowEvent { follower, followee });
        }
    }

    pub fn get_following(env: Env, user: Address) -> Vec<Address> {
        let key = StorageKey::Following(user);
        let result: Vec<Address> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env));
        if !result.is_empty() {
            Self::bump(&env, &key);
        }
        result
    }

    pub fn get_followers(env: Env, user: Address) -> Vec<Address> {
        let key = StorageKey::Followers(user);
        let result: Vec<Address> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env));
        if !result.is_empty() {
            Self::bump(&env, &key);
        }
        result
    }

    // ── Block List ────────────────────────────────────────────────────────────

    pub fn block_user(env: Env, blocker: Address, blocked: Address) {
        blocker.require_auth();
        let key = (BLOCKS, blocker.clone());
        let mut blocks: Map<Address, ()> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Map::new(&env));
        blocks.set(blocked, ());
        env.storage().persistent().set(&key, &blocks);
        Self::bump(&env, &key);
    }

    pub fn unblock_user(env: Env, blocker: Address, blocked: Address) {
        blocker.require_auth();
        let key = (BLOCKS, blocker.clone());
        let mut blocks: Map<Address, ()> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Map::new(&env));
        blocks.remove(blocked);
        env.storage().persistent().set(&key, &blocks);
        Self::bump(&env, &key);
    }

    pub fn is_blocked(env: Env, blocker: Address, blocked: Address) -> bool {
        let blocks: Map<Address, ()> = env
            .storage()
            .persistent()
            .get(&(BLOCKS, blocker))
            .unwrap_or(Map::new(&env));
        blocks.contains_key(blocked)
    }

    // ── Posts ─────────────────────────────────────────────────────────────────

    pub fn create_post(env: Env, author: Address, content: String) -> u64 {
        author.require_auth();
        validate_content(&content).expect("invalid content");

        let id: u64 = env.storage().instance().get(&POST_CT).unwrap_or(0u64) + 1;
        let key = StorageKey::Posts(id);
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

        let author_posts_key = StorageKey::AuthorPosts(author.clone());
        let mut author_posts: Vec<u64> = env
            .storage()
            .persistent()
            .get(&author_posts_key)
            .unwrap_or(Vec::new(&env));
        author_posts.push_back(id);
        env.storage().persistent().set(&author_posts_key, &author_posts);
        Self::bump(&env, &author_posts_key);

        env.storage().instance().set(&POST_CT, &id);
        PostCreatedEvent { id, author }.publish(&env);
        id
    }

    pub fn get_post_count(env: Env) -> u64 {
        env.storage().instance().get(&POST_CT).unwrap_or(0u64)
    }

    pub fn get_post(env: Env, id: u64) -> Option<Post> {
        let key = StorageKey::Posts(id);
        let key = StorageKey::Post(id);
        let result: Option<Post> = env.storage().persistent().get(&key);
        if result.is_some() {
            Self::bump(&env, &key);
        }
        result
    }

    pub fn get_posts_by_author(env: Env, author: Address) -> Vec<u64> {
        let key = StorageKey::AuthorPosts(author);
        let result: Vec<u64> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env));
        if !result.is_empty() {
            Self::bump(&env, &key);
        }
        result
    }

    pub fn delete_post(env: Env, author: Address, post_id: u64) {
        author.require_auth();
        let key = StorageKey::Posts(post_id);
        let key = StorageKey::Post(post_id);
        let post: Post = env.storage().persistent().get(&key).unwrap_or_else(|| {
            panic!("post does not exist: {}", post_id);
        });
        assert!(post.author == author, "only author can delete post");
        env.storage().persistent().remove(&key);

        let author_posts_key = StorageKey::AuthorPosts(author.clone());
        if let Some(mut author_posts) = env
            .storage()
            .persistent()
            .get::<_, Vec<u64>>(&author_posts_key)
        {
            if let Some(idx) = author_posts.iter().position(|id| id == post_id) {
                author_posts.remove(idx as u32);
                env.storage().persistent().set(&author_posts_key, &author_posts);
                Self::bump(&env, &author_posts_key);
            }
        }

        PostDeleted { post_id, author }.publish(&env);
        env.events().publish((symbol_short!("Linkora"), symbol_short!("post_del"), symbol_short!("v1")), PostDeleted { post_id, author });
    }

    // ── Reactions ─────────────────────────────────────────────────────────────

    pub fn like_post(env: Env, user: Address, post_id: u64) {
        user.require_auth();

        let like_key = StorageKey::Like(post_id, user.clone());
        if env.storage().persistent().has(&like_key) {
            return;
        }

        let post_key = StorageKey::Posts(post_id);
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
        let key = StorageKey::Posts(post_id);
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
        assert!(amount > 0, "tip amount must be positive");
        tipper.require_auth();

        let key = StorageKey::Posts(post_id);
        let key = StorageKey::Post(post_id);
        let mut post: Post = env.storage().persistent().get(&key).unwrap_or_else(|| {
            panic!("post not found: {}", post_id);
        });

        if Self::is_blocked(env.clone(), post.author.clone(), tipper.clone()) {
            panic!("blocked");
        }

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
        admin.require_auth();
        Self::require_admin(&env);
        let key = StorageKey::Pool(pool_id);
        assert!(!env.storage().persistent().has(&key), "pool exists");
        assert!(
            threshold > 0 && threshold <= initial_admins.len(),
            "invalid threshold"
        );
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
    }

    pub fn pool_deposit(
        env: Env,
        depositor: Address,
        pool_id: Symbol,
        token: Address,
        amount: i128,
    ) {
        assert!(amount > 0, "must be positive");
        depositor.require_auth();
        let key = StorageKey::Pool(pool_id.clone());
        let mut pool: Pool = env
            .storage()
            .persistent()
            .get(&key)
            .expect("pool not found");
        assert!(pool.token == token, "wrong token");

        let contract_address = env.current_contract_address();
        token::Client::new(&env, &token).transfer(&depositor, &contract_address, &amount);
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
        assert!(pool.balance >= amount, "insufficient pool balance");

        pool.balance -= amount;
        env.storage().persistent().set(&key, &pool);
        Self::bump(&env, &key);
        let contract_address = env.current_contract_address();
        token::Client::new(&env, &pool.token).transfer(&contract_address, &recipient, &amount);

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

    // ── Fee & Treasury ────────────────────────────────────────────────────────

    pub fn set_fee(env: Env, fee_bps: u32) {
        Self::require_admin(&env);
        assert!(fee_bps <= 10_000, "invalid fee");
        env.storage().instance().set(&FEE_BPS, &fee_bps);
    }

    pub fn set_treasury(env: Env, treasury: Address) {
        Self::require_admin(&env);
        env.storage().instance().set(&TREASURY, &treasury);
    }

    pub fn get_fee_bps(env: Env) -> u32 {
        env.storage().instance().get(&FEE_BPS).unwrap_or(0u32)
    }

    pub fn get_treasury(env: Env) -> Option<Address> {
        env.storage().instance().get(&TREASURY)
    }

    // ── Upgradability ─────────────────────────────────────────────────────────

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        Self::require_admin(&env);
        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());
        ContractUpgraded { new_wasm_hash }.publish(&env);
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
}

mod test;
