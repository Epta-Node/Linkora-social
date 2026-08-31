#![cfg(test)]

use crate::test::*;
use soroban_sdk::{vec, BytesN, Env, Vec};

/// Fuzz tests for the credential subsystem
/// These tests use property-based testing to verify Merkle verification properties.
/// Note: Soroban doesn't have a native fuzzing framework, so these are
/// property-based tests that verify invariants across multiple test cases.

#[test]
fn test_fuzz_property_valid_proof_verifies() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    let signing_key = credential_authority_signing_key(1);
    let pubkey = credential_authority_pubkey(&env, &signing_key);
    client.set_credential_authority(&admin, &pubkey);

    let user = <soroban_sdk::Address as soroban_sdk::testutils::Address>::generate(&env);

    // Property: For any valid (leaf, proof, root) triple, verification should succeed
    // Test with multiple different leaf values
    for i in 1..=10u8 {
        let leaf = BytesN::from_array(&env, &[i; 32]);
        let root = leaf.clone();
        let proof: Vec<BytesN<32>> = vec![&env];
        let signature = sign_credential_root(&env, &signing_key, &root);

        client.update_credential_root(&user, &root, &signature);

        let nullifier = BytesN::from_array(&env, &[i + 100; 32]);
        let result = client.verify_credential(&user, &proof, &leaf, &nullifier);

        assert!(result, "valid proof should verify for leaf value {}", i);
    }
}

#[test]
fn test_fuzz_property_wrong_leaf_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    let signing_key = credential_authority_signing_key(1);
    let pubkey = credential_authority_pubkey(&env, &signing_key);
    client.set_credential_authority(&admin, &pubkey);

    let user = <soroban_sdk::Address as soroban_sdk::testutils::Address>::generate(&env);

    // Property: For any root, a proof with a different leaf should fail
    let root = BytesN::from_array(&env, &[1u8; 32]);
    let signature = sign_credential_root(&env, &signing_key, &root);
    client.update_credential_root(&user, &root, &signature);

    for i in 2..=10u8 {
        let wrong_leaf = BytesN::from_array(&env, &[i; 32]);
        let proof: Vec<BytesN<32>> = vec![&env];
        let nullifier = BytesN::from_array(&env, &[i + 100; 32]);

        let result = client.verify_credential(&user, &proof, &wrong_leaf, &nullifier);

        assert!(!result, "wrong leaf should fail for value {}", i);
    }
}

#[test]
fn test_fuzz_property_merkle_root_computation() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    let signing_key = credential_authority_signing_key(1);
    let pubkey = credential_authority_pubkey(&env, &signing_key);
    client.set_credential_authority(&admin, &pubkey);

    let user = <soroban_sdk::Address as soroban_sdk::testutils::Address>::generate(&env);

    // Property: Merkle root computation is deterministic
    // For the same leaf and proof, the computed root should always be the same
    let leaf = BytesN::from_array(&env, &[1u8; 32]);
    let sibling = BytesN::from_array(&env, &[2u8; 32]);
    let proof = vec![&env, sibling.clone()];

    // Mirror the contract's `hash_ordered_pair`: sha256 of the two 32-byte
    // values concatenated in ascending byte order (leaf < sibling here).
    let mut data = soroban_sdk::Bytes::new(&env);
    data.append(&leaf.to_bytes());
    data.append(&sibling.to_bytes());
    let expected_root: BytesN<32> = env.crypto().sha256(&data).into();
    let signature = sign_credential_root(&env, &signing_key, &expected_root);

    client.update_credential_root(&user, &expected_root, &signature);

    // Verify multiple times - should always succeed
    for i in 1..=5u8 {
        let nullifier = BytesN::from_array(&env, &[i + 100; 32]);
        let result = client.verify_credential(&user, &proof, &leaf, &nullifier);
        assert!(
            result,
            "deterministic verification should succeed on iteration {}",
            i
        );
    }
}

#[test]
fn test_fuzz_property_nullifier_uniqueness_across_users() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    let signing_key = credential_authority_signing_key(1);
    let pubkey = credential_authority_pubkey(&env, &signing_key);
    client.set_credential_authority(&admin, &pubkey);

    // Property: The same nullifier can be used by different users
    let user1 = <soroban_sdk::Address as soroban_sdk::testutils::Address>::generate(&env);
    let user2 = <soroban_sdk::Address as soroban_sdk::testutils::Address>::generate(&env);
    let user3 = <soroban_sdk::Address as soroban_sdk::testutils::Address>::generate(&env);

    let leaf = BytesN::from_array(&env, &[1u8; 32]);
    let root = leaf.clone();
    let proof: Vec<BytesN<32>> = vec![&env];
    let nullifier = BytesN::from_array(&env, &[10u8; 32]);
    let signature = sign_credential_root(&env, &signing_key, &root);

    client.update_credential_root(&user1, &root, &signature);
    client.update_credential_root(&user2, &root, &signature);
    client.update_credential_root(&user3, &root, &signature);

    // Same nullifier should work for all different users
    assert!(client.verify_credential(&user1, &proof, &leaf, &nullifier));
    assert!(client.verify_credential(&user2, &proof, &leaf, &nullifier));
    assert!(client.verify_credential(&user3, &proof, &leaf, &nullifier));
}

#[test]
fn test_fuzz_property_multiple_proofs_same_root() {
    let env = Env::default();
    env.mock_all_auths();
    let (client, admin, _) = setup_contract(&env);

    let signing_key = credential_authority_signing_key(1);
    let pubkey = credential_authority_pubkey(&env, &signing_key);
    client.set_credential_authority(&admin, &pubkey);

    let user = <soroban_sdk::Address as soroban_sdk::testutils::Address>::generate(&env);

    // Property: Multiple different valid proofs can verify against the same root
    // (This would be the case with different leaves in the same Merkle tree)
    // For simplicity, we test that the same proof can be verified multiple times
    // with different nullifiers

    let leaf = BytesN::from_array(&env, &[1u8; 32]);
    let root = leaf.clone();
    let proof: Vec<BytesN<32>> = vec![&env];
    let signature = sign_credential_root(&env, &signing_key, &root);

    client.update_credential_root(&user, &root, &signature);

    // Verify the same proof multiple times with different nullifiers
    for i in 1..=10u8 {
        let nullifier = BytesN::from_array(&env, &[i; 32]);
        let result = client.verify_credential(&user, &proof, &leaf, &nullifier);
        assert!(
            result,
            "same proof should verify with different nullifier {}",
            i
        );
    }
}
