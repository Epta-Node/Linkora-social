#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    contracttype,
    events::Event as _,
    symbol_short,
    testutils::{
        Address as _, AuthorizedFunction, AuthorizedInvocation, Events, MockAuth, MockAuthInvoke,
    },
    token::{Client as TokenClient, StellarAssetClient},
    vec, Address, Env, IntoVal, String, Symbol, TryFromVal, Val, Vec,
};

/// The real Linkora contract, as compiled WASM. CI rebuilds this file from
/// source before running the tests. (The crate itself cannot be linked
/// natively into tests: soroban-sdk 26 testutils cannot derive XDR
/// conversions for its `Option<ProposalMetadata>` field.)
const LINKORA_WASM: &[u8] = include_bytes!("../../linkora-contracts/linkora_contracts.wasm");

/// Mirror of Linkora's `Post`, decoded from the contract's return value.
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

/// Client-like wrapper invoking the WASM Linkora contract by function name.
struct Linkora {
    env: Env,
    address: Address,
}

impl Linkora {
    fn call<T: TryFromVal<Env, Val>>(&self, fn_name: &str, args: Vec<Val>) -> T {
        self.env
            .invoke_contract(&self.address, &Symbol::new(&self.env, fn_name), args)
    }

    fn follow(&self, follower: &Address, followee: &Address) {
        self.call::<()>(
            "follow",
            (follower.clone(), followee.clone()).into_val(&self.env),
        )
    }

    fn tip(&self, tipper: &Address, post_id: u64, token: &Address, amount: i128) {
        self.call::<()>(
            "tip",
            (tipper.clone(), post_id, token.clone(), amount).into_val(&self.env),
        )
    }

    fn like_post(&self, user: &Address, post_id: u64) {
        self.call::<()>("like_post", (user.clone(), post_id).into_val(&self.env))
    }

    fn get_post(&self, post_id: u64) -> Option<Post> {
        self.call("get_post", (post_id,).into_val(&self.env))
    }

    fn get_post_count(&self) -> u64 {
        self.call("get_post_count", Vec::new(&self.env))
    }

    fn get_like_count(&self, post_id: u64) -> u64 {
        self.call("get_like_count", (post_id,).into_val(&self.env))
    }

    fn has_liked(&self, user: &Address, post_id: u64) -> bool {
        self.call("has_liked", (user.clone(), post_id).into_val(&self.env))
    }

    fn get_following(&self, user: &Address) -> Vec<Address> {
        self.call(
            "get_following",
            (user.clone(), 0u32, 50u32).into_val(&self.env),
        )
    }
}

struct World<'a> {
    env: Env,
    multicall: LinkoraMulticallClient<'a>,
    linkora: Linkora,
    token: Address,
    treasury: Address,
    user: Address,
    author: Address,
    post_id: u64,
}

/// A Linkora deployment with one post by `author`, a funded `user` and the
/// multicall contract.
fn world<'a>() -> World<'a> {
    let env = Env::default();
    env.mock_all_auths();
    // The Linkora WASM is larger than the network's 128 KiB contract-size
    // limit (a known upstream issue), so lift the test budget and resource
    // limits; costs are still metered for the gas comparison.
    env.cost_estimate().budget().reset_unlimited();
    env.cost_estimate().disable_resource_limits();

    let linkora = Linkora {
        env: env.clone(),
        address: env.register(LINKORA_WASM, ()),
    };
    let multicall = LinkoraMulticallClient::new(&env, &env.register(LinkoraMulticall, ()));

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let user = Address::generate(&env);
    let author = Address::generate(&env);
    linkora.call::<()>(
        "initialize",
        (admin, treasury.clone(), 250u32).into_val(&env),
    );

    let token = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    StellarAssetClient::new(&env, &token).mint(&user, &10_000);

    linkora.call::<()>(
        "set_profile",
        (
            author.clone(),
            String::from_str(&env, "author"),
            token.clone(),
        )
            .into_val(&env),
    );
    let post_id: u64 = linkora.call(
        "create_post",
        (author.clone(), String::from_str(&env, "hello")).into_val(&env),
    );

    World {
        env,
        multicall,
        linkora,
        token,
        treasury,
        user,
        author,
        post_id,
    }
}

fn call(w: &World, fn_name: &str, args: Vec<Val>) -> Call {
    Call {
        contract_id: w.linkora.address.clone(),
        fn_name: Symbol::new(&w.env, fn_name),
        args,
    }
}

