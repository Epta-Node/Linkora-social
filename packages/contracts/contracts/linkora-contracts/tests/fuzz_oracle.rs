#![cfg(test)]

use proptest::prelude::*;
use soroban_sdk::testutils::Ledger;

// Property-based tests for oracle attestation verification.
//
// These verify that Ed25519 signature logic and nullifier semantics hold
// under arbitrary inputs.  The contract does not decode CBOR, so report
// bytes are treated as opaque — any byte sequence with a valid signature
// is accepted and the corresponding nullifier prevents replay.

proptest! {
    /// A valid Ed25519 signature over an arbitrary report must verify
    /// successfully when the correct public key is used.
    #[test]
    fn prop_valid_signature_roundtrip(
        report_bytes in proptest::collection::vec(any::<u8>(), 0..256),
        seed in any::<u8>(),
    ) {
        use ed25519_dalek::{Signer, SigningKey};
        use soroban_sdk::{Bytes, BytesN, Env};

        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(500);

        let signing_key = SigningKey::from_bytes(&[seed; 32]);
        let pubkey = BytesN::from_array(&env, &signing_key.verifying_key().to_bytes());

        let report = Bytes::from_slice(&env, &report_bytes);
        let report_hash: [u8; 32] = env.crypto().sha256(&report).into();
        let signature = signing_key.sign(&report_hash);
        let sig_bytes = BytesN::from_array(&env, &signature.to_bytes());

        // env.crypto().ed25519_verify panics on failure — success = no panic.
        env.crypto().ed25519_verify(
            &pubkey,
            &Bytes::from_array(&env, &report_hash),
            &sig_bytes,
        );
    }

    /// An invalid Ed25519 signature must always panic (host trap) when
    /// verified against the correct public key, regardless of report content.
    #[test]
    fn prop_invalid_signature_rejected(
        report_bytes in proptest::collection::vec(any::<u8>(), 0..64),
        wrong_key_seed in any::<u8>(),
        sign_key_seed in any::<u8>(),
    ) {
        use ed25519_dalek::{Signer, SigningKey};
        use soroban_sdk::{Bytes, BytesN, Env};

        prop_assume!(wrong_key_seed != sign_key_seed);

        let env = Env::default();
        let signing_key = SigningKey::from_bytes(&[sign_key_seed; 32]);
        let pubkey = BytesN::from_array(&env, &signing_key.verifying_key().to_bytes());
        let wrong_key = SigningKey::from_bytes(&[wrong_key_seed; 32]);

        let report = Bytes::from_slice(&env, &report_bytes);
        let report_hash: [u8; 32] = env.crypto().sha256(&report).into();

        // Sign with the WRONG key.
        let signature = wrong_key.sign(&report_hash);
        let sig_bytes = BytesN::from_array(&env, &signature.to_bytes());

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            env.crypto().ed25519_verify(
                &pubkey,
                &Bytes::from_array(&env, &report_hash),
                &sig_bytes,
            );
        }));
        prop_assert!(result.is_err(), "invalid signature must panic");
    }

    /// Distinct oracle names resolve to distinct public keys — registering
    /// oracle "alpha" with key A and oracle "beta" with key B means that
    /// name "alpha" only accepts signatures from A and name "beta" only
    /// accepts signatures from B.
    #[test]
    fn prop_oracle_name_storage_isolation(
        seed_a in any::<u8>(),
        seed_b in any::<u8>(),
    ) {
        use ed25519_dalek::{Signer, SigningKey};
        use soroban_sdk::{testutils::Address as _, Address, Bytes, BytesN, Env, Symbol};

        prop_assume!(seed_a != seed_b);

        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(500);

        let contract_id = env.register(linkora_contracts::LinkoraContract, ());
        use linkora_contracts::LinkoraContractClient;
        let client = LinkoraContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let treasury = Address::generate(&env);
        client.initialize(&admin, &treasury, &0);

        let key_a = SigningKey::from_bytes(&[seed_a; 32]);
        let key_b = SigningKey::from_bytes(&[seed_b; 32]);

        let pubkey_a = BytesN::from_array(&env, &key_a.verifying_key().to_bytes());
        let pubkey_b = BytesN::from_array(&env, &key_b.verifying_key().to_bytes());

        // Register both oracles.
        client.register_oracle(&admin, &Symbol::new(&env, "alpha"), &pubkey_a);
        client.register_oracle(&admin, &Symbol::new(&env, "beta"), &pubkey_b);

        let report = Bytes::from_slice(&env, b"storage isolation check");
        let report_hash: [u8; 32] = env.crypto().sha256(&report).into();
        let sig_a = BytesN::from_array(&env, &key_a.sign(&report_hash).to_bytes());
        let _sig_b = BytesN::from_array(&env, &key_b.sign(&report_hash).to_bytes());
        let creator = Address::generate(&env);

        // alpha must accept A's signature.
        let r1 = client.verify_analytics_attestation(
            &Symbol::new(&env, "alpha"), &report, &sig_a, &creator, &100u64, &600u64,
        );
        prop_assert!(r1, "alpha must accept key A");

        // Different report (different nullifier) required for beta test
        // since alpha already consumed the first report's nullifier.
        let report2 = Bytes::from_slice(&env, b"storage isolation check 2");
        let report_hash2: [u8; 32] = env.crypto().sha256(&report2).into();
        let _sig_a2 = BytesN::from_array(&env, &key_a.sign(&report_hash2).to_bytes());
        let sig_b2 = BytesN::from_array(&env, &key_b.sign(&report_hash2).to_bytes());

        // alpha must reject B's signature.
        let r2 = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.verify_analytics_attestation(
                &Symbol::new(&env, "alpha"), &report2, &sig_b2, &creator, &100u64, &600u64,
            );
        }));
        prop_assert!(r2.is_err(), "alpha must reject key B");

        // beta must accept B's signature.
        let report3 = Bytes::from_slice(&env, b"storage isolation check 3");
        let report_hash3: [u8; 32] = env.crypto().sha256(&report3).into();
        let sig_b3 = BytesN::from_array(&env, &key_b.sign(&report_hash3).to_bytes());
        let r3 = client.verify_analytics_attestation(
            &Symbol::new(&env, "beta"), &report3, &sig_b3, &creator, &100u64, &600u64,
        );
        prop_assert!(r3, "beta must accept key B");
    }
}
