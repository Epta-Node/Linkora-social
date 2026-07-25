import { encode } from "cbor-x";
import { sha256 } from "@noble/hashes/sha256";
import { AnalyticsReport } from "./types.js";

/**
 * Encodes an AnalyticsReport as a CBOR array in canonical field order.
 *
 * Field order matches the on-chain schema defined in ADR-006:
 *   [version, creator, window_start, window_end, total_tips, post_count, follower_delta, unique_tippers]
 */
export function encodeReport(report: AnalyticsReport): Buffer {
  const array = [
    report.version,
    report.creator,
    report.windowStart,
    report.windowEnd,
    report.totalTips,
    report.postCount,
    report.followerDelta,
    report.uniqueTippers,
  ];
  return Buffer.from(encode(array));
}

/**
 * Returns the SHA-256 digest of the serialised report bytes.
 */
export function hashReport(reportCbor: Buffer): Buffer {
  return Buffer.from(sha256(reportCbor));
}
