# Governance Appeals for Moderation Removals

Issue: #1766

When a moderator upholds a report, the post is removed and an appeal window
opens (`APPEAL_WINDOW_LEDGERS`, about 2 days). The author already could ask the
`mods` pool to review the removal (`appeal_moderation` / `review_appeal`).
`appeal_removal` adds a second route: the author puts the removal to a vote of
**governance token holders**, with stakes on both sides.

## Flow

1. **File** — the author calls `appeal_removal(appellant, post_id, reason)`
   while the appeal window is open. One appeal per post, across both routes.
   The author posts `appeal_stake` of the stake token.
2. **Vote** — for 7 days (`APPEAL_VOTING_PERIOD_SECONDS`, ledger timestamp),
   holders call `vote_appeal(voter, appeal_id, vote)`. A vote weighs the
   voter's whole governance token balance, which the contract holds until the
   appeal is resolved, so the same tokens cannot vote twice. One vote per
   holder; the author and the moderator who removed the post cannot vote.
3. **Resolve** — once the 7 days are over, anyone calls
   `resolve_appeal(appeal_id)`. The appeal **passes** with strictly more than
   50% of the voted weight in favour; a tie or no votes fails it.
   - **Passed:** the post is restored (and relinked to its author), the stake
     is refunded, and the original moderator's bond loses `moderator_slash`
     (capped at what is bonded), sent to the treasury.
   - **Failed:** the post stays removed and the author's stake goes to the
     treasury.
4. **Withdraw** — after resolution each voter calls
   `withdraw_appeal_vote(voter, appeal_id)` to get their tokens back.

## Moderator bonds

Moderators back their decisions with a bond in the stake token:
`stake_moderator_bond(moderator, amount)` and
`unstake_moderator_bond(moderator, amount)`. A moderator cannot unstake while an
appeal against one of their removals is being voted on. `review_report` now
records which moderator upheld each removal (`ModerationModerator(post_id)`);
removals made before this change have no recorded moderator, so an appeal
against them slashes nobody.

## Configuration

`set_appeal_config(admin, gov_token, stake_token, appeal_stake, moderator_slash)`
(admin only). Each appeal keeps a copy of the values that applied when it was
filed, so later changes do not affect appeals in progress.

## Contract API

| Entrypoint                                        | Arguments                                          | Notes                                                        |
| ------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| `appeal_removal`                                  | `appellant: Address, post_id: u64, reason: String` | Returns the appeal id. Reason: 1-500 bytes.                  |
| `vote_appeal`                                     | `voter: Address, appeal_id: u64, vote: bool`       | Weight = voter's `gov_token` balance, held until resolution. |
| `resolve_appeal`                                  | `appeal_id: u64`                                   | Anyone, after `voting_ends_at`. Returns whether it passed.   |
| `withdraw_appeal_vote`                            | `voter: Address, appeal_id: u64`                   | After resolution. Returns the amount.                        |
| `stake_moderator_bond` / `unstake_moderator_bond` | `moderator: Address, amount: i128`                 | Moderator role required to stake.                            |
| `set_appeal_config` / `get_appeal_config`         | see above                                          |                                                              |
| `get_gov_appeal`                                  | `appeal_id: u64`                                   | `GovAppeal` (status `Voting`, `Passed` or `Failed`).         |
| `get_post_gov_appeal`                             | `post_id: u64`                                     | Appeal id for the post, if any.                              |
| `get_appeal_vote`                                 | `appeal_id: u64, voter: Address`                   | `AppealVote { support, weight, withdrawn }`.                 |
| `get_moderator_bond`                              | `moderator: Address`                               | `ModeratorBond { token, amount }`.                           |

## Events

| Event (first topic) | Topics                      | Data                                                                   |
| ------------------- | --------------------------- | ---------------------------------------------------------------------- |
| `appeal_filed`      | version, appeal_id, post_id | appellant, stake_amount, voting_ends_at                                |
| `appeal_voted`      | version, appeal_id, voter   | support, weight                                                        |
| `appeal_resolved`   | version, appeal_id, post_id | passed, votes_for, votes_against, moderator_slashed, appellant_slashed |

## Revert conditions

| Message                                                | Cause                                               |
| ------------------------------------------------------ | --------------------------------------------------- |
| `appeal voting not configured`                         | `set_appeal_config` was never called.               |
| `no moderation decision to appeal`                     | The post was not removed by moderation.             |
| `only the post author can appeal`                      | Caller is not the removed post's author.            |
| `appeal window has closed`                             | Past the `review_report` appeal deadline.           |
| `appeal already filed`                                 | The post already has an appeal (either route).      |
| `appeal reason must be 1-500 bytes`                    | Empty or too long reason.                           |
| `voting period has ended` / `voting period still open` | Vote after, or resolve before, `voting_ends_at`.    |
| `parties to the appeal cannot vote`                    | The author or the original moderator tried to vote. |
| `only governance token holders can vote`               | Voter holds no governance tokens.                   |
| `already voted` / `vote already withdrawn`             | Second vote or second withdrawal.                   |
| `moderator has appeals in progress`                    | Unstaking during an open appeal.                    |

## Tests

`packages/contracts/contracts/linkora-wasm-tests/tests/governance_appeals.rs`
(31 tests) drives the compiled contract WASM through every appeal state:
filing rules, weighted votes, escrow, the 7-day deadline, pass/fail/tie/no-vote
outcomes, slashing (capped and unbonded), withdrawals and bond locking.

They run against the WASM rather than natively because `linkora-contracts`
does not compile with soroban-sdk 26 `testutils` on: `#[contracttype]` cannot
derive the XDR conversion for `GovProposal`'s `Option<ProposalMetadata>` field.
Build the WASM first:

```bash
cd packages/contracts
cargo build --target wasm32v1-none --release -p linkora-contracts
cp target/wasm32v1-none/release/linkora_contracts.wasm contracts/linkora-contracts/
cargo test -p linkora-wasm-tests
```
