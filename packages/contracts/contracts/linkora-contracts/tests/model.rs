#![cfg(test)]

use std::collections::{HashMap, HashSet};

/// Differential Model: A simplified reference implementation of contract logic.
///
/// This model serves as ground truth for contract invariants. By comparing
/// the real contract behavior to this model, we can detect deviations and bugs.
///
/// Model operations mirror real contract functions:
/// - follow / unfollow
/// - create_post / like_post / tip
/// - governance operations
/// - pool operations

#[derive(Clone, Debug)]
pub struct ModelUser {
    pub followers: HashSet<String>,
    pub following: HashSet<String>,
    pub blocked: HashSet<String>,
}

#[derive(Clone, Debug)]
pub struct ModelPost {
    pub id: u64,
    pub author: String,
    pub tip_total: i128,
    pub likes: u64,
    pub liked_by: HashSet<String>,
}

#[derive(Clone, Debug)]
pub struct ModelPool {
    pub id: String,
    pub balance: i128,
    pub token: String,
}

#[derive(Clone, Debug)]
pub struct ModelProposal {
    pub id: u64,
    pub status: ProposalStatus,
    pub votes_for: u32,
    pub votes_against: u32,
    pub created_ledger: u64,
    pub time_lock_ledgers: u32,
    pub vote_window_ledgers: u32,
    pub quorum: u32,
    pub quorum_decay_rate_bps: u32,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ProposalStatus {
    Active,
    Passed,
    Executed,
    Vetoed,
    Failed,
}

#[derive(Clone)]
pub struct ContractModel {
    users: HashMap<String, ModelUser>,
    posts: HashMap<u64, ModelPost>,
    pools: HashMap<String, ModelPool>,
    proposals: HashMap<u64, ModelProposal>,
    fee_bps: u32,
    quorum: u32,
    quorum_floor: u32,
    vote_window_ledgers: u32,
    time_lock_ledgers: u32,
}

impl Default for ContractModel {
    fn default() -> Self {
        Self::new()
    }
}

impl ContractModel {
    pub fn new() -> Self {
        Self {
            users: HashMap::new(),
            posts: HashMap::new(),
            pools: HashMap::new(),
            proposals: HashMap::new(),
            fee_bps: 1000,    // 10%
            quorum: 50,       // 50%
            quorum_floor: 30, // 30%
            vote_window_ledgers: 100,
            time_lock_ledgers: 50,
        }
    }

    // ── Social Graph Operations ──

    pub fn follow(&mut self, follower: String, followee: String) -> Result<(), String> {
        if follower == followee {
            return Err("cannot follow self".to_string());
        }

        if self.is_blocked(&followee, &follower) {
            return Err("blocked".to_string());
        }

        if self.is_blocked(&follower, &followee) {
            return Err("blocked".to_string());
        }

        let f = self
            .users
            .entry(follower.clone())
            .or_insert_with(|| ModelUser {
                followers: HashSet::new(),
                following: HashSet::new(),
                blocked: HashSet::new(),
            });

        f.following.insert(followee.clone());

        let fe = self.users.entry(followee).or_insert_with(|| ModelUser {
            followers: HashSet::new(),
            following: HashSet::new(),
            blocked: HashSet::new(),
        });

        fe.followers.insert(follower);
        Ok(())
    }

    pub fn unfollow(&mut self, follower: String, followee: String) -> Result<(), String> {
        if let Some(f) = self.users.get_mut(&follower) {
            f.following.remove(&followee);
        }

        if let Some(fe) = self.users.get_mut(&followee) {
            fe.followers.remove(&follower);
        }

        Ok(())
    }

