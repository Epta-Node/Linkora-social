#![cfg(test)]

use ed25519_dalek::{Signer, SigningKey};
use linkora_contracts::{LinkoraContract, LinkoraContractClient};
use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, vec, Address, Bytes, BytesN, Env};

// Property-based tests for the Ed25519 signature gate on `update_credential_root`
// and the Merkle proof check in `verify_credential` (issue #878). These fuzz the
// real contract (not a model), so a passing run is evidence the crypto is wired
// correctly rather than just internally consistent.

fn setup(env: &Env) -> (LinkoraContractClient<'_>, Address) {
    let contract_id = env.register(LinkoraContract, ());
    let client = LinkoraContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    let treasury = Address::generate(env);
    client.initialize(&admin, &treasury, &0);
    (client, admin)
}

fn key_from_seed(seed: [u8; 32]) -> SigningKey {
    SigningKey::from_bytes(&seed)
}

fn pubkey_of(env: &Env, key: &SigningKey) -> BytesN<32> {
    BytesN::from_array(env, &key.verifying_key().to_bytes())
}

/// Mirrors the private `LinkoraContract::credential_root_message_hash`.
fn message_hash(env: &Env, root: &BytesN<32>) -> BytesN<32> {
    let mut data = Bytes::new(env);
    data.append(&root.to_bytes());

    let ledger = env.ledger().sequence();
    data.push_back(((ledger >> 24) & 0xff) as u8);
    data.push_back(((ledger >> 16) & 0xff) as u8);
    data.push_back(((ledger >> 8) & 0xff) as u8);
    data.push_back((ledger & 0xff) as u8);

    env.crypto().sha256(&data).into()
}

fn sign_root(env: &Env, key: &SigningKey, root: &BytesN<32>) -> BytesN<64> {
    let hash = message_hash(env, root);
    let signature = key.sign(&hash.to_array());
    BytesN::from_array(env, &signature.to_bytes())
}

/// Mirrors the private `LinkoraContract::hash_merkle_pair` (order-independent
/// pairwise hash used by the Merkle proof check in `verify_credential`).
fn hash_pair(env: &Env, left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    let (lo, hi) = if left <= right {
        (left, right)
    } else {
        (right, left)
    };
    let mut data = Bytes::new(env);
    data.append(&Bytes::from_array(env, lo));
    data.append(&Bytes::from_array(env, hi));
    let hash: BytesN<32> = env.crypto().sha256(&data).into();
    hash.to_array()
}

