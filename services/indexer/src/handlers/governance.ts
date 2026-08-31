import { Database } from "../db";

export interface GovProposalCreatedEvent {
  proposal_id: bigint;
  proposer: string;
  parameter: string;
  new_value: bigint;
  ledger: number;
}

export interface GovVoteEvent {
  proposal_id: bigint;
  voter: string;
  support: boolean;
  ledger: number;
}

export interface GovProposalExecutedEvent {
  proposal_id: bigint;
  parameter: string;
  new_value: bigint;
  ledger: number;
}

export interface GovProposalVetoedEvent {
  proposal_id: bigint;
  ledger: number;
}

/**
 * Handle a gov_proposal_created event.
 */
export async function handleGovProposalCreated(
  db: Database,
  event: GovProposalCreatedEvent
): Promise<void> {
  if (!event.proposal_id) {
    throw new Error("GovProposalCreated event missing proposal_id");
  }
  if (!event.proposer) {
    throw new Error("GovProposalCreated event missing proposer");
  }
  if (!event.parameter) {
    throw new Error("GovProposalCreated event missing parameter");
  }

  await db.upsertGovernanceProposal({
    proposal_id: event.proposal_id,
    proposer: event.proposer,
    parameter: event.parameter,
    new_value: event.new_value,
    status: "Active",
    created_ledger: event.ledger,
    updated_ledger: event.ledger,
  });
}

/**
 * Handle a gov_vote event.
 */
export async function handleGovVote(db: Database, event: GovVoteEvent): Promise<void> {
  if (!event.proposal_id) {
    throw new Error("GovVote event missing proposal_id");
  }
  if (!event.voter) {
    throw new Error("GovVote event missing voter");
  }

  await db.insertGovernanceVote({
    proposal_id: event.proposal_id,
    voter: event.voter,
    support: event.support,
    ledger: event.ledger,
  });
}

/**
 * Handle a gov_proposal_executed event.
 */
export async function handleGovProposalExecuted(
  db: Database,
  event: GovProposalExecutedEvent
): Promise<void> {
  if (!event.proposal_id) {
    throw new Error("GovProposalExecuted event missing proposal_id");
  }

  await db.updateGovernanceProposalStatus(event.proposal_id, "Executed", event.ledger);
}

/**
 * Handle a gov_proposal_vetoed event.
 */
export async function handleGovProposalVetoed(
  db: Database,
  event: GovProposalVetoedEvent
): Promise<void> {
  if (!event.proposal_id) {
    throw new Error("GovProposalVetoed event missing proposal_id");
  }

  await db.updateGovernanceProposalStatus(event.proposal_id, "Vetoed", event.ledger);
}
