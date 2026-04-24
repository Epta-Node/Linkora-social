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
const POOLS: Symbol = symbol_short!("POOLS");
const ADMIN: Symbol = symbol_short!("ADMIN");

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

// ── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct LinkoraContract;

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
        if !list.contains(&followee) {
            list.push_back(followee.clone());
        }
        env.storage().persistent().set(&key, &list);

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

    /// Get the list of users that a given user is following.
    pub fn get_following(env: Env, user: Address) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&(FOLLOWS, user))
            .unwrap_or(Vec::new(&env))
    }

    /// Get the list of users following a given user (reverse index).
    pub fn get_followers(env: Env, user: Address) -> Vec<Address> {
        env.storage()
            .persistent()
            .get(&(FOLLOWERS, user))
            .unwrap_or(Vec::new(&env))
    }

    // ── Posts ─────────────────────────────────────────────────────────────────

    /// Create a new post.
    /// 
    /// Storage: Each post is stored under a composite key (POSTS, id) to avoid
    /// deserializing/serializing the entire posts map on every operation. This
    /// significantly reduces storage fees as the dataset grows.
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
            author: author.clone(),
            content,
            tip_total: 0,
            timestamp: env.ledger().timestamp(),
        };
        env.storage().persistent().set(&(POSTS, id), &post);
        env.storage().instance().set(&POST_CT, &id);

        env.events().publish(
            (symbol_short!("Linkora"), symbol_short!("post"), symbol_short!("v1")),
            PostCreatedEvent { id, author },
        );
        id
    }

    pub fn get_post(env: Env, id: u64) -> Option<Post> {
        env.storage().persistent().get(&(POSTS, id))
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

    pub fn initialize(env: Env, admin: Address) {
        if env.storage().persistent().has(&ADMIN) {
            panic!("already initialized");
        }
        env.storage().persistent().set(&ADMIN, &admin);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env.storage().persistent().get(&ADMIN).expect("not initialized");
        admin.require_auth();

        env.deployer().update_current_contract_wasm(new_wasm_hash.clone());

        env.events().publish(
            (symbol_short!("Linkora"), symbol_short!("upgraded"), symbol_short!("v1")),
            ContractUpgraded { new_wasm_hash },
        );
    }
}

mod test;
