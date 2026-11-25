use linkora_contracts::{
    GovParameter, GovStatus, LinkoraContract, LinkoraContractClient, ProposalMetadata,
};
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    vec, Address, Env, String as SdkString, Symbol,
};

fn setup_contract(env: &Env) -> (LinkoraContractClient<'_>, Address, Address) {
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    client.initialize(&admin, &treasury, &100u32);
    (client, admin, treasury)
}

fn setup_token(env: &Env, admin: &Address) -> Address {
    let token_id = env.register_stellar_asset_contract_v2(admin.clone());
    StellarAssetClient::new(env, &token_id.address()).mint(admin, &1_000_000_000);
    token_id.address()
}

fn no_metadata(env: &Env) -> ProposalMetadata {
    ProposalMetadata {
        title: SdkString::from_str(env, ""),
        description: SdkString::from_str(env, ""),
        rationale: SdkString::from_str(env, ""),
    }
}

fn setup_governance(
    env: &Env,
    quorum: u32,
    time_lock_ledgers: u32,
    vote_window_ledgers: u32,
) -> (LinkoraContractClient<'_>, Address, Address) {
    let (client, admin, treasury) = setup_contract(env);
    client.gov_init_config(
        &admin,
        &quorum,
        &time_lock_ledgers,
        &vote_window_ledgers,
        &50u32,
        &30u32,
    );
    (client, admin, treasury)
}

fn setup_veto_pool(
    env: &Env,
    client: &LinkoraContractClient<'_>,
    admin: &Address,
) -> (Symbol, soroban_sdk::Vec<Address>) {
    let signer_one = Address::generate(env);
    let signer_two = Address::generate(env);
    let token = setup_token(env, &signer_one);
    let pool_id = symbol_short!("vetpool");
    let signers = vec![env, signer_one.clone(), signer_two.clone()];
    client.create_pool(admin, &pool_id, &token, &signers, &2u32);
    (pool_id, signers)
}

#[test]
fn test_governance_lifecycle_executes_after_timelock() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _treasury) = setup_governance(&env, 60, 10, 10);

    let proposer = Address::generate(&env);
    let voter_one = Address::generate(&env);
    let voter_two = Address::generate(&env);
    let voter_three = Address::generate(&env);

    let proposal_id = client.gov_propose(
        &proposer,
        &GovParameter::FeeBps,
        &250u64,
        &None,
        &no_metadata(&env),
    );
    assert_eq!(
        client.gov_get_proposal(&proposal_id).status,
        GovStatus::Active
    );

    client.gov_vote(&voter_one, &proposal_id, &true);
    client.gov_vote(&voter_two, &proposal_id, &true);
    client.gov_vote(&voter_three, &proposal_id, &false);

    env.ledger().with_mut(|ledger| ledger.sequence_number += 20);
    client.gov_execute(&proposal_id);

    assert_eq!(client.get_fee_bps(), 250);
    assert_eq!(
        client.gov_get_proposal(&proposal_id).status,
        GovStatus::Executed
    );
}

#[test]
fn test_governance_lifecycle_veto_blocks_execution() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _treasury) = setup_governance(&env, 60, 10, 10);
    let (pool_id, signers) = setup_veto_pool(&env, &client, &admin);

    let proposer = Address::generate(&env);
    let voter = Address::generate(&env);
    let proposal_id = client.gov_propose(
        &proposer,
        &GovParameter::FeeBps,
        &300u64,
        &None,
        &no_metadata(&env),
    );

    client.gov_vote(&voter, &proposal_id, &true);
    env.ledger().with_mut(|ledger| ledger.sequence_number += 10);
    client.gov_veto(&signers, &pool_id, &proposal_id);

    assert_eq!(
        client.gov_get_proposal(&proposal_id).status,
        GovStatus::Vetoed
    );

    env.ledger().with_mut(|ledger| ledger.sequence_number += 10);
    assert!(client.try_gov_execute(&proposal_id).is_err());
    assert_eq!(client.get_fee_bps(), 100);
}

#[test]
fn test_governance_lifecycle_insufficient_quorum_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _treasury) = setup_governance(&env, 60, 10, 10);

    let proposer = Address::generate(&env);
    let voter_for = Address::generate(&env);
    let voter_against = Address::generate(&env);
    let voter_against_two = Address::generate(&env);

    let proposal_id = client.gov_propose(
        &proposer,
        &GovParameter::FeeBps,
        &400u64,
        &None,
        &no_metadata(&env),
    );

    client.gov_vote(&voter_for, &proposal_id, &true);
    client.gov_vote(&voter_against, &proposal_id, &false);
    client.gov_vote(&voter_against_two, &proposal_id, &false);

    env.ledger().with_mut(|ledger| ledger.sequence_number += 20);
    assert!(client.try_gov_execute(&proposal_id).is_err());

    assert_eq!(
        client.gov_get_proposal(&proposal_id).status,
        GovStatus::Active
    );
    assert_eq!(client.get_fee_bps(), 100);
}

#[test]
#[should_panic(expected = "already voted")]
fn test_governance_lifecycle_double_vote_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, _admin, _treasury) = setup_governance(&env, 60, 10, 10);

    let proposer = Address::generate(&env);
    let voter = Address::generate(&env);
    let proposal_id = client.gov_propose(
        &proposer,
        &GovParameter::FeeBps,
        &500u64,
        &None,
        &no_metadata(&env),
    );

    client.gov_vote(&voter, &proposal_id, &true);
    client.gov_vote(&voter, &proposal_id, &true);
}