fn follow_call(w: &World, follower: &Address, followee: &Address) -> Call {
    call(
        w,
        "follow",
        (follower.clone(), followee.clone()).into_val(&w.env),
    )
}

fn tip_call(w: &World, tipper: &Address, post_id: u64, amount: i128) -> Call {
    call(
        w,
        "tip",
        (tipper.clone(), post_id, w.token.clone(), amount).into_val(&w.env),
    )
}

fn like_call(w: &World, user: &Address, post_id: u64) -> Call {
    call(w, "like_post", (user.clone(), post_id).into_val(&w.env))
}

fn balance(w: &World, who: &Address) -> i128 {
    TokenClient::new(&w.env, &w.token).balance(who)
}

fn is_following(w: &World, follower: &Address, followee: &Address) -> bool {
    w.linkora
        .get_following(follower)
        .iter()
        .any(|a| &a == followee)
}

// ── Integration: follow + tip in one transaction ──────────────────────────────

#[test]
fn test_follow_and_tip_in_one_transaction() {
    let w = world();
    let calls = vec![
        &w.env,
        follow_call(&w, &w.user, &w.author),
        tip_call(&w, &w.user, w.post_id, 1_000),
    ];

    w.multicall.execute(&w.user, &calls);

    assert!(is_following(&w, &w.user, &w.author));
    // 2.5% protocol fee: 25 to the treasury, 975 to the author.
    assert_eq!(balance(&w, &w.author), 975);
    assert_eq!(balance(&w, &w.treasury), 25);
    assert_eq!(balance(&w, &w.user), 9_000);
    assert_eq!(w.linkora.get_post(w.post_id).unwrap().tip_total, 975);
}

#[test]
fn test_one_authorization_covers_every_call() {
    let w = world();
    let calls = vec![
        &w.env,
        follow_call(&w, &w.user, &w.author),
        tip_call(&w, &w.user, w.post_id, 1_000),
    ];
    w.multicall.execute(&w.user, &calls);

    // The user signs a single authorization: the `execute` root, with the
    // Linkora calls (and the token transfers inside `tip`) as sub-invocations.
    let auths = w.env.auths();
    assert_eq!(auths.len(), 1);
    let (address, invocation) = &auths[0];
    assert_eq!(address, &w.user);
    assert_eq!(
        invocation.function,
        AuthorizedFunction::Contract((
            w.multicall.address.clone(),
            Symbol::new(&w.env, "execute"),
            (w.user.clone(), calls.clone()).into_val(&w.env),
        ))
    );
    let sub: std::vec::Vec<_> = invocation
        .sub_invocations
        .iter()
        .map(|i: &AuthorizedInvocation| match &i.function {
            AuthorizedFunction::Contract((contract, name, _)) => (contract.clone(), name.clone()),
            _ => panic!("unexpected auth"),
        })
        .collect();
    assert_eq!(
        sub,
        std::vec![
            (w.linkora.address.clone(), Symbol::new(&w.env, "follow")),
            (w.linkora.address.clone(), Symbol::new(&w.env, "tip")),
        ]
    );
}

#[test]
fn test_explicit_auth_tree_is_enough() {
    // Without mock_all_auths: only the user's single signed tree is supplied.
    let w = world();
    let calls = vec![&w.env, follow_call(&w, &w.user, &w.author)];

    w.multicall
        .mock_auths(&[MockAuth {
            address: &w.user,
            invoke: &MockAuthInvoke {
                contract: &w.multicall.address,
                fn_name: "execute",
                args: (w.user.clone(), calls.clone()).into_val(&w.env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &w.linkora.address,
                    fn_name: "follow",
                    args: (w.user.clone(), w.author.clone()).into_val(&w.env),
                    sub_invokes: &[],
                }],
            },
        }])
        .execute(&w.user, &calls);

    assert!(is_following(&w, &w.user, &w.author));
}

#[test]
fn test_calls_acting_for_another_account_need_its_auth() {
    // The user authorizes the batch, but the batch tries to follow on behalf
    // of `victim`, who signed nothing.
    let w = world();
    let victim = Address::generate(&w.env);
    let calls = vec![&w.env, follow_call(&w, &victim, &w.author)];

    let result = w
        .multicall
        .mock_auths(&[MockAuth {
            address: &w.user,
            invoke: &MockAuthInvoke {
                contract: &w.multicall.address,
                fn_name: "execute",
                args: (w.user.clone(), calls.clone()).into_val(&w.env),
                sub_invokes: &[],
            },
        }])
        .try_execute(&w.user, &calls);

    assert!(result.is_err());
    assert!(!is_following(&w, &victim, &w.author));
}

