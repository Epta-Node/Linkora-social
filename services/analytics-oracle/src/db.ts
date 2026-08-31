import { Pool } from "pg";

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

function isNonNegativeBigint(v: bigint): boolean {
  return v >= 0n;
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

  if (!isNonNegativeBigint(stats.followerDelta)) {
    throw new CreatorStatsValidationError(
      `followerDelta must be non-negative, got ${stats.followerDelta}`,
      "followerDelta",
      stats.followerDelta
    );
  }

  if (!Number.isInteger(stats.uniqueTippers) || stats.uniqueTippers < 0) {
    throw new CreatorStatsValidationError(
      `uniqueTippers must be a non-negative integer, got ${stats.uniqueTippers}`,
      "uniqueTippers",
      stats.uniqueTippers
    );
  }
}

/**
 * Queries the indexer database for per-creator analytics in the given ledger window.
 */
export async function fetchCreatorStats(
  db: Pool,
  windowStart: bigint,
  windowEnd: bigint
): Promise<CreatorStats[]> {
  // Aggregate tips, posts, and follower changes for each creator active in the window.
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
          AND f.ledger_sequence BETWEEN $1 AND $2) -
        (SELECT COUNT(*) FROM unfollows uf WHERE uf.followee = p.author
          AND uf.ledger_sequence BETWEEN $1 AND $2),
        0
      )                                     AS follower_delta,
      COUNT(DISTINCT t.tipper)              AS unique_tippers
    FROM posts p
    LEFT JOIN tips t
      ON t.post_id = p.id AND t.ledger_sequence BETWEEN $1 AND $2
    WHERE p.ledger_sequence BETWEEN $1 AND $2
    GROUP BY p.author
    `,
    [windowStart.toString(), windowEnd.toString()]
  );

  return result.rows.map((row) => {
    const stats: CreatorStats = {
      creatorAddress: row.creator,
      totalTips: BigInt(row.total_tips),
      postCount: BigInt(row.post_count),
      followerDelta: BigInt(row.follower_delta),
      uniqueTippers: parseInt(row.unique_tippers, 10),
    };
    validateCreatorStats(stats);
    return stats;
  });
}