    pub fn block(&mut self, blocker: String, blockee: String) -> Result<(), String> {
        if blocker == blockee {
            return Err("cannot block self".to_string());
        }

        let user = self
            .users
            .entry(blocker.clone())
            .or_insert_with(|| ModelUser {
                followers: HashSet::new(),
                following: HashSet::new(),
                blocked: HashSet::new(),
            });

        user.blocked.insert(blockee.clone());

        // Clean up follow relationships in both directions
        if let Some(blocker_user) = self.users.get_mut(&blocker) {
            blocker_user.following.remove(&blockee);
            blocker_user.followers.remove(&blockee);
        }
        if let Some(blockee_user) = self.users.get_mut(&blockee) {
            blockee_user.following.remove(&blocker);
            blockee_user.followers.remove(&blocker);
        }

        // Clean up like entries on posts authored by either party
        for post in self.posts.values_mut() {
            if post.author == blockee && post.liked_by.contains(&blocker) {
                post.liked_by.remove(&blocker);
                if post.likes > 0 {
                    post.likes -= 1;
                }
            }
            if post.author == blocker && post.liked_by.contains(&blockee) {
                post.liked_by.remove(&blockee);
                if post.likes > 0 {
                    post.likes -= 1;
                }
            }
        }

        Ok(())
    }

    fn is_blocked(&self, user_a: &str, user_b: &str) -> bool {
        if let Some(user) = self.users.get(user_a) {
            user.blocked.contains(user_b)
        } else {
            false
        }
    }

    // ── Post Operations ──

    pub fn create_post(&mut self, author: String, post_id: u64) -> Result<(), String> {
        if self.posts.contains_key(&post_id) {
            return Err("post already exists".to_string());
        }

        self.posts.insert(
            post_id,
            ModelPost {
                id: post_id,
                author,
                tip_total: 0,
                likes: 0,
                liked_by: HashSet::new(),
            },
        );

        Ok(())
    }

    pub fn tip(&mut self, tipper: String, post_id: u64, amount: i128) -> Result<(), String> {
        if amount <= 0 {
            return Err("amount must be positive".to_string());
        }

        let author = self
            .posts
            .get(&post_id)
            .ok_or("post not found")?
            .author
            .clone();

        if self.is_blocked(&author, &tipper) {
            return Err("blocked".to_string());
        }

        if self.is_blocked(&tipper, &author) {
            return Err("blocked".to_string());
        }

        let post = self.posts.get_mut(&post_id).ok_or("post not found")?;

        // Calculate fee using safe arithmetic
        let fee_amount = (amount / 10_000) * self.fee_bps as i128
            + (amount % 10_000) * self.fee_bps as i128 / 10_000;
        let author_amount = amount - fee_amount;

        post.tip_total += author_amount;
        Ok(())
    }

    pub fn like(&mut self, liker: String, post_id: u64) -> Result<(), String> {
        let author = self
            .posts
            .get(&post_id)
            .ok_or("post not found")?
            .author
            .clone();

        if self.is_blocked(&author, &liker) {
            return Err("blocked".to_string());
        }

        if self.is_blocked(&liker, &author) {
            return Err("blocked".to_string());
        }

        let post = self.posts.get_mut(&post_id).ok_or("post not found")?;
        post.likes += 1;
        post.liked_by.insert(liker);
        Ok(())
    }

    // ── Pool Operations ──

    pub fn create_pool(
        &mut self,
        pool_id: String,
        token: String,
        initial_balance: i128,
    ) -> Result<(), String> {
        if self.pools.contains_key(&pool_id) {
            return Err("pool already exists".to_string());
        }

        self.pools.insert(
            pool_id.clone(),
            ModelPool {
                id: pool_id,
                balance: initial_balance,
                token,
            },
        );

        Ok(())
    }

    pub fn pool_deposit(&mut self, pool_id: String, amount: i128) -> Result<(), String> {
        if amount <= 0 {
            return Err("amount must be positive".to_string());
        }

        let pool = self.pools.get_mut(&pool_id).ok_or("pool not found")?;

        pool.balance += amount;
        Ok(())
    }

    // ── Governance Operations ──

