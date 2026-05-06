#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, BytesN, Env, String,
    Symbol, Vec,
};

// ── Storage Keys ─────────────────────────────────────────────────────────────

const POSTS: Symbol = symbol_short!("POSTS");
const POST_CT: Symbol = symbol_short!("POST_CT");
const PROFILES: Symbol = symbol_short!("PROFILES");
const FOLLOWS: Symbol = symbol_short!("FOLLOWS");
const FOLLOWERS: Symbol = symbol_short!("FOLLOWRS");
const POOLS: Symbol = symbol_short!("POOLS");
const ADMIN: Symbol = symbol_short!("ADMIN");
const INITIALIZED: Symbol = symbol_short!("INIT");
const LIKES: Symbol = symbol_short!("LIKES");

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
#[derive(Clone)]
pub struct Post {
    pub id: u64,
    pub author: Address,
    pub content: String,
    pub tip_total: i128,
    pub timestamp: u64,
    pub like_count: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct Profile {
    pub address: Address,
    pub username: String,
    pub creator_token: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct Pool {
    pub token: Address,
    pub balance: i128,
    pub admins: Vec<Address>,
}

// ── Events ────────────────────────────────────────────────────────────────────

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

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct LinkoraContract;

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
    // ── Profiles ──────────────────────────────────────────────────────────────

    pub fn set_profile(env: Env, user: Address, username: String, creator_token: Address) {
        user.require_auth();
        validate_username(&username).expect("invalid username");

        let key = (PROFILES, user.clone());
        env.storage().persistent().set(
            &key,
            &Profile {
                address: user.clone(),
                username: username.clone(),
                creator_token,
            },
        );
        Self::bump(&env, &key);

        env.events().publish(
            (symbol_short!("Linkora"), symbol_short!("profile"), symbol_short!("v1")),
            ProfileSetEvent { user, username },
        );
    }

    pub fn get_profile(env: Env, user: Address) -> Option<Profile> {
        let key = (PROFILES, user);
        let result: Option<Profile> = env.storage().persistent().get(&key);
        if result.is_some() {
            Self::bump(&env, &key);
        }
        result
    }

    // ── Social Graph ──────────────────────────────────────────────────────────

    pub fn follow(env: Env, follower: Address, followee: Address) {
        follower.require_auth();

        let key = (FOLLOWS, follower.clone());
        let mut list: Vec<Address> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env));
        if !list.contains(&followee) {
            list.push_back(followee.clone());
            env.storage().persistent().set(&key, &list);
            Self::bump(&env, &key);
        }