#[test]
fn test_execute_requires_caller_auth() {
    let w = world();
    let calls = vec![&w.env, follow_call(&w, &w.user, &w.author)];
    let result = w.multicall.set_auths(&[]).try_execute(&w.user, &calls);
    assert!(result.is_err());
    assert!(!is_following(&w, &w.user, &w.author));
}

// ── Atomicity ─────────────────────────────────────────────────────────────────

#[test]
fn test_failing_call_rolls_back_the_whole_batch() {
    let w = world();
    // The tip targets a post that does not exist, after a valid follow and like.
    let calls = vec![
        &w.env,
        follow_call(&w, &w.user, &w.author),
        like_call(&w, &w.user, w.post_id),
        tip_call(&w, &w.user, 999, 1_000),
    ];

    assert!(w.multicall.try_execute(&w.user, &calls).is_err());

    assert!(!is_following(&w, &w.user, &w.author));
    assert!(!w.linkora.has_liked(&w.user, w.post_id));
    assert_eq!(w.linkora.get_like_count(w.post_id), 0);
    assert_eq!(balance(&w, &w.user), 10_000);
}

#[test]
fn test_rollback_wherever_the_failure_is() {
    for failing_index in 0..3u32 {
        let w = world();
        let mut calls = vec![
            &w.env,
            follow_call(&w, &w.user, &w.author),
            tip_call(&w, &w.user, w.post_id, 1_000),
            like_call(&w, &w.user, w.post_id),
        ];
        // Replace one call with a tip larger than the user's balance.
        calls.set(failing_index, tip_call(&w, &w.user, w.post_id, 1_000_000));

        assert!(
            w.multicall.try_execute(&w.user, &calls).is_err(),
            "batch with failing call {failing_index} should fail"
        );
        assert!(!is_following(&w, &w.user, &w.author));
        assert!(!w.linkora.has_liked(&w.user, w.post_id));
        assert_eq!(balance(&w, &w.user), 10_000);
        assert_eq!(balance(&w, &w.author), 0);
        assert_eq!(w.linkora.get_post(w.post_id).unwrap().tip_total, 0);
    }
}

#[test]
fn test_a_successful_batch_after_a_failed_one() {
    let w = world();
    let bad = vec![
        &w.env,
        follow_call(&w, &w.user, &w.author),
        tip_call(&w, &w.user, 999, 1),
    ];
    assert!(w.multicall.try_execute(&w.user, &bad).is_err());

    let good = vec![&w.env, follow_call(&w, &w.user, &w.author)];
    w.multicall.execute(&w.user, &good);
    assert!(is_following(&w, &w.user, &w.author));
}

// ── Results, events, limits ───────────────────────────────────────────────────

#[test]
fn test_results_are_returned_in_call_order() {
    let w = world();
    let calls = vec![
        &w.env,
        call(
            &w,
            "create_post",
            (w.user.clone(), String::from_str(&w.env, "first")).into_val(&w.env),
        ),
        follow_call(&w, &w.user, &w.author),
        call(
            &w,
            "create_post",
            (w.user.clone(), String::from_str(&w.env, "second")).into_val(&w.env),
        ),
    ];

    let results = w.multicall.execute(&w.user, &calls);

    assert_eq!(results.len(), 3);
    let first: u64 = results.get(0).unwrap().into_val(&w.env);
    let second: u64 = results.get(2).unwrap().into_val(&w.env);
    assert_eq!(first, w.post_id + 1);
    assert_eq!(second, w.post_id + 2);
    assert!(results.get(1).unwrap().is_void());
    assert_eq!(
        w.linkora.get_post(first).unwrap().content,
        String::from_str(&w.env, "first")
    );
}

#[test]
fn test_emits_batch_executed() {
    let w = world();
    let calls = vec![
        &w.env,
        follow_call(&w, &w.user, &w.author),
        like_call(&w, &w.user, w.post_id),
    ];
    w.multicall.execute(&w.user, &calls);

    let expected = BatchExecutedEvent {
        version: EVENT_VERSION,
        caller: w.user.clone(),
        call_count: 2,
    }
    .to_xdr(&w.env, &w.multicall.address);
    assert!(w.env.events().all().events().contains(&expected));
}

#[test]
fn test_rejects_empty_batch() {
    let w = world();
    assert_eq!(
        w.multicall.try_execute(&w.user, &Vec::new(&w.env)),
        Err(Ok(MulticallError::EmptyBatch.into()))
    );
}

