import { encode } from "cbor-x";
import { sha256 } from "@noble/hashes/sha256";
import { xdr } from "@stellar/stellar-sdk";
import { AnalyticsReport } from "./types.js";

// ── Control-character sanitisation ─────────────────────────────────────────
// Matches Unicode control characters (C0: U+0000–U+001F, DEL: U+007F,
// C1: U+0080–U+009F) that must never appear in signed attestation fields.
// Keeping this regex in codec.ts (co-located with encoding logic) ensures
// every code path that serialises report fields shares the same definition.
// eslint-disable-next-line no-control-regex
export const CONTROL_CHAR_REGEX = /[\x00-\x1F\x7F\x80-\x9F]/;

/**
 * Trim whitespace and reject strings that contain any control characters.
 *
 * @throws {ValidationError} when the string contains control characters
 *                           after trimming.
 */
export function sanitizeString(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (CONTROL_CHAR_REGEX.test(trimmed)) {
    throw new ValidationError(
      `String field "${fieldName}" contains unauthorised control characters`,
      fieldName,
      trimmed
    );
  }
  return trimmed;
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly value: unknown
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

// Re-export so middleware and callers can import from the same module.
export { CONTROL_CHAR_REGEX as CONTROL_CHAR_PATTERN };

const CREATOR_BYTE_LENGTH = 32;
const U8_MAX = 255;

function isNonNegativeBigint(v: bigint): boolean {
  return v >= 0n;
}

function isPositiveBigint(v: bigint): boolean {
  return v > 0n;
}

/**
 * Recursively walk an object / array and sanitize every string leaf.
 * Non-string values are returned unchanged.
 *
 * @throws {ValidationError} when any string contains control characters.
 */
export function sanitizeObject<T>(obj: T, path = ""): T {
  if (typeof obj === "string") {
    const fieldName = path || "<root>";
    return sanitizeString(obj, fieldName) as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item, i) => sanitizeObject(item, `${path}[${i}]`)) as T;
  }
  if (obj !== null && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      const fieldPath = path ? `${path}.${key}` : key;
      out[key] = sanitizeObject(val, fieldPath);
    }
    return out as T;
  }
  return obj;
}

/**
 * Validates all fields of an AnalyticsReport against the on-chain schema constraints.
 *
 * @throws {ValidationError} if any field fails validation.
 */
export function validateReport(report: AnalyticsReport): void {
  if (!Number.isInteger(report.version) || report.version < 0 || report.version > U8_MAX) {
    throw new ValidationError(
      `version must be a u8 integer (0-255), got ${report.version}`,
      "version",
      report.version
    );
  }

  if (!(report.creator instanceof Uint8Array) || report.creator.length !== CREATOR_BYTE_LENGTH) {
    throw new ValidationError(
      `creator must be a ${CREATOR_BYTE_LENGTH}-byte Ed25519 public key, got ${report.creator?.length ?? typeof report.creator} bytes`,
      "creator",
      report.creator
    );
  }

  if (!isPositiveBigint(report.windowStart)) {
    throw new ValidationError(
      `windowStart must be a positive integer, got ${report.windowStart}`,
      "windowStart",
      report.windowStart
    );
  }

  if (!isPositiveBigint(report.windowEnd)) {
    throw new ValidationError(
      `windowEnd must be a positive integer, got ${report.windowEnd}`,
      "windowEnd",
      report.windowEnd
    );
  }

  if (report.windowStart >= report.windowEnd) {
    throw new ValidationError(
      `windowStart (${report.windowStart}) must be less than windowEnd (${report.windowEnd})`,
      "windowStart",
      report.windowStart
    );
  }

  if (!isNonNegativeBigint(report.totalTips)) {
    throw new ValidationError(
      `totalTips must be non-negative, got ${report.totalTips}`,
      "totalTips",
      report.totalTips
    );
  }

  if (!isNonNegativeBigint(report.postCount)) {
    throw new ValidationError(
      `postCount must be non-negative, got ${report.postCount}`,
      "postCount",
      report.postCount
    );
  }

  if (!isNonNegativeBigint(report.followerDelta)) {
    throw new ValidationError(
      `followerDelta must be non-negative, got ${report.followerDelta}`,
      "followerDelta",
      report.followerDelta
    );
  }

  if (!Number.isInteger(report.uniqueTippers) || report.uniqueTippers < 0) {
    throw new ValidationError(
      `uniqueTippers must be a non-negative integer, got ${report.uniqueTippers}`,
      "uniqueTippers",
      report.uniqueTippers
    );
  }
}

/**
 * Encodes an AnalyticsReport as a CBOR array in canonical field order.
 *
 * Field order matches the on-chain schema defined in ADR-006:
 *   [version, creator, window_start, window_end, total_tips, post_count, follower_delta, unique_tippers]
 *
 * @throws {ValidationError} if the report fields are invalid.
 */
export function encodeReport(report: AnalyticsReport): Buffer {
  validateReport(report);

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

// ── Ledger footprint helpers ─────────────────────────────────────────────────
// The rpc.Server is reused across submissions, so it is the caller's job to
// refresh the Soroban LedgerFootprint on every attestation. These helpers make
// a freshly simulated footprint comparable to the previous submission's, so a
// growing footprint can be detected and surfaced instead of silently shipping
// a stale XDR footprint.

export interface FootprintSummary {
  /** Number of read-only ledger keys in the footprint. */
  readOnlyCount: number;
  /** Number of read-write ledger keys in the footprint. */
  readWriteCount: number;
  /** Total ledger keys in the footprint. */
  totalKeys: number;
  /**
   * Stable digest derived from the canonical XDR of every ledger key.
   * Changes whenever the footprint reshapes (adds, removes, or alters the
   * entries it touches), independent of key ordering.
   */
  digest: string;
}

/**
 * Produce a stable, comparable summary of a Soroban ledger footprint.
 *
 * Every ledger key is serialised to its canonical base64 XDR and hashed, so
 * two footprints that reference different contract state always produce
 * different digests — even if they happen to reference the same number of keys.
 */
export function summarizeFootprint(footprint: xdr.LedgerFootprint): FootprintSummary {
  const readOnly = footprint.readOnly();
  const readWrite = footprint.readWrite();

  const parts: string[] = [];
  for (const key of readOnly) parts.push(key.toXDR("base64"));
  for (const key of readWrite) parts.push(key.toXDR("base64"));

  return {
    readOnlyCount: readOnly.length,
    readWriteCount: readWrite.length,
    totalKeys: readOnly.length + readWrite.length,
    digest: hashReport(Buffer.from(parts.join("\n"), "utf8")).toString("hex"),
  };
}

export interface FootprintGrowthCheck {
  /** Whether the footprint differs from the previous submission's. */
  changed: boolean;
  /** Whether the fresh footprint touches more ledger keys than the previous one. */
  grew: boolean;
  /** Net change in total ledger keys (positive = growth, negative = shrink). */
  addedKeys: number;
}

/**
 * Compare a freshly simulated footprint with the previous submission's
 * footprint. `grew` is true only when the new footprint is both different and
 * touches strictly more ledger keys than the previous one — the condition that
 * risks a stale-footprint simulation/submission mismatch.
 */
export function assessFootprintGrowth(
  prev: FootprintSummary | null,
  next: FootprintSummary
): FootprintGrowthCheck {
  if (prev === null) {
    return { changed: true, grew: false, addedKeys: 0 };
  }
  const changed = prev.digest !== next.digest;
  return {
    changed,
    grew: changed && next.totalKeys > prev.totalKeys,
    addedKeys: changed ? next.totalKeys - prev.totalKeys : 0,
  };
}
