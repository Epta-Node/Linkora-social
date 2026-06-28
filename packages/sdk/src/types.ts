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

/**
 * Ledger footprint describing read and write entries touched by a transaction.
 */
export interface LedgerFootprint {
  readOnly?: string[];
  readWrite?: string[];
}

/**
 * Result of simulating a transaction without submitting it.
 */
export interface SimulationResult {
  success: boolean;
  resourceFee: string;
  footprint?: LedgerFootprint;
  error?: string;
  eventLog?: unknown;
}

export interface TransactionLike {
  networkPassphrase: string;
  toEnvelope(): {
    toXDR(format: "base64"): string;
  };
}

/**
 * Interface for transaction signers (e.g., Freighter, Ledger, etc.)
 */
export interface Signer {
  /**
   * Get the public key associated with this signer.
   * @param derivationPath Optional derivation path for hardware wallets (e.g. "m/44'/148'/0'")
   */
  getPublicKey(derivationPath?: string): Promise<string>;

  /**
   * Sign a transaction envelope.
   * @param tx The transaction to sign
   * @param derivationPath Optional derivation path for hardware wallets
   */
  signTransaction(tx: string | TransactionLike, derivationPath?: string): Promise<unknown>;
}
