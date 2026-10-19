// Issue #1690: End-to-end governance lifecycle integration test
//
// Integration test that walks through the full governance lifecycle:
// config → propose → vote (for/against) → quorum met → execute → verify effect
// Plus veto and failing quorum paths

#![cfg(test)]

use linkora_contracts::{LinkoraContract, LinkoraContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, Env, String as SdkString,
};

fn setup_contract(env: &Env) -> (LinkoraContractClient, Address, Address) {
    let contract_id = env.register_contract(None, LinkoraContract);
    let client = LinkoraContractClient::new(env, &contract_id);

    let admin = Address::generate(env);
    let treasury = Address::generate(env);

    client.initialize(&admin, &treasury, &100u32); // 1% protocol fee

    (client, admin, treasury)
}

fn setup_token(env: &Env, admin: &Address) -> Address {
    let token = env.register_stellar_asset_contract(admin.clone());
    StellarAssetClient::new(env, &token).mint(admin, &1_000_000_000);
    token
}

fn setup_profile(client: &LinkoraContractClient, user: &Address, username: &str, token: &Address) {
    client.set_profile(user, &SdkString::from_str(client.env(), username), token);
}

#[test]
fn test_governance_happy_path_fee_change() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, treasury) = setup_contract(&env);

    // Step 1: Configure governance parameters
    let quorum = 3; // Need 3 votes to pass
    let voting_period = 1000u32; // 1000 ledgers
    
    client.set_gov_quorum(&admin, &quorum);
    client.set_gov_voting_period(&admin, &voting_period);

    // Verify configuration
    let config = client.get_gov_config();
    assert_eq!(config.quorum, quorum);
    assert_eq!(config.voting_period_ledgers, voting_period);

    // Step 2: Create voters with profiles
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let voter3 = Address::generate(&env);
    let voter4 = Address::generate(&env);

    let token = setup_token(&env, &admin);
    setup_profile(&client, &voter1, "voter1", &token);
    setup_profile(&client, &voter2, "voter2", &token);
    setup_profile(&client, &voter3, "voter3", &token);
    setup_profile(&client, &voter4, "voter4", &token);

    // Step 3: Propose governance action (fee change)
    let proposal_id = client.gov_propose(
        &voter1,
        &SdkString::from_str(&env, "Change protocol fee to 2%"),
        &SdkString::from_str(&env, "set_protocol_fee"),
        &vec![&env, 200u32], // 2% = 200 bps
    );

    assert!(proposal_id > 0);

    // Verify proposal was created
    let proposal = client.get_gov_proposal(&proposal_id);
    assert_eq!(proposal.proposer, voter1);
    assert!(!proposal.executed);
    assert!(!proposal.vetoed);

    // Step 4: Vote on proposal (3 for, 1 against)
    client.gov_vote(&voter1, &proposal_id, &true); // Vote for
    client.gov_vote(&voter2, &proposal_id, &true); // Vote for
    client.gov_vote(&voter3, &proposal_id, &true); // Vote for
    client.gov_vote(&voter4, &proposal_id, &false); // Vote against

    // Step 5: Advance ledger past voting period
    env.ledger().with_mut(|ledger| {
        ledger.sequence_number += voting_period + 1;
    });

    // Step 6: Execute proposal (quorum met)
    client.gov_execute(&admin, &proposal_id);

    // Step 7: Verify effect - protocol fee should now be 2%
    let new_fee = client.get_protocol_fee();
    assert_eq!(new_fee, 200u32);

    // Verify proposal marked as executed
    let executed_proposal = client.get_gov_proposal(&proposal_id);
    assert!(executed_proposal.executed);
}

#[test]
fn test_governance_veto_path() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _treasury) = setup_contract(&env);

    // Configure governance
    client.set_gov_quorum(&admin, &2);
    client.set_gov_voting_period(&admin, &1000u32);

    // Create voters
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let token = setup_token(&env, &admin);
    setup_profile(&client, &voter1, "voter1", &token);
    setup_profile(&client, &voter2, "voter2", &token);

    // Propose
    let proposal_id = client.gov_propose(
        &voter1,
        &SdkString::from_str(&env, "Malicious proposal"),
        &SdkString::from_str(&env, "some_action"),
        &vec![&env],
    );

    // Votes
    client.gov_vote(&voter1, &proposal_id, &true);
    client.gov_vote(&voter2, &proposal_id, &true);

    // Admin vetos before execution
    client.gov_veto(&admin, &proposal_id);

    // Verify vetoed
    let vetoed_proposal = client.get_gov_proposal(&proposal_id);
    assert!(vetoed_proposal.vetoed);
    assert!(!vetoed_proposal.executed);

    // Advance ledger
    env.ledger().with_mut(|ledger| {
        ledger.sequence_number += 1001;
    });

    // Attempt to execute should fail (vetoed)
    let result = client.try_gov_execute(&admin, &proposal_id);
    assert!(result.is_err());
}

