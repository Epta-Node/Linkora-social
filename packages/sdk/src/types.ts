/**
 * Types representing the data structures returned by the smart contracts.
 *
 * These types are auto-generated from the contract ABI and re-exported here.
 * Run `pnpm codegen` to regenerate from the compiled contract WASM.
 */

// Re-export all generated contract types (Profile, Post, Pool, GovParameter, etc.)
export * from "./generated/types";

/** Analytics attestation returned by the oracle service REST API. */
export interface AnalyticsAttestation {
  oracleName: string;
  reportHash: string;
  reportCbor: string;
  signature: string;
  txHash: string;
  submittedAt: number;
  report: {
    version: number;
    creator: string;
    windowStart: string;
    windowEnd: string;
    totalTips: string;
    postCount: string;
    followerDelta: string;
    uniqueTippers: number;
  };
}

export type GovParameter =
  | "FeeBps"
  | "Treasury"
  | "TipCooldownWindow"
  | "GovQuorum"
  | "GovTimeLock"
  | "GovVoteWindow";

export type GovStatus =
  | "Active"
  | "Passed"
  | "Executed"
  | "Vetoed"
  | "Failed";

export interface GovProposal {
  id: number;
  proposer: string;
  parameter: GovParameter;
  new_value: number;
  new_address?: string | null;
  votes_for: number;
  votes_against: number;
  created_ledger: number;
  status: GovStatus;
}

export interface GovConfig {
  quorum: number;
  time_lock_ledgers: number;
  vote_window_ledgers: number;
  quorum_decay_rate_bps: number;
  quorum_floor: number;
}

