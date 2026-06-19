/**
 * Types representing the data structures returned by the smart contracts
 */

export interface Profile {
  address: string;
  username: string;
  creator_token: string;
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

/** Parameters for deploying a new SEP-41 creator token via the token factory. */
export interface DeployTokenParams {
  /** The creator's address — becomes the token admin and receives initial_supply. */
  deployer: string;
  name: string;
  symbol: string;
  decimals: number;
  /** Stroops to mint to deployer on creation (>= 0). */
  initialSupply: bigint;
}
