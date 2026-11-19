# Token Vesting (`LinkoraVesting`)

Issue: #1768

Distributes tokens to creators on a schedule: a lock-up (cliff) followed by a
linear unlock. Contract: `packages/contracts/contracts/linkora-vesting`.

## Schedule

A vest starts when it is created (`start = ledger timestamp`):

```text
vested(t) = 0                                  if t < start + cliff
          = total * (t - start) / duration     if start + cliff <= t < start + duration
          = total                              if t >= start + duration
```

Nothing can be claimed before the cliff; at the cliff the amount accrued since
the start unlocks at once, then the rest unlocks every second. The division
rounds down and is computed without overflow for any `i128` total
(`total = q·duration + r` ⇒ `q·elapsed + r·elapsed/duration`). `duration` is at
most 100 years and `cliff <= duration`.

## Contract API

| Entrypoint                                                                                                             | Arguments                                                                           | Notes                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `initialize`                                                                                                           | `admin: Address, treasury: Address`                                                 | Once.                                                                                                                            |
| `create_vest`                                                                                                          | `beneficiary, token, total_amount: i128, cliff_seconds: u64, duration_seconds: u64` | Admin; transfers `total_amount` from the admin into the contract. Returns the vest id.                                           |
| `claim`                                                                                                                | `vest_id: u64`                                                                      | Beneficiary auth. Pays everything vested and unclaimed; returns it.                                                              |
| `revoke`                                                                                                               | `vest_id: u64`                                                                      | Admin. Vesting stops now: what has vested stays claimable by the beneficiary, the unvested rest goes to the treasury (returned). |
| `set_treasury`                                                                                                         | `treasury: Address`                                                                 | Admin.                                                                                                                           |
| `get_vest`, `get_vests_of`, `get_vested_amount`, `get_claimable_amount`, `get_vest_count`, `get_admin`, `get_treasury` |                                                                                     | Reads.                                                                                                                           |

A beneficiary can hold up to 50 vests (`get_vests_of` stays bounded).

## Events

| Event (first topic) | Topics                        | Data                                                             |
| ------------------- | ----------------------------- | ---------------------------------------------------------------- |
| `vest_created`      | version, vest_id, beneficiary | token, total_amount, start_time, cliff_seconds, duration_seconds |
| `tokens_claimed`    | version, vest_id, beneficiary | amount, total_claimed                                            |
| `vest_revoked`      | version, vest_id, beneficiary | returned_amount, vested_amount                                   |

## Errors (`VestingError`)

`AlreadyInitialized` (1), `NotInitialized` (2), `InvalidAmount` (3),
`InvalidSchedule` (4), `VestNotFound` (5), `NothingToClaim` (6),
`AlreadyRevoked` (7), `TooManyVests` (8).

## Tests

- `src/test.rs` — 27 unit tests: creation and validation, the cliff, linear
  unlock and rounding, partial claims, revocation before/during/after vesting,
  events, auth.
- `tests/fuzz_vesting.rs` — property tests (proptest): the arithmetic matches
  an exact reference, is monotonic and bounded, exact at the cliff and the
  end; through the contract, claims at random times always pay exactly what
  vested, and revoking at any time splits the total exactly between the
  beneficiary and the treasury with nothing left in the contract.

```bash
cd packages/contracts && cargo test -p linkora-vesting
```