proptest! {
    /// Any root signed by the registered authority key must be accepted,
    /// regardless of what the root bytes happen to be.
    #[test]
    fn prop_valid_signature_always_accepted(
        authority_seed in any::<[u8; 32]>(),
        root_bytes in any::<[u8; 32]>(),
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = setup(&env);

        let authority_key = key_from_seed(authority_seed);
        let pubkey = pubkey_of(&env, &authority_key);
        client.set_credential_authority(&admin, &pubkey);

        let user = Address::generate(&env);
        let root = BytesN::from_array(&env, &root_bytes);
        let signature = sign_root(&env, &authority_key, &root);

        let result = client.try_update_credential_root(&user, &root, &signature);
        prop_assert!(result.is_ok(), "valid signature from the registered authority must be accepted");
        prop_assert_eq!(client.get_credential_root(&user).unwrap(), root);
    }

    /// A signature produced by any key other than the registered authority
    /// must never be accepted, no matter what the key or root are.
    #[test]
    fn prop_signature_from_unregistered_key_rejected(
        authority_seed in any::<[u8; 32]>(),
        attacker_seed in any::<[u8; 32]>(),
        root_bytes in any::<[u8; 32]>(),
    ) {
        prop_assume!(authority_seed != attacker_seed);

        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = setup(&env);

        let authority_key = key_from_seed(authority_seed);
        let pubkey = pubkey_of(&env, &authority_key);
        client.set_credential_authority(&admin, &pubkey);

        let attacker_key = key_from_seed(attacker_seed);
        // The attacker's key must not itself collide with the registered pubkey.
        prop_assume!(pubkey_of(&env, &attacker_key) != pubkey);

        let user = Address::generate(&env);
        let root = BytesN::from_array(&env, &root_bytes);
        let forged_signature = sign_root(&env, &attacker_key, &root);

        let result = client.try_update_credential_root(&user, &root, &forged_signature);
        prop_assert!(result.is_err(), "signature from a non-authority key must be rejected");
    }

    /// A signature is only valid for the exact root it was computed over —
    /// replaying it against a different root must fail.
    #[test]
    fn prop_signature_does_not_authorize_a_different_root(
        authority_seed in any::<[u8; 32]>(),
        signed_root_bytes in any::<[u8; 32]>(),
        submitted_root_bytes in any::<[u8; 32]>(),
    ) {
        prop_assume!(signed_root_bytes != submitted_root_bytes);

        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = setup(&env);

        let authority_key = key_from_seed(authority_seed);
        let pubkey = pubkey_of(&env, &authority_key);
        client.set_credential_authority(&admin, &pubkey);

        let user = Address::generate(&env);
        let signed_root = BytesN::from_array(&env, &signed_root_bytes);
        let signature = sign_root(&env, &authority_key, &signed_root);

        let submitted_root = BytesN::from_array(&env, &submitted_root_bytes);
        let result = client.try_update_credential_root(&user, &submitted_root, &signature);
        prop_assert!(result.is_err(), "a signature over one root must not authorize a different root");
    }

    /// A correctly constructed two-leaf Merkle proof must verify against the
    /// root it was built from, and must stop verifying once the leaf changes.
    #[test]
    fn prop_merkle_proof_matches_leaf_and_rejects_tamper(
        authority_seed in any::<[u8; 32]>(),
        leaf_bytes in any::<[u8; 32]>(),
        sibling_bytes in any::<[u8; 32]>(),
        nullifier_bytes in any::<[u8; 32]>(),
    ) {
        prop_assume!(leaf_bytes != sibling_bytes);

        let env = Env::default();
        env.mock_all_auths();
        let (client, admin) = setup(&env);

        let authority_key = key_from_seed(authority_seed);
        let pubkey = pubkey_of(&env, &authority_key);
        client.set_credential_authority(&admin, &pubkey);

        let root_bytes = hash_pair(&env, &leaf_bytes, &sibling_bytes);
        let root = BytesN::from_array(&env, &root_bytes);
        let user = Address::generate(&env);
        let signature = sign_root(&env, &authority_key, &root);
        client.update_credential_root(&user, &root, &signature);

        let leaf = BytesN::from_array(&env, &leaf_bytes);
        let sibling = BytesN::from_array(&env, &sibling_bytes);
        let nullifier = BytesN::from_array(&env, &nullifier_bytes);
        let proof = vec![&env, sibling];

        let accepted = client.verify_credential(&user, &proof, &leaf, &nullifier);
        prop_assert!(accepted, "a correctly constructed Merkle proof must verify against the stored root");

        // A different leaf paired with the same proof must not reconstruct
        // the same root (a fresh nullifier avoids the replay-guard short-circuit).
        let mut tampered_leaf_bytes = leaf_bytes;
        tampered_leaf_bytes[0] ^= 0x01;
        prop_assume!(tampered_leaf_bytes != leaf_bytes);
        let tampered_leaf = BytesN::from_array(&env, &tampered_leaf_bytes);

        let mut other_nullifier_bytes = nullifier_bytes;
        other_nullifier_bytes[0] ^= 0x01;
        let other_nullifier = BytesN::from_array(&env, &other_nullifier_bytes);

        let rejected = client.verify_credential(&user, &proof, &tampered_leaf, &other_nullifier);
        prop_assert!(!rejected, "a tampered leaf must not verify against the original root");
    }
}
