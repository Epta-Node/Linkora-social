use super::super::test::*;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

#[test]
#[should_panic(expected = "authority_pubkey must not be an all-zero or malformed public key")]
fn test_set_credential_authority_zero_pubkey_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);
    let zero_pubkey = BytesN::from_array(&env, &[0u8; 32]);

    client.set_credential_authority(&admin, &zero_pubkey);
}

#[test]
#[should_panic(expected = "new_root must not be an all-zero or malformed public key")]
fn test_update_credential_root_zero_root_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    let signing_key = credential_authority_signing_key(1);
    let pubkey = credential_authority_pubkey(&env, &signing_key);
    client.set_credential_authority(&admin, &pubkey);

    let user = Address::generate(&env);
    let zero_root = BytesN::from_array(&env, &[0u8; 32]);
    let dummy_sig = BytesN::from_array(&env, &[1u8; 64]);

    client.update_credential_root(&user, &zero_root, &dummy_sig);
}

#[test]
#[should_panic(expected = "signature must not be an all-zero or malformed signature")]
fn test_update_credential_root_zero_signature_rejected_governance() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    let signing_key = credential_authority_signing_key(1);
    let pubkey = credential_authority_pubkey(&env, &signing_key);
    client.set_credential_authority(&admin, &pubkey);

    let user = Address::generate(&env);
    let new_root = BytesN::from_array(&env, &[9u8; 32]);
    let zero_signature = BytesN::from_array(&env, &[0u8; 64]);

    client.update_credential_root(&user, &new_root, &zero_signature);
}