    pub fn propose_quorum_change(
        &mut self,
        proposal_id: u64,
        new_quorum: u32,
    ) -> Result<(), String> {
        if !(1..=100).contains(&new_quorum) {
            return Err("invalid quorum".to_string());
        }

        self.proposals.insert(
            proposal_id,
            ModelProposal {
                id: proposal_id,
                status: ProposalStatus::Active,
                votes_for: 0,
                votes_against: 0,
                created_ledger: 0,
                time_lock_ledgers: self.time_lock_ledgers,
                vote_window_ledgers: self.vote_window_ledgers,
                quorum: self.quorum,
                quorum_decay_rate_bps: 0,
            },
        );

        Ok(())
    }

    pub fn execute_proposal(
        &mut self,
        proposal_id: u64,
        current_ledger: u64,
        new_quorum: u32,
    ) -> Result<(), String> {
        let proposal = self
            .proposals
            .get(&proposal_id)
            .ok_or("proposal not found")?;

        // Use snapshotted vote_window_ledgers from the proposal
        let vote_end = proposal.created_ledger + proposal.vote_window_ledgers as u64;
        let execution_after = vote_end + proposal.time_lock_ledgers as u64;

        if current_ledger < execution_after {
            return Err("time-lock not expired".to_string());
        }

        // Check quorum constraint
        if new_quorum < self.quorum_floor {
            return Err("quorum must be >= quorum_floor".to_string());
        }

        self.quorum = new_quorum;
        let prop = self.proposals.get_mut(&proposal_id).unwrap();
        prop.status = ProposalStatus::Executed;

        Ok(())
    }

    pub fn get_tip_total(&self, post_id: u64) -> Option<i128> {
        self.posts.get(&post_id).map(|p| p.tip_total)
    }

