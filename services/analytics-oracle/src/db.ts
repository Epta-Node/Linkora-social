import { Pool } from "pg";
import { U32_MAX } from "./types.js";

export interface CreatorStats {
  creatorAddress: string;
  totalTips: bigint;
  postCount: bigint;
  followerDelta: bigint;
  uniqueTippers: number;
}

export class CreatorStatsValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly value: unknown
  ) {
    super(message);
    this.name = "CreatorStatsValidationError";
  }
}

const MIN_I64 = -9223372036854775808n;
const MAX_I64 = 9223372036854775807n;

function isNonNegativeBigint(v: bigint): boolean {
  return v >= 0n;
}

function isI64(v: bigint): boolean {
  return v >= MIN_I64 && v <= MAX_I64;
}

function validateCreatorStats(stats: CreatorStats): void {
  if (typeof stats.creatorAddress !== "string" || stats.creatorAddress.length === 0) {
    throw new CreatorStatsValidationError(
      `creatorAddress must be a non-empty string, got ${typeof stats.creatorAddress}`,
      "creatorAddress",
      stats.creatorAddress
    );
  }

  if (!isNonNegativeBigint(stats.totalTips)) {
    throw new CreatorStatsValidationError(
      `totalTips must be non-negative, got ${stats.totalTips}`,
      "totalTips",
      stats.totalTips
    );
  }

  if (!isNonNegativeBigint(stats.postCount)) {
    throw new CreatorStatsValidationError(
      `postCount must be non-negative, got ${stats.postCount}`,
      "postCount",
      stats.postCount
    );
  }

  if (typeof stats.followerDelta !== "bigint" || !isI64(stats.followerDelta)) {
    throw new CreatorStatsValidationError(
      `followerDelta must be an i64 bigint, got ${stats.followerDelta}`,
      "followerDelta",
      stats.followerDelta
    );
  }

  if (
    !Number.isInteger(stats.uniqueTippers) ||
    stats.uniqueTippers < 0 ||
    stats.uniqueTippers > U32_MAX
  ) {
    throw new CreatorStatsValidationError(
      `uniqueTippers must be a u32 integer (0-${U32_MAX}), got ${stats.uniqueTippers}`,
      "uniqueTippers",
      stats.uniqueTippers
    );
  }
}

/**
 * Queries the indexer database for per-creator analytics in the given ledger window.
 *
 * Window mapping (the indexer schema carries no `ledger_sequence` on the domain
 * tables, so the window is applied to the columns that do exist):
 *   • `posts.created_at` is written as `to_timestamp(created_ledger)` — the ledger
 *     encoded as a timestamp — so the ledger window is compared against the
 *     equivalent `to_timestamp()` range. Both sides go through the same
 *     conversion, so the comparison holds in any session time zone.
 *   • `follows.created_at` is the INTEGER ledger that created the edge.
 *   • `tips` records no ledger at all, so a tip is attributed to the window of
 *     the post it was sent to.
 *
 * There is no `unfollows` table: an unfollow deletes the edge from `follows`
 * instead of keeping history, so the follower delta is the number of new
 * followers in the window and cannot go negative from this data source.
 */
export async function fetchCreatorStats(
  db: Pool,
  windowStart: bigint,
  windowEnd: bigint
): Promise<CreatorStats[]> {
  // Aggregate tips, posts, and new followers for each creator active in the window.
  const result = await db.query<{
    creator: string;
    total_tips: string;
    post_count: string;
    follower_delta: string;
    unique_tippers: string;
  }>(
    `
    SELECT
      p.author                              AS creator,
      COALESCE(SUM(t.amount), 0)            AS total_tips,
      COUNT(DISTINCT p.id)                  AS post_count,
      COALESCE(
        (SELECT COUNT(*) FROM follows f WHERE f.followee = p.author
          AND f.created_at::bigint BETWEEN $1::bigint AND $2::bigint),
        0
      )                                     AS follower_delta,
      COUNT(DISTINCT t.tipper)              AS unique_tippers
    FROM posts p
    LEFT JOIN tips t
      ON t.post_id = p.id
    WHERE p.created_at >= to_timestamp(($1::bigint)::double precision)
      AND p.created_at <= to_timestamp(($2::bigint)::double precision)
    GROUP BY p.author
    `,
    [windowStart.toString(), windowEnd.toString()]
  );

  const statsList: CreatorStats[] = [];
  for (const row of result.rows) {
    try {
      const uniqueTippers = BigInt(row.unique_tippers);
      const stats: CreatorStats = {
        creatorAddress: row.creator,
        totalTips: BigInt(row.total_tips),
        postCount: BigInt(row.post_count),
        followerDelta: BigInt(row.follower_delta),
        // PostgreSQL COUNT returns a decimal string. Parse it exactly before
        // converting to Number, then cap it at the report's u32 maximum.
        uniqueTippers: Number(uniqueTippers > BigInt(U32_MAX) ? BigInt(U32_MAX) : uniqueTippers),
      };
      validateCreatorStats(stats);
      statsList.push(stats);
    } catch (err) {
      console.error(`[analytics-oracle] Invalid stats row for creator ${row.creator}:`, err);
    }
  }
  return statsList;
}
