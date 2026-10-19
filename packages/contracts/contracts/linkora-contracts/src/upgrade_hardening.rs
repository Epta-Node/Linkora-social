// Issue #1677: Multi-step upgrade ceremony with pinned Wasm hash
//
// Hardens the upgrade path by pinning hash at propose, requiring exact match at execute,
// and providing complete event trail.

use crate::*;

const UPGRADE_PROPOSAL: Symbol = symbol_short!("UPG_PROP");
const UPGRADE_TIMELOCK_LEDGERS: u32 = 17_280; // ~1 day at 5s/ledger

#[contracttype]
#[derive(Clone)]
pub struct UpgradeProposal {
    pub new_wasm_hash: BytesN<32>,
    pub proposed_at_ledger: u32,
    pub proposer: Address,
}

#[contractevent]
#[derive(Clone)]
pub struct UpgradeProposedEvent {
    #[topic]
    pub version: u32,
    pub proposer: Address,
    pub new_wasm_hash: BytesN<32>,
    pub execute_after_ledger: u32,
}

#[contractevent]
#[derive(Clone)]
pub struct UpgradeExecutedEvent {
    #[topic]
    pub version: u32,
    pub executor: Address,
    pub new_wasm_hash: BytesN<32>,
    pub executed_at_ledger: u32,
}

impl LinkoraContract {
    /// Propose an upgrade with a specific Wasm hash
    /// 
    /// Pins the hash at proposal time and starts the timelock.
    /// Re-proposing with a different hash restarts the timelock.
    pub fn propose_upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>) {
        Self::require_admin(&env, &admin);
        admin.require_auth();

        let current_ledger = env.ledger().sequence();
        let execute_after = current_ledger + UPGRADE_TIMELOCK_LEDGERS;

        let proposal = UpgradeProposal {
            new_wasm_hash: new_wasm_hash.clone(),
            proposed_at_ledger: current_ledger,
            proposer: admin.clone(),
        };

        // Store the proposal (overwrites any existing proposal)
        env.storage().instance().set(&UPGRADE_PROPOSAL, &proposal);

        // Emit event
        UpgradeProposedEvent {
            version: EVENT_VERSION,
            proposer: admin,
            new_wasm_hash,
            execute_after_ledger: execute_after,
        }
        .publish(&env);
    }

    /// Execute the upgrade, requiring exact hash match with proposal
    /// 
    /// Enforces:
    /// - Timelock has passed
    /// - Provided hash exactly matches proposed hash
    /// - Proposal exists
    /// - Can only be executed once per proposal
    pub fn execute_upgrade(env: Env, admin: Address, new_wasm_hash: BytesN<32>) {
        Self::require_admin(&env, &admin);
        admin.require_auth();

        // Get the proposal
        let proposal: UpgradeProposal = env
            .storage()
            .instance()
            .get(&UPGRADE_PROPOSAL)
            .expect("no upgrade proposal found");

        // Verify hash matches exactly
        if proposal.new_wasm_hash != new_wasm_hash {
            panic!("wasm hash does not match proposed hash");
        }

        // Verify timelock has passed
        let current_ledger = env.ledger().sequence();
        let execute_after = proposal.proposed_at_ledger + UPGRADE_TIMELOCK_LEDGERS;

        if current_ledger < execute_after {
            panic!("upgrade timelock has not passed");
        }

        // Execute the upgrade
        env.deployer().update_current_contract_wasm(new_wasm_hash.clone());

        // Remove the proposal to prevent re-execution
        env.storage().instance().remove(&UPGRADE_PROPOSAL);

        // Emit event
        UpgradeExecutedEvent {
            version: EVENT_VERSION,
            executor: admin,
            new_wasm_hash,
            executed_at_ledger: current_ledger,
        }
        .publish(&env);
    }

    /// Get current upgrade proposal if exists
    pub fn get_upgrade_proposal(env: Env) -> Option<UpgradeProposal> {
        env.storage().instance().get(&UPGRADE_PROPOSAL)
    }

    /// Cancel pending upgrade proposal (admin only)
    pub fn cancel_upgrade(env: Env, admin: Address) {
        Self::require_admin(&env, &admin);
        admin.require_auth();

        if !env.storage().instance().has(&UPGRADE_PROPOSAL) {
            panic!("no upgrade proposal to cancel");
        }

        env.storage().instance().remove(&UPGRADE_PROPOSAL);
    }

    /// Check if upgrade is ready to execute
    pub fn is_upgrade_ready(env: Env) -> bool {
        if let Some(proposal) = env.storage().instance().get::<_, UpgradeProposal>(&UPGRADE_PROPOSAL) {
            let current_ledger = env.ledger().sequence();
            let execute_after = proposal.proposed_at_ledger + UPGRADE_TIMELOCK_LEDGERS;
            current_ledger >= execute_after
        } else {
            false
        }
    }
}
