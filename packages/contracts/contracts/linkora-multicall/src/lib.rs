#![no_std]
//! `LinkoraMulticall` — run several contract calls as one atomic transaction.
//!
//! A Soroban transaction holds a single `InvokeHostFunction` operation, so
//! "follow + tip + join pool" normally costs three transactions and three
//! wallet prompts. `execute` takes the whole list instead and invokes each call
//! in order from inside one transaction:
//!
//! - **Atomic.** If any call fails, `execute` fails and the host rolls back
//!   every change the earlier calls made. There is no partial success.
//! - **One signature.** The caller authorizes `execute` once. Sub-calls that
//!   call `caller.require_auth()` (e.g. `follow(caller, …)`, `tip(caller, …)`
//!   and the token transfer inside `tip`) are covered by that same
//!   authorization tree, which simulation records for the wallet to sign.
//! - **Access control.** `execute` requires the caller's auth, and every call
//!   still runs the target contract's own checks, so a batch can only do what
//!   the caller could do with separate transactions. A call that acts for a
//!   different account fails unless that account authorized it too.
//! - **No re-entry.** A call may not target the multicall contract itself.

mod test;

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, Address,
    Env, Symbol, Val, Vec,
};

/// Most calls accepted in one batch. Keeps a batch well inside the per
/// transaction resource limits; split larger workloads into several batches.
pub const MAX_CALLS: u32 = 16;

const EVENT_VERSION: u32 = 1;

/// One contract invocation in a batch.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Call {
    pub contract_id: Address,
    pub fn_name: Symbol,
    pub args: Vec<Val>,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum MulticallError {
    EmptyBatch = 1,
    TooManyCalls = 2,
    ReentrantCall = 3,
}

/// Emitted once per successful batch.
#[contractevent(topics = ["batch_executed"])]
#[derive(Clone)]
pub struct BatchExecutedEvent {
    #[topic]
    pub version: u32,
    #[topic]
    pub caller: Address,
    pub call_count: u32,
}

#[contract]
pub struct LinkoraMulticall;

#[contractimpl]
impl LinkoraMulticall {
    /// Invoke every call in `calls`, in order, and return their results in the
    /// same order. Fails, rolling back all of them, if any call fails.
    pub fn execute(env: Env, caller: Address, calls: Vec<Call>) -> Vec<Val> {
        caller.require_auth();

        let count = calls.len();
        if count == 0 {
            panic_with_error!(&env, MulticallError::EmptyBatch);
        }
        if count > MAX_CALLS {
            panic_with_error!(&env, MulticallError::TooManyCalls);
        }
        let this = env.current_contract_address();
        if calls.iter().any(|call| call.contract_id == this) {
            panic_with_error!(&env, MulticallError::ReentrantCall);
        }

        let mut results = Vec::new(&env);
        for call in calls.iter() {
            let result: Val = env.invoke_contract(&call.contract_id, &call.fn_name, call.args);
            results.push_back(result);
        }

        BatchExecutedEvent {
            version: EVENT_VERSION,
            caller,
            call_count: count,
        }
        .publish(&env);

        results
    }

    /// Largest batch `execute` accepts.
    pub fn get_max_calls() -> u32 {
        MAX_CALLS
    }
}
