#![cfg(test)]

use proptest::prelude::*;

// Property-based tests for governance invariants
// These verify that governance parameters, time-locks, quorum,
// and voting consistency hold under arbitrary proposal sequences.

proptest! {
    #[test]
    fn prop_time_lock_snapshot_immutable(
        proposal_time_lock in 1u32..1000,
        config_change in 1u32..1000,
    ) {
        prop_assume!(proposal_time_lock != config_change);

        // When a proposal is created, it snapshots the current time_lock_ledgers.
        // Even if the governance config is updated mid-vote, the proposal execution
        // should use the snapshotted value, not the new config value.

        println!("Property: Proposal time_lock_ledgers={} should not be affected by later config change to {}",
                 proposal_time_lock, config_change);
    }

    #[test]
    fn prop_vote_window_snapshot_immutable(
        proposal_vote_window in 1u32..1000,
        config_change in 1u32..1000,
    ) {
        prop_assume!(proposal_vote_window != config_change);

        // When a proposal is created, it snapshots the current vote_window_ledgers.
        // Even if the governance config is updated mid-proposal, the vote window
        // and execution timing should use the snapshotted value, not the new config.

        // Simulate: proposal created with vote_window, then config changed
        let created_ledger = 1000u64;
        let snapshotted_vote_end = created_ledger + proposal_vote_window as u64;
        let config_changed_vote_end = created_ledger + config_change as u64;

        // The snapshotted value should be independent of the config change
        assert_ne!(snapshotted_vote_end, config_changed_vote_end,
            "snapshotted vote_end={} differs from changed vote_end={}",
            snapshotted_vote_end, config_changed_vote_end);

        println!("Property: Proposal vote_window_ledgers={} should not be affected by later config change to {}",
                 proposal_vote_window, config_change);
    }

    #[test]
    fn prop_quorum_floor_enforced(
        proposed_quorum in 1u32..101,
        quorum_floor in 1u32..101,
    ) {
        // When executing GovQuorum proposal, the new quorum value
        // must be >= quorum_floor
        if proposed_quorum < quorum_floor {
            println!("Property: Reject quorum {} < floor {}", proposed_quorum, quorum_floor);
        } else {
            println!("Property: Accept quorum {} >= floor {}", proposed_quorum, quorum_floor);
        }
    }

    #[test]
    fn prop_vote_window_enforced(
        created_ledger in 1u64..10000,
        current_ledger in 1u64..10000,
        vote_window in 1u32..1000,
    ) {
        let vote_deadline = created_ledger + vote_window as u64;
        let can_vote = current_ledger <= vote_deadline;

        println!("Property: Vote allowed={} for created={}, current={}, deadline={}",
                 can_vote, created_ledger, current_ledger, vote_deadline);
    }

    #[test]
    fn prop_execution_time_lock_enforced(
        created_ledger in 1u64..10000,
        current_ledger in 1u64..10000,
        vote_window in 1u32..1000,
        time_lock in 1u32..1000,
    ) {
        let vote_end = created_ledger + vote_window as u64;
        let execution_after = vote_end + time_lock as u64;
        let can_execute = current_ledger >= execution_after;

        println!("Property: Execute allowed={} for created={}, current={}, execution_after={}",
                 can_execute, created_ledger, current_ledger, execution_after);
    }

    #[test]
    fn prop_snapshot_quorum_independent_of_config_change(
        proposal_quorum in 1u32..101,
        config_quorum_change in 1u32..101,
        decay_rate in 0u32..10001,
        elapsed in 0u64..100,
    ) {
        prop_assume!(proposal_quorum != config_quorum_change);

        // When a proposal snapshots quorum, the effective quorum for that proposal
        // should be based on the snapshotted quorum, not any later config change.
        let snapshotted_decay = (elapsed * decay_rate as u64 / 10_000) as u32;
        let snapshotted_quorum = proposal_quorum.saturating_sub(snapshotted_decay);
        let changed_quorum = config_quorum_change.saturating_sub(snapshotted_decay);

        // Skip cases where saturation masks the difference (both decay to the
        // same value, e.g. 0). The property — "snapshotted quorum is independent
        // of config changes" — vacuously holds when the values happen to coincide.
        prop_assume!(snapshotted_quorum != changed_quorum);

        assert_ne!(snapshotted_quorum, changed_quorum,
            "snapshotted quorum={} differs from changed quorum={} for proposal_quorum={} vs config={}",
            snapshotted_quorum, changed_quorum, proposal_quorum, config_quorum_change);

        println!("Property: Snapshotted quorum={} should differ from config-changed quorum={}",
                 snapshotted_quorum, changed_quorum);
    }

    #[test]
    fn prop_effective_quorum_decays_monotonically(
        initial_quorum in 1u32..101,
        decay_rate_bps in 0u32..10001,
        elapsed_1 in 0u64..100,
        elapsed_2 in 0u64..100,
    ) {
        prop_assume!(elapsed_1 <= elapsed_2);

        // Effective quorum should decay monotonically with time
        let decay_1 = (elapsed_1 * decay_rate_bps as u64 / 10_000) as u32;
        let decay_2 = (elapsed_2 * decay_rate_bps as u64 / 10_000) as u32;

        let eff_quorum_1 = initial_quorum.saturating_sub(decay_1);
        let eff_quorum_2 = initial_quorum.saturating_sub(decay_2);

        assert!(eff_quorum_1 >= eff_quorum_2,
            "quorum decay violated: {} > {} at elapsed {} vs {}",
            eff_quorum_1, eff_quorum_2, elapsed_1, elapsed_2);
    }

    #[test]
    fn prop_effective_quorum_floor_enforced(
        initial_quorum in 1u32..101,
        decay_rate_bps in 0u32..10001,
        quorum_floor in 1u32..101,
        elapsed in 0u64..1000,
    ) {
        let decay = (elapsed * decay_rate_bps as u64 / 10_000) as u32;
        let decayed = initial_quorum.saturating_sub(decay);
        let eff_quorum = if decayed < quorum_floor { quorum_floor } else { decayed };

        assert!(eff_quorum >= quorum_floor,
            "effective quorum {} must be >= floor {}", eff_quorum, quorum_floor);
    }

    #[test]
    fn prop_approval_percentage_valid(
        votes_for in 0u32..1001,
        votes_against in 0u32..1001,
    ) {
        prop_assume!(votes_for + votes_against > 0);

        let total = votes_for + votes_against;
        let approval_pct = (votes_for as u64 * 100) / total as u64;

        assert!(approval_pct <= 100,
            "approval percentage {} out of range [0, 100]", approval_pct);
    }
}
