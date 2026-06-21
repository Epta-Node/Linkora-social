# ADR-007: Community-Driven Content Moderation and Slashed Stakes

**Status:** Proposed  
**Date:** 2026-06-21  
**Authors:** Antigravity

## Context

The SocialFi platform currently has no mechanism to remove harmful content or spam, other than the original author calling `delete_post`. To maintain a safe and high-quality environment without centralizing moderation authority in a single key, the protocol requires a decentralized community-driven content moderation layer. 

The mechanism must prevent spam reports (griefing) while routing legitimate reports to the admin/moderator pool, enforcing economic penalties (slashing) on malicious actors.

## Decision

We implement a content moderation layer that:
1. Allows users to report any post by locking a configurable stake amount of an on-chain token.
2. Routes reports to the `ADMIN` pool, requiring threshold signatures (M-of-N) of the pool's administrators to resolve a report.
3. Enforces an economic incentive system:
   - **Upheld Reports:** The reported post is deleted, the reporter's stake is returned, and the post author's creator token balance is slashed by a percentage defined in the governance parameters (`GovParameter::ModerationSlashBps`).
   - **Dismissed Reports:** The reporter's stake is forfeited and transferred to the protocol treasury to deter frivolous reports.

## Design

### 1. Stake-Weighted vs. One-Address-One-Vote Reporting

| Criterion | Stake-Weighted Reporting | One-Address-One-Vote Reporting |
|---|---|---|
| Spam / Griefing Resistance | High — reporting requires capital commitment which is slashed if frivolous | Low — attackers can create multiple Sybil accounts to report posts for free |
| Sybil Resistance | Naturally Sybil-resistant (tokens are scarce) | Weak — easily bypassed by spawning multiple accounts |
| Moderation Load | Low — only high-conviction reports are filed | High — administrators are overwhelmed with low-quality spam reports |

**Choice: Stake-weighted.** To prevent griefing and spam reporting, users must deposit an on-chain stake when reporting. This ensures that filing a report carries direct financial consequences.

### 2. Incentive Design and Griefing Prevention

To prevent users from griefing content creators or spamming the moderators:
- **Upheld Verdict:** The reporter acted correctly. Their stake is returned in full. The author of the violating post is slashed.
- **Dismissed Verdict:** The reporter filed a frivolous or malicious report. Their entire stake is slashed and sent to the protocol treasury.

This economic asymmetry ensures reporters only report posts that they are highly confident violate community standards.

### 3. Relationship to Governance (ADR-004)

The slash percentage is configurable via the existing on-chain governance system (ADR-004). We introduce a new governance parameter:
- `GovParameter::ModerationSlashBps`: The basis points (0 to 10,000) of the author's creator token balance that will be burned when a post violation is upheld.
- This parameter is executed via `gov_execute` just like other governance parameters.

### 4. The Slash Mechanic

On an `Upheld` report:
- The contract checks if the author has registered a profile containing a `creator_token` address.
- If a creator token exists, the contract calls `token.burn(author, slash_amount)` where `slash_amount` is calculated as `(author_balance * moderation_slash_bps) / 10,000`.
- The reporter's stake is refunded in full.

### 5. Storage Layout

The following storage keys are added to `StorageKey` enum:
- `StorageKey::Report(u64, Address)` (Persistent): Stores the `Report` struct mapping a `(post_id, reporter)` to its state.
- `StorageKey::ReportCount(u64)` (Persistent): Stores the `u32` count of total reports submitted for a given `post_id`.

And the contract type structures:
```rust
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReportStatus {
    Pending,
    Dismissed,
    Upheld,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Report {
    pub post_id: u64,
    pub reporter: Address,
    pub stake_amount: i128,
    pub token: Address,
    pub reason_hash: BytesN<32>,
    pub created_ledger: u32,
    pub status: ReportStatus,
}
```

## Consequences

### Positive
- Robust, spam-resistant moderation mechanism.
- Financial alignment of incentives between reporters and creators.
- Integration with governance for configurable penalties.

### Negative
- Slashed creator tokens require the contract to have permission to burn from authors, which must be supported by the creator token contract design.