        env.events().publish(
            (symbol_short!("Linkora"), symbol_short!("follow"), symbol_short!("v1")),
            FollowEvent { follower, followee },
        );
    }

    pub fn unfollow(env: Env, follower: Address, followee: Address) {
        follower.require_auth();

        let fwd_key = (FOLLOWS, follower.clone());
        let mut fwd: Vec<Address> = env
            .storage()
            .persistent()
            .get(&fwd_key)
            .unwrap_or(Vec::new(&env));

        if let Some(i) = fwd.iter().position(|a| a == followee) {
            fwd.remove(i as u32);
            env.storage().persistent().set(&fwd_key, &fwd);
            Self::bump(&env, &fwd_key);

            let rev_key = (FOLLOWERS, followee.clone());
            let mut rev: Vec<Address> = env
                .storage()
                .persistent()
                .get(&rev_key)
                .unwrap_or(Vec::new(&env));
            if let Some(j) = rev.iter().position(|a| a == follower) {
                rev.remove(j as u32);
                env.storage().persistent().set(&rev_key, &rev);
                Self::bump(&env, &rev_key);
            }
        }
    }

    pub fn get_following(env: Env, user: Address) -> Vec<Address> {
        let key = (FOLLOWS, user);
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
        let key = (FOLLOWERS, user);
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

    // ── Posts ─────────────────────────────────────────────────────────────────

    pub fn create_post(env: Env, author: Address, content: String) -> u64 {
        author.require_auth();
        validate_content(&content).expect("invalid content");

        let id: u64 = env.storage().instance().get(&POST_CT).unwrap_or(0u64) + 1;
        let key = (POSTS, id);
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

        env.events().publish(
            (symbol_short!("Linkora"), symbol_short!("post"), symbol_short!("v1")),
            PostCreatedEvent { id, author },
        );
        id
    }

    pub fn get_post_count(env: Env) -> u64 {
        env.storage().instance().get(&POST_CT).unwrap_or(0u64)
    }

    pub fn get_post(env: Env, id: u64) -> Option<Post> {
        let key = (POSTS, id);
        let result: Option<Post> = env.storage().persistent().get(&key);
        if result.is_some() {
            Self::bump(&env, &key);
        }
        result
    }

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
        env.events().publish(
            (symbol_short!("Linkora"), symbol_short!("post_del"), symbol_short!("v1")),
            PostDeleted { post_id, author },
        );
    }

    // ── Reactions ─────────────────────────────────────────────────────────────

    pub fn like_post(env: Env, user: Address, post_id: u64) {
        user.require_auth();

        let like_key = (LIKES, post_id, user.clone());
        if env.storage().persistent().has(&like_key) {
            return;
        }

        let post_key = (POSTS, post_id);
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
    }

    pub fn get_like_count(env: Env, post_id: u64) -> u64 {
        let key = (POSTS, post_id);
        let result: Option<Post> = env.storage().persistent().get(&key);
        result.map(|p| p.like_count).unwrap_or(0)
    }

    pub fn has_liked(env: Env, user: Address, post_id: u64) -> bool {
        let key = (LIKES, post_id, user);
        env.storage().persistent().has(&key)
    }

    // ── Tipping ───────────────────────────────────────────────────────────────

    pub fn tip(env: Env, tipper: Address, post_id: u64, token: Address, amount: i128) {
        assert!(amount > 0, "tip amount must be positive");
        tipper.require_auth();
        let key = (POSTS, post_id);
        let mut post: Post = env.storage().persistent().get(&key).expect("post not found");

        token::Client::new(&env, &token).transfer(&tipper, &post.author, &amount);

        post.tip_total += amount;
        env.storage().persistent().set(&key, &post);
        Self::bump(&env, &key);

        env.events().publish(
            (symbol_short!("Linkora"), symbol_short!("tip"), symbol_short!("v1")),
            TipEvent { tipper, post_id, amount },
        );
    }

    // ── Community Pool ────────────────────────────────────────────────────────

    pub fn create_pool(env: Env, pool_id: Symbol, token: Address, admins: Vec<Address>) {
        assert!(!admins.is_empty(), "pool must have at least one admin");
        let key = (POOLS, pool_id);
        assert!(
            !env.storage().persistent().has(&key),
            "pool already exists"
        );
        let pool = Pool {
            token,
            balance: 0,
            admins,
        };
        env.storage().persistent().set(&key, &pool);
        Self::bump(&env, &key);
    }

    pub fn pool_deposit(
        env: Env,
        depositor: Address,
        pool_id: Symbol,
        token: Address,
        amount: i128,
    ) {
        assert!(amount > 0, "deposit amount must be positive");
        depositor.require_auth();
        token::Client::new(&env, &token).transfer(
            &depositor,
            &env.current_contract_address(),
            &amount,
        );
        let key = (POOLS, pool_id);
        let mut pool: Pool = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Pool { token, balance: 0, admins: Vec::new(&env) });
        pool.balance += amount;
        env.storage().persistent().set(&key, &pool);
        Self::bump(&env, &key);
    }

    pub fn pool_withdraw(env: Env, recipient: Address, pool_id: Symbol, amount: i128) {
        assert!(amount > 0, "withdrawal amount must be positive");
        recipient.require_auth();
        let key = (POOLS, pool_id);
        let mut pool: Pool = env
            .storage()
            .persistent()
            .get(&key)
            .expect("pool not found");
        
        // Verify recipient is in the admin set
        assert!(
            pool.admins.iter().any(|admin| admin == &recipient),
            "only pool admins can withdraw"
        );
        
        assert!(pool.balance >= amount, "insufficient pool balance");
        pool.balance -= amount;
        env.storage().persistent().set(&key, &pool);
        Self::bump(&env, &key);
        token::Client::new(&env, &pool.token).transfer(
            &env.current_contract_address(),
            &recipient,
            &amount,
        );
    }

    pub fn get_pool(env: Env, pool_id: Symbol) -> Option<Pool> {
        let key = (POOLS, pool_id);
        let result: Option<Pool> = env.storage().persistent().get(&key);
        if result.is_some() {
            Self::bump(&env, &key);
        }
        result
    }

    // ── Upgradability ─────────────────────────────────────────────────────────

    pub fn initialize(env: Env, admin: Address) {
        if env
            .storage()
            .instance()
            .get::<Symbol, bool>(&INITIALIZED)
            .unwrap_or(false)
        {
            panic!("already initialized");
        }
        env.storage().instance().set(&INITIALIZED, &true);
        env.storage().instance().set(&ADMIN, &admin);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        Self::require_admin(&env);
        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());
        env.events().publish(
            (symbol_short!("Linkora"), symbol_short!("upgraded"), symbol_short!("v1")),
            ContractUpgraded { new_wasm_hash },
        );
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
