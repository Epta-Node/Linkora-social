//! Governance appeal workflow (`appeal_removal` / `vote_appeal` /
//! `resolve_appeal`), Issue #1766, exercised against the compiled
//! LinkoraContract WASM.

use soroban_sdk::{
    contracttype,
    testutils::{Address as _, Events, Ledger},
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, BytesN, Env, IntoVal, String, Symbol, TryFromVal, Val, Vec,
};

const LINKORA_WASM: &[u8] = include_bytes!("../../linkora-contracts/linkora_contracts.wasm");

const START: u64 = 1_700_000_000;
const WEEK: u64 = 7 * 24 * 60 * 60;
/// `APPEAL_WINDOW_LEDGERS` in the contract.
const APPEAL_WINDOW_LEDGERS: u32 = 34_560;
const APPEAL_STAKE: i128 = 100;
const MODERATOR_SLASH: i128 = 300;
const MODERATOR_BOND: i128 = 1_000;

// ── Mirrors of the contract types (same XDR shape) ────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Role {
    Admin,
    Moderator,
    Pauser,
    Upgrader,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReportStatus {
    Pending,
    Dismissed,
    Upheld,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PauseModule {
    Posts,
    Tips,
    Pools,
    Governance,
    Credentials,
    Social,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GovAppealStatus {
    Voting,
    Passed,
    Failed,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GovAppeal {
    pub id: u64,
    pub post_id: u64,
    pub appellant: Address,
    pub moderator: Option<Address>,
    pub reason: String,
    pub stake_token: Address,
    pub stake_amount: i128,
    pub moderator_slash: i128,
    pub gov_token: Address,
    pub filed_at: u64,
    pub voting_ends_at: u64,
    pub votes_for: i128,
    pub votes_against: i128,
    pub status: GovAppealStatus,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppealVote {
    pub support: bool,
    pub weight: i128,
    pub withdrawn: bool,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModeratorBond {
    pub token: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppealConfig {
    pub gov_token: Address,
    pub stake_token: Address,
    pub appeal_stake: i128,
    pub moderator_slash: i128,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Post {
    pub id: u64,
    pub author: Address,
    pub content: String,
    pub tip_total: i128,
    pub timestamp: u64,
    pub like_count: u64,
}

// ── Harness ───────────────────────────────────────────────────────────────────

struct World {
    env: Env,
    linkora: Address,
    admin: Address,
    treasury: Address,
    author: Address,
    moderator: Address,
    stake: TokenClient<'static>,
    gov: TokenClient<'static>,
    gov_admin: StellarAssetClient<'static>,
    post_id: u64,
}

impl World {
    fn call<T: TryFromVal<Env, Val>>(&self, fn_name: &str, args: Vec<Val>) -> T {
        self.env
            .invoke_contract(&self.linkora, &Symbol::new(&self.env, fn_name), args)
    }

    /// True when the call fails (the contract panics). State changes made by
    /// a failed call are rolled back.
    fn fails(&self, fn_name: &str, args: Vec<Val>) -> bool {
        self.env
            .try_invoke_contract::<Val, soroban_sdk::Error>(
                &self.linkora,
                &Symbol::new(&self.env, fn_name),
                args,
            )
            .is_err()
    }

    fn appeal_removal(&self, appellant: &Address, reason: &str) -> u64 {
        self.call("appeal_removal", self.appeal_args(appellant, reason))
    }

    fn appeal_args(&self, appellant: &Address, reason: &str) -> Vec<Val> {
        (
            appellant.clone(),
            self.post_id,
            String::from_str(&self.env, reason),
        )
            .into_val(&self.env)
    }

    fn vote(&self, voter: &Address, appeal_id: u64, support: bool) {
        self.call::<()>(
            "vote_appeal",
            (voter.clone(), appeal_id, support).into_val(&self.env),
        )
    }

    fn vote_fails(&self, voter: &Address, appeal_id: u64, support: bool) -> bool {
        self.fails(
            "vote_appeal",
            (voter.clone(), appeal_id, support).into_val(&self.env),
        )
    }

    fn resolve(&self, appeal_id: u64) -> bool {
        self.call("resolve_appeal", (appeal_id,).into_val(&self.env))
    }

    fn resolve_fails(&self, appeal_id: u64) -> bool {
        self.fails("resolve_appeal", (appeal_id,).into_val(&self.env))
    }

    fn appeal(&self, appeal_id: u64) -> GovAppeal {
        let appeal: Option<GovAppeal> =
            self.call("get_gov_appeal", (appeal_id,).into_val(&self.env));
        appeal.expect("appeal exists")
    }

    fn get_post(&self) -> Option<Post> {
        self.call("get_post", (self.post_id,).into_val(&self.env))
    }

    fn posts_by_author(&self) -> Vec<u64> {
        self.call(
            "get_posts_by_author",
            (self.author.clone(), 0u32, 50u32).into_val(&self.env),
        )
    }

    fn bond(&self) -> Option<ModeratorBond> {
        self.call(
            "get_moderator_bond",
            (self.moderator.clone(),).into_val(&self.env),
        )
    }

    /// A governance token holder with `balance` tokens.
    fn holder(&self, balance: i128) -> Address {
        let who = Address::generate(&self.env);
        self.gov_admin.mint(&who, &balance);
        who
    }

    fn set_time(&self, t: u64) {
        self.env.ledger().set_timestamp(t);
    }

    /// Whether the last invocation emitted a Linkora event named `name`
    /// (its first topic).
    fn has_event(&self, name: &str) -> bool {
        use soroban_sdk::xdr::{ContractEventBody, ScSymbol, ScVal};
        let expected = ScVal::Symbol(ScSymbol(name.try_into().unwrap()));
        self.env.events().all().events().iter().any(|e| {
            let ContractEventBody::V0(body) = &e.body;
            body.topics.first() == Some(&expected)
        })
    }
}

fn token<'a>(env: &Env) -> (TokenClient<'a>, StellarAssetClient<'a>) {
    let id = env
        .register_stellar_asset_contract_v2(Address::generate(env))
        .address();
    (
        TokenClient::new(env, &id),
        StellarAssetClient::new(env, &id),
    )
}

/// Linkora with a post by `author` that a moderator removed after a report,
/// the appeal workflow configured and the moderator bonded.
fn world() -> World {
    world_with(APPEAL_STAKE, MODERATOR_SLASH, MODERATOR_BOND)
}

fn world_with(appeal_stake: i128, moderator_slash: i128, bond: i128) -> World {
    build_world(Some((appeal_stake, moderator_slash, bond)))
}

/// `appeals`: (appeal stake, moderator slash, moderator bond), or `None` to
/// leave the appeal workflow unconfigured.
fn build_world(appeals: Option<(i128, i128, i128)>) -> World {
    let env = Env::default();
    env.mock_all_auths();
    // The Linkora WASM exceeds the network's 128 KiB code limit (a known
    // upstream issue); lift the test limits so it can run.
    env.cost_estimate().budget().reset_unlimited();
    env.cost_estimate().disable_resource_limits();
    env.ledger().set_timestamp(START);
    env.ledger().set_sequence_number(1_000);

    let linkora = env.register(LINKORA_WASM, ());
    let (stake, stake_admin) = token(&env);
    let (gov, gov_admin) = token(&env);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let author = Address::generate(&env);
    let moderator = Address::generate(&env);
    let reporter = Address::generate(&env);
    // `mods` pool member co-signing the moderator's verdict.
    let pool_signer = Address::generate(&env);
    stake_admin.mint(&author, &10_000);
    stake_admin.mint(&reporter, &10_000);
    stake_admin.mint(&moderator, &10_000);

    let w = World {
        env,
        linkora,
        admin,
        treasury,
        author,
        moderator,
        stake,
        gov,
        gov_admin,
        post_id: 0,
    };
    let env = &w.env;

    w.call::<()>(
        "initialize",
        (w.admin.clone(), w.treasury.clone(), 0u32).into_val(env),
    );
    w.call::<()>(
        "grant_role",
        (w.admin.clone(), w.moderator.clone(), Role::Moderator).into_val(env),
    );
    w.call::<()>(
        "create_pool",
        (
            w.admin.clone(),
            Symbol::new(env, "mods"),
            w.stake.address.clone(),
            vec![env, pool_signer.clone()],
            1u32,
        )
            .into_val(env),
    );
    let post_id: u64 = w.call(
        "create_post",
        (w.author.clone(), String::from_str(env, "a post")).into_val(env),
    );
    w.call::<()>(
        "report_post",
        (
            reporter.clone(),
            post_id,
            w.stake.address.clone(),
            50i128,
            BytesN::from_array(env, &[7u8; 32]),
        )
            .into_val(env),
    );
    w.call::<()>(
        "review_report",
        (
            w.moderator.clone(),
            vec![env, pool_signer.clone()],
            post_id,
            reporter,
            ReportStatus::Upheld,
        )
            .into_val(env),
    );
    if let Some((appeal_stake, moderator_slash, bond)) = appeals {
        w.call::<()>(
            "set_appeal_config",
            (
                w.admin.clone(),
                w.gov.address.clone(),
                w.stake.address.clone(),
                appeal_stake,
                moderator_slash,
            )
                .into_val(env),
        );
        if bond > 0 {
            w.call::<()>(
                "stake_moderator_bond",
                (w.moderator.clone(), bond).into_val(env),
            );
        }
    }

    World { post_id, ..w }
}

// ── Filing ────────────────────────────────────────────────────────────────────

#[test]
fn test_removed_post_is_gone_before_the_appeal() {
    let w = world();
    assert_eq!(w.get_post(), None);
    assert!(!w.posts_by_author().contains(w.post_id));
}

#[test]
fn test_author_files_appeal() {
    let w = world();
    let id = w.appeal_removal(&w.author, "this was satire");
    assert!(w.has_event("appeal_filed"));

    let appeal = w.appeal(id);
    assert_eq!(
        appeal,
        GovAppeal {
            id,
            post_id: w.post_id,
            appellant: w.author.clone(),
            moderator: Some(w.moderator.clone()),
            reason: String::from_str(&w.env, "this was satire"),
            stake_token: w.stake.address.clone(),
            stake_amount: APPEAL_STAKE,
            moderator_slash: MODERATOR_SLASH,
            gov_token: w.gov.address.clone(),
            filed_at: START,
            voting_ends_at: START + WEEK,
            votes_for: 0,
            votes_against: 0,
            status: GovAppealStatus::Voting,
        }
    );
    let by_post: Option<u64> = w.call("get_post_gov_appeal", (w.post_id,).into_val(&w.env));
    assert_eq!(by_post, Some(id));
    // The stake is held by the contract.
    assert_eq!(w.stake.balance(&w.author), 10_000 - APPEAL_STAKE);
}

#[test]
fn test_only_the_author_can_appeal() {
    let w = world();
    let stranger = Address::generate(&w.env);
    assert!(w.fails("appeal_removal", w.appeal_args(&stranger, "mine")));
    assert!(w.fails("appeal_removal", w.appeal_args(&w.moderator, "mine")));
}

#[test]
fn test_one_appeal_per_post() {
    let w = world();
    w.appeal_removal(&w.author, "first");
    assert!(w.fails("appeal_removal", w.appeal_args(&w.author, "second")));
    // The moderator-reviewed appeal is blocked too.
    assert!(w.fails(
        "appeal_moderation",
        (
            w.author.clone(),
            w.post_id,
            BytesN::from_array(&w.env, &[1u8; 32])
        )
            .into_val(&w.env),
    ));
}

#[test]
fn test_no_governance_appeal_after_a_moderator_appeal() {
    let w = world();
    w.call::<()>(
        "appeal_moderation",
        (
            w.author.clone(),
            w.post_id,
            BytesN::from_array(&w.env, &[1u8; 32]),
        )
            .into_val(&w.env),
    );
    assert!(w.fails("appeal_removal", w.appeal_args(&w.author, "again")));
}

#[test]
fn test_appeal_window_is_enforced() {
    let w = world();
    w.env
        .ledger()
        .set_sequence_number(1_000 + APPEAL_WINDOW_LEDGERS + 1);
    assert!(w.fails("appeal_removal", w.appeal_args(&w.author, "late")));

    w.env
        .ledger()
        .set_sequence_number(1_000 + APPEAL_WINDOW_LEDGERS);
    w.appeal_removal(&w.author, "just in time");
}

#[test]
fn test_reason_must_be_given_and_bounded() {
    let w = world();
    assert!(w.fails("appeal_removal", w.appeal_args(&w.author, "")));
    let long = "x".repeat(501);
    assert!(w.fails("appeal_removal", w.appeal_args(&w.author, &long)));
    let max = "x".repeat(500);
    w.appeal_removal(&w.author, &max);
}

#[test]
fn test_cannot_appeal_a_post_that_was_not_removed() {
    let w = world();
    let other: u64 = w.call(
        "create_post",
        (w.author.clone(), String::from_str(&w.env, "fine")).into_val(&w.env),
    );
    assert!(w.fails(
        "appeal_removal",
        (w.author.clone(), other, String::from_str(&w.env, "?")).into_val(&w.env),
    ));
}

#[test]
fn test_requires_appeal_config() {
    let w = build_world(None);
    let config: Option<AppealConfig> = w.call("get_appeal_config", Vec::new(&w.env));
    assert_eq!(config, None);
    assert!(w.fails("appeal_removal", w.appeal_args(&w.author, "why")));
    assert!(w.fails(
        "stake_moderator_bond",
        (w.moderator.clone(), 10i128).into_val(&w.env)
    ));
}

#[test]
fn test_only_admin_configures_appeals() {
    let w = world();
    let config: Option<AppealConfig> = w.call("get_appeal_config", Vec::new(&w.env));
    assert_eq!(
        config,
        Some(AppealConfig {
            gov_token: w.gov.address.clone(),
            stake_token: w.stake.address.clone(),
            appeal_stake: APPEAL_STAKE,
            moderator_slash: MODERATOR_SLASH,
        })
    );
    let stranger = Address::generate(&w.env);
    assert!(w.fails(
        "set_appeal_config",
        (
            stranger,
            w.gov.address.clone(),
            w.stake.address.clone(),
            1i128,
            1i128
        )
            .into_val(&w.env),
    ));
    assert!(w.fails(
        "set_appeal_config",
        (
            w.admin.clone(),
            w.gov.address.clone(),
            w.stake.address.clone(),
            -1i128,
            1i128
        )
            .into_val(&w.env),
    ));
}

// ── Voting ────────────────────────────────────────────────────────────────────

#[test]
fn test_votes_are_weighted_by_token_balance() {
    let w = world();
    let id = w.appeal_removal(&w.author, "please");
    let alice = w.holder(600);
    let bob = w.holder(250);
    let carol = w.holder(100);

    w.vote(&alice, id, true);
    assert!(w.has_event("appeal_voted"));
    w.vote(&bob, id, false);
    w.vote(&carol, id, true);

    let appeal = w.appeal(id);
    assert_eq!(appeal.votes_for, 700);
    assert_eq!(appeal.votes_against, 250);

    let vote: Option<AppealVote> = w.call("get_appeal_vote", (id, alice.clone()).into_val(&w.env));
    assert_eq!(
        vote,
        Some(AppealVote {
            support: true,
            weight: 600,
            withdrawn: false
        })
    );
    // Voted tokens are held until the appeal is resolved.
    assert_eq!(w.gov.balance(&alice), 0);
    assert_eq!(w.gov.balance(&w.linkora), 950);
}

#[test]
fn test_one_vote_per_holder() {
    let w = world();
    let id = w.appeal_removal(&w.author, "please");
    let alice = w.holder(600);
    w.vote(&alice, id, true);
    // Topping up and voting again is rejected.
    w.gov_admin.mint(&alice, &600);
    assert!(w.vote_fails(&alice, id, true));
    assert!(w.vote_fails(&alice, id, false));
    assert_eq!(w.appeal(id).votes_for, 600);
}

#[test]
fn test_escrow_stops_tokens_voting_twice() {
    let w = world();
    let id = w.appeal_removal(&w.author, "please");
    let alice = w.holder(600);
    let sybil = Address::generate(&w.env);
    w.vote(&alice, id, true);
    // Alice's tokens are locked in the contract, so she has nothing to pass on.
    assert_eq!(w.gov.balance(&alice), 0);
    assert!(w.vote_fails(&sybil, id, true));
    assert_eq!(w.appeal(id).votes_for, 600);
}

#[test]
fn test_only_token_holders_vote() {
    let w = world();
    let id = w.appeal_removal(&w.author, "please");
    let nobody = Address::generate(&w.env);
    assert!(w.vote_fails(&nobody, id, true));
}

#[test]
fn test_parties_cannot_vote() {
    let w = world();
    let id = w.appeal_removal(&w.author, "please");
    w.gov_admin.mint(&w.author, &1_000);
    w.gov_admin.mint(&w.moderator, &1_000);
    assert!(w.vote_fails(&w.author, id, true));
    assert!(w.vote_fails(&w.moderator, id, false));
}

#[test]
fn test_seven_day_voting_deadline() {
    let w = world();
    let id = w.appeal_removal(&w.author, "please");
    let early = w.holder(10);
    let late = w.holder(10);

    w.set_time(START + WEEK - 1);
    w.vote(&early, id, true);
    w.set_time(START + WEEK);
    assert!(w.vote_fails(&late, id, true));
}

#[test]
fn test_vote_on_unknown_appeal_fails() {
    let w = world();
    let alice = w.holder(10);
    assert!(w.vote_fails(&alice, 42, true));
}

#[test]
fn test_paused_governance_blocks_appeals_and_votes() {
    let w = world();
    let id = w.appeal_removal(&w.author, "please");
    w.call::<()>(
        "pause_module",
        (w.admin.clone(), PauseModule::Governance).into_val(&w.env),
    );
    let alice = w.holder(10);
    assert!(w.vote_fails(&alice, id, true));
}

// ── Resolution ────────────────────────────────────────────────────────────────

#[test]
fn test_cannot_resolve_before_the_deadline() {
    let w = world();
    let id = w.appeal_removal(&w.author, "please");
    w.vote(&w.holder(10), id, true);
    w.set_time(START + WEEK - 1);
    assert!(w.resolve_fails(id));
    w.set_time(START + WEEK);
    assert!(w.resolve(id));
}

#[test]
fn test_passing_appeal_restores_post_refunds_and_slashes_moderator() {
    let w = world();
    let id = w.appeal_removal(&w.author, "please");
    w.vote(&w.holder(51), id, true);
    w.vote(&w.holder(49), id, false);

    w.set_time(START + WEEK);
    assert!(w.resolve(id));
    assert!(w.has_event("appeal_resolved"));

    // Post restored and relinked to its author.
    let post = w.get_post().expect("post restored");
    assert_eq!(post.author, w.author);
    assert!(w.posts_by_author().contains(w.post_id));
    // Appellant stake refunded.
    assert_eq!(w.stake.balance(&w.author), 10_000);
    // Moderator bond slashed to the treasury.
    assert_eq!(w.bond().unwrap().amount, MODERATOR_BOND - MODERATOR_SLASH);
    assert_eq!(w.stake.balance(&w.treasury), MODERATOR_SLASH);
    assert_eq!(w.appeal(id).status, GovAppealStatus::Passed);
}

#[test]
fn test_failing_appeal_keeps_post_removed_and_slashes_appellant() {
    let w = world();
    let id = w.appeal_removal(&w.author, "please");
    w.vote(&w.holder(10), id, true);
    w.vote(&w.holder(90), id, false);

    w.set_time(START + WEEK);
    assert!(!w.resolve(id));

    assert_eq!(w.get_post(), None);
    assert!(!w.posts_by_author().contains(w.post_id));
    assert_eq!(w.stake.balance(&w.author), 10_000 - APPEAL_STAKE);
    // The upheld report's stake went back to the reporter, so the treasury
    // holds exactly the forfeited appeal stake.
    assert_eq!(w.stake.balance(&w.treasury), APPEAL_STAKE);
    assert_eq!(w.bond().unwrap().amount, MODERATOR_BOND);
    assert_eq!(w.appeal(id).status, GovAppealStatus::Failed);
}

#[test]
fn test_exactly_half_in_favour_fails() {
    let w = world();
    let id = w.appeal_removal(&w.author, "please");
    w.vote(&w.holder(50), id, true);
    w.vote(&w.holder(50), id, false);
    w.set_time(START + WEEK);
    assert!(!w.resolve(id));
    assert_eq!(w.get_post(), None);
}

#[test]
fn test_appeal_without_votes_fails() {
    let w = world();
    let id = w.appeal_removal(&w.author, "please");
    w.set_time(START + WEEK);
    assert!(!w.resolve(id));
    assert_eq!(w.appeal(id).status, GovAppealStatus::Failed);
}

#[test]
fn test_unanimous_appeal_passes() {
    let w = world();
    let id = w.appeal_removal(&w.author, "please");
    w.vote(&w.holder(1), id, true);
    w.set_time(START + 10 * WEEK);
    assert!(w.resolve(id));
    assert!(w.get_post().is_some());
}

#[test]
fn test_slash_is_capped_at_the_bond() {
    let w = world_with(APPEAL_STAKE, 5_000, 200);
    let id = w.appeal_removal(&w.author, "please");
    w.vote(&w.holder(1), id, true);
    w.set_time(START + WEEK);
    assert!(w.resolve(id));
    assert_eq!(w.bond().unwrap().amount, 0);
    assert_eq!(w.stake.balance(&w.treasury), 200);
}

#[test]
fn test_unbonded_moderator_loses_nothing_but_appeal_still_passes() {
    let w = world_with(APPEAL_STAKE, MODERATOR_SLASH, 0);
    let id = w.appeal_removal(&w.author, "please");
    w.vote(&w.holder(1), id, true);
    w.set_time(START + WEEK);
    assert!(w.resolve(id));
    assert!(w.get_post().is_some());
    assert_eq!(w.stake.balance(&w.treasury), 0);
}

#[test]
fn test_zero_stake_config_moves_no_tokens() {
    let w = world_with(0, 0, 0);
    let id = w.appeal_removal(&w.author, "please");
    assert_eq!(w.stake.balance(&w.author), 10_000);
    w.set_time(START + WEEK);
    assert!(!w.resolve(id));
    assert_eq!(w.stake.balance(&w.author), 10_000);
    assert_eq!(w.stake.balance(&w.treasury), 0);
}

#[test]
fn test_resolved_appeal_is_final() {
    let w = world();
    let id = w.appeal_removal(&w.author, "please");
    w.vote(&w.holder(1), id, true);
    w.set_time(START + WEEK);
    w.resolve(id);
    assert!(w.resolve_fails(id));
    assert!(w.vote_fails(&w.holder(5), id, false));
    // And the post cannot be appealed again.
    assert!(w.fails("appeal_removal", w.appeal_args(&w.author, "again")));
}

// ── Vote withdrawal and bonds ─────────────────────────────────────────────────

#[test]
fn test_voters_get_their_tokens_back_after_resolution() {
    let w = world();
    let id = w.appeal_removal(&w.author, "please");
    let alice = w.holder(600);
    let bob = w.holder(400);
    w.vote(&alice, id, true);
    w.vote(&bob, id, false);

    // Not while voting is open.
    assert!(w.fails("withdraw_appeal_vote", (alice.clone(), id).into_val(&w.env)));

    w.set_time(START + WEEK);
    w.resolve(id);
    let back: i128 = w.call("withdraw_appeal_vote", (alice.clone(), id).into_val(&w.env));
    assert_eq!(back, 600);
    assert_eq!(w.gov.balance(&alice), 600);
    // Only once.
    assert!(w.fails("withdraw_appeal_vote", (alice.clone(), id).into_val(&w.env)));
    // Losing side gets its tokens back too.
    let back: i128 = w.call("withdraw_appeal_vote", (bob.clone(), id).into_val(&w.env));
    assert_eq!(back, 400);
    assert_eq!(w.gov.balance(&w.linkora), 0);

    let stranger = Address::generate(&w.env);
    assert!(w.fails("withdraw_appeal_vote", (stranger, id).into_val(&w.env)));
}

#[test]
fn test_moderator_cannot_unstake_during_an_appeal() {
    let w = world();
    let id = w.appeal_removal(&w.author, "please");
    assert!(w.fails(
        "unstake_moderator_bond",
        (w.moderator.clone(), 1i128).into_val(&w.env)
    ));

    w.set_time(START + WEEK);
    w.resolve(id);
    w.call::<()>(
        "unstake_moderator_bond",
        (w.moderator.clone(), MODERATOR_BOND).into_val(&w.env),
    );
    assert_eq!(w.bond().unwrap().amount, 0);
    assert_eq!(w.stake.balance(&w.moderator), 10_000);
    // Cannot take out more than is bonded.
    assert!(w.fails(
        "unstake_moderator_bond",
        (w.moderator.clone(), 1i128).into_val(&w.env)
    ));
}

#[test]
fn test_only_moderators_bond() {
    let w = world();
    let stranger = Address::generate(&w.env);
    assert!(w.fails("stake_moderator_bond", (stranger, 10i128).into_val(&w.env)));
}
