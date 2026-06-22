/**
 * Types representing the data structures returned by the smart contracts
 */

export interface Profile {
  address: string;
  username: string;
  creator_token: string;
  bio?: string | null;
}

export interface Post {
  id: number;
  author: string;
  content: string;
  tip_total: number;
  timestamp: number;
  like_count: number;
}

export interface Pool {
  pool_id: string;
  token: string;
  balance: bigint;
  admins: string[];
  threshold: number;
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

