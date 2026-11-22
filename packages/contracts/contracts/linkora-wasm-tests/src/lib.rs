#![no_std]
//! Test-only crate: tests in `tests/` run the compiled `LinkoraContract` WASM
//! (`contracts/linkora-contracts/linkora_contracts.wasm`, rebuilt by CI before
//! `cargo test`).
//!
//! They live outside `linkora-contracts` because that crate does not build
//! with soroban-sdk 26 `testutils` on: `#[contracttype]` cannot derive the
//! XDR conversion for `GovProposal`'s `Option<ProposalMetadata>` field.
//! Driving the WASM side-steps that and also meters real VM costs.