#[test]
fn test_rejects_oversized_batch() {
    let w = world();
    let mut calls = Vec::new(&w.env);
    for _ in 0..=MAX_CALLS {
        calls.push_back(like_call(&w, &w.user, w.post_id));
    }
    assert_eq!(
        w.multicall.try_execute(&w.user, &calls),
        Err(Ok(MulticallError::TooManyCalls.into()))
    );
    assert_eq!(w.multicall.get_max_calls(), MAX_CALLS);
}

#[test]
fn test_accepts_a_full_batch() {
    let w = world();
    let mut calls = Vec::new(&w.env);
    for i in 0..MAX_CALLS {
        calls.push_back(call(
            &w,
            "create_post",
            (
                w.user.clone(),
                String::from_str(&w.env, if i % 2 == 0 { "a" } else { "b" }),
            )
                .into_val(&w.env),
        ));
    }
    let results = w.multicall.execute(&w.user, &calls);
    assert_eq!(results.len(), MAX_CALLS);
    assert_eq!(w.linkora.get_post_count(), 1 + MAX_CALLS as u64);
}

#[test]
fn test_rejects_calls_back_into_multicall() {
    let w = world();
    let inner = vec![&w.env, follow_call(&w, &w.user, &w.author)];
    let calls = vec![
        &w.env,
        Call {
            contract_id: w.multicall.address.clone(),
            fn_name: symbol_short!("execute"),
            args: (w.user.clone(), inner).into_val(&w.env),
        },
    ];
    assert_eq!(
        w.multicall.try_execute(&w.user, &calls),
        Err(Ok(MulticallError::ReentrantCall.into()))
    );
}

// ── Gas cost: batch vs separate transactions ──────────────────────────────────

/// Resources and estimated resource fee of the last top-level invocation.
fn last_cost(env: &Env) -> (i64, u32, u32, i64) {
    let res = env.cost_estimate().resources();
    let fee = env.cost_estimate().fee();
    (
        res.instructions,
        res.disk_read_entries + res.memory_read_entries,
        res.write_entries,
        fee.total,
    )
}

/// Measures follow + tip + like as three separate invocations and as one
/// batch. Run with `cargo test -p linkora-multicall gas_cost -- --nocapture`
/// to print the numbers documented in the README.
///
/// The host meters only the invocation itself. Each separate transaction also
/// pays its own inclusion fee, signature check and envelope bytes, which are
/// not included here, so the real saving from batching is larger than the
/// resource-fee difference printed.
#[test]
fn test_gas_cost_batch_vs_separate() {
    let separate = world();
    let mut sep_total = (0i64, 0u32, 0u32, 0i64);
    separate.linkora.follow(&separate.user, &separate.author);
    let c = last_cost(&separate.env);
    std::println!("separate follow     : {c:?}");
    sep_total = add(sep_total, c);
    separate
        .linkora
        .tip(&separate.user, separate.post_id, &separate.token, 1_000);
    let c = last_cost(&separate.env);
    std::println!("separate tip        : {c:?}");
    sep_total = add(sep_total, c);
    separate.linkora.like_post(&separate.user, separate.post_id);
    let c = last_cost(&separate.env);
    std::println!("separate like_post  : {c:?}");
    sep_total = add(sep_total, c);

    let batched = world();
    let calls = vec![
        &batched.env,
        follow_call(&batched, &batched.user, &batched.author),
        tip_call(&batched, &batched.user, batched.post_id, 1_000),
        like_call(&batched, &batched.user, batched.post_id),
    ];
    batched.multicall.execute(&batched.user, &calls);
    let batch = last_cost(&batched.env);

    std::println!("separate (sum of 3) : {sep_total:?}");
    std::println!("batched (1 tx)      : {batch:?}");
    std::println!("(instructions, ledger entries read, entries written, resource fee in stroops)");

    // Same state change either way.
    assert_eq!(
        balance(&batched, &batched.author),
        balance(&separate, &separate.author)
    );

    // Ledger entries shared by the calls (contract instance, token, user
    // balance) are read and written once per transaction, so the batch never
    // touches more entries than the three transactions combined.
    assert!(batch.1 <= sep_total.1);
    assert!(batch.2 <= sep_total.2);
}

fn add(a: (i64, u32, u32, i64), b: (i64, u32, u32, i64)) -> (i64, u32, u32, i64) {
    (a.0 + b.0, a.1 + b.1, a.2 + b.2, a.3 + b.3)
}
