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

/**
 * Minimal interface for a Stellar transaction object that can be
 * converted to an XDR envelope string.
 *
 * Implemented by StellarBase Transaction and FeeBumpTransaction.
 * Accepting this union (string | TransactionLike) lets callers pass
 * either a pre-encoded XDR string or a live transaction object without
 * losing type safety.
 *
 * @see https://stellar.github.io/js-stellar-base/Transaction.html
 */
export interface TransactionLike {
  /**
   * Serialize the transaction to a base64-encoded XDR envelope string.
   * @param format Must be "base64" for Stellar network submission.
   */
  toEnvelope(): { toXDR(format: "base64"): string };

  /** The network passphrase this transaction is bound to (optional). */
  networkPassphrase?: string;

  /**
   * Signatures attached to the transaction (optional).
   * Each entry is a decorated signature from a signer.
   */
  signatures?: Array<{ hint(): Buffer; signature(): Buffer }>;
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
