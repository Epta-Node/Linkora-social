# Fuzz / invariant testing

The contract crate uses [`proptest`](https://docs.rs/proptest) (not
`cargo-fuzz`/libFuzzer) for property-based testing: it runs entirely on
stable Rust through `cargo test`, needs no nightly toolchain or coverage
instrumentation, and can drive the real `LinkoraContractClient` (auth,
storage, token transfers) the same way the unit tests do — libFuzzer targets
would need a hand-rolled harness to get that.

## Files

- `fuzz_social_graph.rs` — follow/unfollow/block state-machine properties.
- `invariant_social_graph.rs` — cross-cutting accounting invariants:
  - `invariant_follow_count_matches_rows` — follower/following counts equal
    the rows actually stored, for any sequence of follow/unfollow calls.
  - `invariant_like_count_matches_likers` — `like_count` always equals the
    number of distinct successful likers (repeat likes are no-ops).
  - `invariant_tip_balance_conservation` — for every tip, `tipper` debit ==
    `author` credit + `treasury` credit, and `Post.tip_total` accumulates
    only the author's share, never the fee.
  - `invariant_pool_balance_conservation` — `Pool.balance` always equals
    `sum(deposits) - sum(withdrawals)` for any interleaving of the two.
- `fuzz_tip.rs` — fee-split arithmetic properties (overflow/rounding).
- `invariants.rs` — narrative invariant checklist backed by the contract's
  unit test suite (`src/test.rs`).

## Running

```sh
cd packages/contracts
cargo test -p linkora-contracts --test invariant_social_graph
cargo test -p linkora-contracts --test fuzz_social_graph
```

Every `proptest!` block runs its cases on each `cargo test` invocation (see
`ProptestConfig` in a given file to change the case count). A failing case
is automatically shrunk and written to a `<file>.proptest-regressions` file
next to the test; commit that file if you want the exact failing input
replayed on every future run.

## Adding a new invariant

1. Pick a property that must hold regardless of the operation sequence
   (e.g. "sum of X never exceeds Y", "state after inverse ops is unchanged").
2. Add a `#[test] fn invariant_...(` case inside a `proptest! { ... }` block
   in `invariant_social_graph.rs` (or a new `tests/invariant_*.rs` file).
3. Drive the real contract via `LinkoraContractClient`, generate inputs with
   `prop::collection::vec`/ranges instead of hardcoded values, and assert
   with `prop_assert!`/`prop_assert_eq!` (not `assert!`) so proptest can
   shrink failures.
4. Run it locally until it's green, then let CI's fuzz job (`.github/workflows/ci.yml`,
   `fuzz-tests` job) pick it up automatically — it runs every `tests/*.rs`
   proptest target on every push/PR.
