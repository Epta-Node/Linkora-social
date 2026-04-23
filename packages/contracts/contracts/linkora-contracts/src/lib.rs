#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, Address, Env, Map, String, Symbol,
    Vec,
};

// ── Storage Keys ────────────────────────────────────────────────────────────

const POSTS: Symbol = symbol_short!("POSTS");
const POST_CT: Symbol = symbol_short!("POST_CT");
const PROFILES: Symbol = symbol_short!("PROFILES");
const FOLLOWS: Symbol = symbol_short!("FOLLOWS");
const POOLS: Symbol = symbol_short!("POOLS");

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

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct LinkoraContract;

#[contractimpl]
impl LinkoraContract {
    // ── Profiles ─────────────────────────────────────────────────────────────

    /// Register or update a profile. `creator_token` is the SEP-41 token the
    /// creator has already deployed; pass their own address if none yet.
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
                address: user,
                username,
                creator_token,
            },
        );
        env.storage().persistent().set(&PROFILES, &profiles);
    }

    pub fn get_profile(env: Env, user: Address) -> Option<Profile> {
        let profiles: Map<Address, Profile> = env
            .storage()
            .persistent()
            .get(&PROFILES)
            .unwrap_or(Map::new(&env));
        profiles.get(user)
    }

    // ── Social Graph ─────────────────────────────────────────────────────────

    pub fn follow(env: Env, follower: Address, followee: Address) {
        follower.require_auth();
        let key = (FOLLOWS, follower.clone());
        let mut list: Vec<Address> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env));
        if !list.contains(&followee) {
            list.push_back(followee);
        }
        env.storage().persistent().set(&key, &list);
    }

    pub fn get_following(env: Env, user: Address) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&(FOLLOWS, user))
            .unwrap_or(Vec::new(&env))
    }

    // ── Posts ─────────────────────────────────────────────────────────────────

    pub fn create_post(env: Env, author: Address, content: String) -> u64 {
        author.require_auth();
        let id: u64 = env
            .storage()
            .instance()
            .get(&POST_CT)
            .unwrap_or(0u64)
            + 1;
        let post = Post {
            id,
            author,
            content,
            tip_total: 0,
            timestamp: env.ledger().timestamp(),
        };
        let mut posts: Map<u64, Post> = env
            .storage()
            .persistent()
            .get(&POSTS)
            .unwrap_or(Map::new(&env));
        posts.set(id, post);
        env.storage().persistent().set(&POSTS, &posts);
        env.storage().instance().set(&POST_CT, &id);
        id
    }

    pub fn get_post(env: Env, id: u64) -> Option<Post> {
        let posts: Map<u64, Post> = env
            .storage()
            .persistent()
            .get(&POSTS)
            .unwrap_or(Map::new(&env));
        posts.get(id)
    }

    // ── Tipping ───────────────────────────────────────────────────────────────

    /// Tip a post author. `token` is any SEP-41 token address.
    pub fn tip(env: Env, tipper: Address, post_id: u64, token: Address, amount: i128) {
        tipper.require_auth();
        let mut posts: Map<u64, Post> = env
            .storage()
            .persistent()
            .get(&POSTS)
            .unwrap_or(Map::new(&env));
        let mut post = posts.get(post_id).unwrap();

        token::Client::new(&env, &token).transfer(
            &tipper,
            &post.author,
            &amount,
        );

        post.tip_total += amount;
        posts.set(post_id, post);
        env.storage().persistent().set(&POSTS, &posts);
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
        depositor.require_auth();
        assert!(amount > 0, "deposit amount must be positive");
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
}

mod test;
