import { Pool } from "pg";

export interface CreatorStats {
  creatorAddress: string;
  totalTips: bigint;
  postCount: bigint;
  followerDelta: bigint;
  uniqueTippers: number;
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

  return result.rows.map((row) => ({
    creatorAddress: row.creator,
    totalTips: BigInt(row.total_tips),
    postCount: BigInt(row.post_count),
    followerDelta: BigInt(row.follower_delta),
    uniqueTippers: parseInt(row.unique_tippers, 10),
  }));
}