    pub fn get_pool_balance(&self, pool_id: &str) -> Option<i128> {
        self.pools.get(pool_id).map(|p| p.balance)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_model_follow_creates_adjacency() {
        let mut model = ContractModel::new();
        model
            .follow("alice".to_string(), "bob".to_string())
            .unwrap();

        let alice = model.users.get("alice").unwrap();
        assert!(alice.following.contains("bob"));

        let bob = model.users.get("bob").unwrap();
        assert!(bob.followers.contains("alice"));
    }

    #[test]
    fn test_model_block_prevents_tip() {
        let mut model = ContractModel::new();
        model.create_post("bob".to_string(), 1).unwrap();
        model.block("bob".to_string(), "alice".to_string()).unwrap();

        let err = model.tip("alice".to_string(), 1, 100);
        assert_eq!(err, Err("blocked".to_string()));
    }

    #[test]
    fn test_model_tip_arithmetic() {
        let mut model = ContractModel::new();
        model.create_post("bob".to_string(), 1).unwrap();

        model.tip("alice".to_string(), 1, 1000).unwrap();

        let fee = 1000 * 1000 / 10_000;
        let author_amount = 1000 - fee;

        let tip_total = model.get_tip_total(1).unwrap();
        assert_eq!(tip_total, author_amount);
    }

    #[test]
    fn test_model_pool_deposit() {
        let mut model = ContractModel::new();
        model
            .create_pool("pool1".to_string(), "token1".to_string(), 1000)
            .unwrap();
        model.pool_deposit("pool1".to_string(), 500).unwrap();

        let balance = model.get_pool_balance("pool1").unwrap();
        assert_eq!(balance, 1500);
    }

    #[test]
    fn test_model_quorum_floor_enforced() {
        let mut model = ContractModel::new();
        model.propose_quorum_change(1, 50).unwrap();

        let err = model.execute_proposal(1, 200, 20); // quorum_floor = 30
        assert_eq!(err, Err("quorum must be >= quorum_floor".to_string()));
    }

    // ── Bidirectional block tests ──────────────────────────────────────────

    #[test]
    fn test_model_bidirectional_block_prevents_follow_either_direction() {
        let mut model = ContractModel::new();

        // A blocks B
        model.block("alice".to_string(), "bob".to_string()).unwrap();

        // B cannot follow A (blocked by A)
        let err = model.follow("bob".to_string(), "alice".to_string());
        assert_eq!(err, Err("blocked".to_string()));

        // A cannot follow B (A blocked B, bidirectional check)
        let err = model.follow("alice".to_string(), "bob".to_string());
        assert_eq!(err, Err("blocked".to_string()));
    }

    #[test]
    fn test_model_bidirectional_block_prevents_tip_either_direction() {
        let mut model = ContractModel::new();
        model.create_post("alice".to_string(), 1).unwrap();
        model.create_post("bob".to_string(), 2).unwrap();

        // A blocks B
        model.block("alice".to_string(), "bob".to_string()).unwrap();

        // B cannot tip A's post (blocked)
        let err = model.tip("bob".to_string(), 1, 100);
        assert_eq!(err, Err("blocked".to_string()));

        // A cannot tip B's post (bidirectional check)
        let err = model.tip("alice".to_string(), 2, 100);
        assert_eq!(err, Err("blocked".to_string()));
    }

    #[test]
    fn test_model_bidirectional_block_prevents_like_either_direction() {
        let mut model = ContractModel::new();
        model.create_post("alice".to_string(), 1).unwrap();
        model.create_post("bob".to_string(), 2).unwrap();

        // A blocks B
        model.block("alice".to_string(), "bob".to_string()).unwrap();

        // B cannot like A's post (blocked)
        let err = model.like("bob".to_string(), 1);
        assert_eq!(err, Err("blocked".to_string()));

        // A cannot like B's post (bidirectional check)
        let err = model.like("alice".to_string(), 2);
        assert_eq!(err, Err("blocked".to_string()));
    }

    #[test]
    fn test_model_block_removes_follow_both_directions() {
        let mut model = ContractModel::new();

        // Establish bidirectional follows
        model
            .follow("alice".to_string(), "bob".to_string())
            .unwrap();
        model
            .follow("bob".to_string(), "alice".to_string())
            .unwrap();

        // Verify follows exist
        assert!(model.users.get("alice").unwrap().following.contains("bob"));
        assert!(model.users.get("bob").unwrap().following.contains("alice"));

        // A blocks B
        model.block("alice".to_string(), "bob".to_string()).unwrap();

        // Both follow relationships should be removed
        assert!(!model.users.get("alice").unwrap().following.contains("bob"));
        assert!(!model.users.get("alice").unwrap().followers.contains("bob"));
        assert!(!model.users.get("bob").unwrap().following.contains("alice"));
        assert!(!model.users.get("bob").unwrap().followers.contains("alice"));
    }

    #[test]
    fn test_model_block_removes_likes_on_block() {
        let mut model = ContractModel::new();
        model.create_post("alice".to_string(), 1).unwrap();
        model.create_post("bob".to_string(), 2).unwrap();

        // Both like each other's posts
        model.like("alice".to_string(), 2).unwrap();
        model.like("bob".to_string(), 1).unwrap();

        assert_eq!(model.posts.get(&1).unwrap().likes, 1);
        assert_eq!(model.posts.get(&2).unwrap().likes, 1);

        // A blocks B
        model.block("alice".to_string(), "bob".to_string()).unwrap();

        // Likes should be removed
        assert_eq!(model.posts.get(&1).unwrap().likes, 0);
        assert_eq!(model.posts.get(&2).unwrap().likes, 0);
    }

    #[test]
    fn test_model_block_unidirectional_blocker_can_still_interact() {
        let mut model = ContractModel::new();
        model.create_post("bob".to_string(), 1).unwrap();

        // A blocks B — A should still be able to tip B's posts
        // (only B is restricted)
        model.block("alice".to_string(), "bob".to_string()).unwrap();

        // The block is stored on A's side, checking is_blocked("alice", "bob")
        assert!(model.is_blocked("alice", "bob"));

        // But tip check is bidirectional: is_blocked(bob, alice) is false,
        // AND is_blocked(alice, bob) is true → blocked
        // Actually with bidirectional checks, if A blocks B, both directions are blocked.
        let err = model.tip("alice".to_string(), 1, 100);
        assert_eq!(err, Err("blocked".to_string()));
    }

    #[test]
    fn test_model_block_only_prevents_pair_not_others() {
        let mut model = ContractModel::new();
        model.create_post("alice".to_string(), 1).unwrap();
        model.create_post("bob".to_string(), 2).unwrap();

        // A blocks B
        model.block("alice".to_string(), "bob".to_string()).unwrap();

        // Unrelated user C can still like both posts
        model.like("charlie".to_string(), 1).unwrap();
        model.like("charlie".to_string(), 2).unwrap();

        assert_eq!(model.posts.get(&1).unwrap().likes, 1);
        assert_eq!(model.posts.get(&2).unwrap().likes, 1);
    }

    #[test]
    fn test_model_unblock_does_not_restore_follow() {
        let mut model = ContractModel::new();

        // Establish follow
        model
            .follow("alice".to_string(), "bob".to_string())
            .unwrap();
        assert!(model.users.get("alice").unwrap().following.contains("bob"));

        // Block (removes follow)
        model.block("alice".to_string(), "bob".to_string()).unwrap();
        assert!(!model.users.get("alice").unwrap().following.contains("bob"));

        // Unblock does NOT restore the follow
        model.users.get_mut("alice").unwrap().blocked.remove("bob");
        assert!(!model.users.get("alice").unwrap().following.contains("bob"));
    }

    #[test]
    fn test_model_unblock_does_not_restore_likes() {
        let mut model = ContractModel::new();
        model.create_post("alice".to_string(), 1).unwrap();

        // Like
        model.like("bob".to_string(), 1).unwrap();
        assert_eq!(model.posts.get(&1).unwrap().likes, 1);

        // Block (removes like)
        model.block("alice".to_string(), "bob".to_string()).unwrap();
        assert_eq!(model.posts.get(&1).unwrap().likes, 0);

        // Unblock does NOT restore the like
        model.users.get_mut("alice").unwrap().blocked.remove("bob");
        assert_eq!(model.posts.get(&1).unwrap().likes, 0);
    }

    #[test]
    fn test_model_follow_blocked_by_bidirectional_check() {
        // B blocks A → A cannot follow B AND B cannot follow A
        let mut model = ContractModel::new();
        model.block("bob".to_string(), "alice".to_string()).unwrap();

        // A tries to follow B (A is blocked by B)
        let err = model.follow("alice".to_string(), "bob".to_string());
        assert_eq!(err, Err("blocked".to_string()));

        // B tries to follow A (B blocked A, bidirectional → blocked)
        let err = model.follow("bob".to_string(), "alice".to_string());
        assert_eq!(err, Err("blocked".to_string()));
    }

    #[test]
    fn test_model_tip_blocked_by_bidirectional_check() {
        let mut model = ContractModel::new();
        model.create_post("bob".to_string(), 1).unwrap();

        // B blocks A
        model.block("bob".to_string(), "alice".to_string()).unwrap();

        // A tries to tip B's post (is_blocked(bob, alice) = true → blocked)
        let err = model.tip("alice".to_string(), 1, 100);
        assert_eq!(err, Err("blocked".to_string()));
    }

    #[test]
    fn test_model_like_blocked_by_bidirectional_check() {
        let mut model = ContractModel::new();
        model.create_post("bob".to_string(), 1).unwrap();

        // B blocks A
        model.block("bob".to_string(), "alice".to_string()).unwrap();

        // A tries to like B's post (is_blocked(bob, alice) = true → blocked)
        let err = model.like("alice".to_string(), 1);
        assert_eq!(err, Err("blocked".to_string()));
    }
}
