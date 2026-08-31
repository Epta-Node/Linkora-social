/**
 * Analytics report schema (mirrors the on-chain CBOR struct).
 *
 * Encoded as a CBOR array in this field order for deterministic serialisation.
 */
export interface AnalyticsReport {
  version: number; // u8, currently 1
  creator: Uint8Array; // 32-byte raw Ed25519 public key of the creator address
  windowStart: bigint; // u64 inclusive ledger sequence
  windowEnd: bigint; // u64 inclusive ledger sequence
  totalTips: bigint; // u128 net tip amount in stroops
  postCount: bigint; // u64 posts created in window
  followerDelta: bigint; // i64 net follower change in window
  uniqueTippers: number; // u32 distinct tippers in window
}

export interface SignedAttestation {
  oracleName: string;
  reportCbor: Buffer;
  reportHash: string; // hex sha256
  signature: Buffer; // 64-byte Ed25519 signature
  txHash: string; // on-chain transaction ID
  report: AnalyticsReport;
  submittedAt: number; // Unix timestamp ms
}