#[test]
fn test_governance_failing_quorum() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _treasury) = setup_contract(&env);

    // Configure governance with high quorum
    client.set_gov_quorum(&admin, &5); // Need 5 votes
    client.set_gov_voting_period(&admin, &1000u32);

    // Create only 3 voters
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let voter3 = Address::generate(&env);
    let token = setup_token(&env, &admin);
    setup_profile(&client, &voter1, "voter1", &token);
    setup_profile(&client, &voter2, "voter2", &token);
    setup_profile(&client, &voter3, "voter3", &token);

    // Propose
    let proposal_id = client.gov_propose(
        &voter1,
        &SdkString::from_str(&env, "Test proposal"),
        &SdkString::from_str(&env, "some_action"),
        &vec![&env],
    );

    // Only 3 votes (less than quorum of 5)
    client.gov_vote(&voter1, &proposal_id, &true);
    client.gov_vote(&voter2, &proposal_id, &true);
    client.gov_vote(&voter3, &proposal_id, &true);

    // Advance ledger past voting period
    env.ledger().with_mut(|ledger| {
        ledger.sequence_number += 1001;
    });

    // Attempt to execute should fail (quorum not met)
    let result = client.try_gov_execute(&admin, &proposal_id);
    assert!(result.is_err());

    // Verify not executed
    let proposal = client.get_gov_proposal(&proposal_id);
    assert!(!proposal.executed);
}

#[test]
fn test_governance_vote_against_majority() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _treasury) = setup_contract(&env);

    // Configure governance
    client.set_gov_quorum(&admin, &3);
    client.set_gov_voting_period(&admin, &1000u32);

    // Create voters
    let voter1 = Address::generate(&env);
    let voter2 = Address::generate(&env);
    let voter3 = Address::generate(&env);
    let voter4 = Address::generate(&env);
    let token = setup_token(&env, &admin);
    setup_profile(&client, &voter1, "voter1", &token);
    setup_profile(&client, &voter2, "voter2", &token);
    setup_profile(&client, &voter3, "voter3", &token);
    setup_profile(&client, &voter4, "voter4", &token);

    // Propose
    let proposal_id = client.gov_propose(
        &voter1,
        &SdkString::from_str(&env, "Test proposal"),
        &SdkString::from_str(&env, "some_action"),
        &vec![&env],
    );

    // 3 votes against, 1 vote for (quorum met but majority against)
    client.gov_vote(&voter1, &proposal_id, &false);
    client.gov_vote(&voter2, &proposal_id, &false);
    client.gov_vote(&voter3, &proposal_id, &false);
    client.gov_vote(&voter4, &proposal_id, &true);

    // Advance ledger
    env.ledger().with_mut(|ledger| {
        ledger.sequence_number += 1001;
    });

    // Attempt to execute should fail (majority voted against)
    let result = client.try_gov_execute(&admin, &proposal_id);
    assert!(result.is_err());
}

#[test]
fn test_governance_double_vote_prevention() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, _treasury) = setup_contract(&env);

    client.set_gov_quorum(&admin, &2);
    client.set_gov_voting_period(&admin, &1000u32);

    let voter = Address::generate(&env);
    let token = setup_token(&env, &admin);
    setup_profile(&client, &voter, "voter", &token);

    let proposal_id = client.gov_propose(
        &voter,
        &SdkString::from_str(&env, "Test"),
        &SdkString::from_str(&env, "action"),
        &vec![&env],
    );

    // First vote succeeds
    client.gov_vote(&voter, &proposal_id, &true);

    // Second vote should fail (double voting)
    let result = client.try_gov_vote(&voter, &proposal_id, &true);
    assert!(result.is_err());
}
