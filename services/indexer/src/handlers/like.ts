/**
 * Like Event Handler
 * Handles LikePostEvent from the Linkora contract
 */

import { Pool } from "pg";

export interface LikePostEvent {
  user: string;
  post_id: bigint;
}

export interface LikeEventContext {
  txHash: string;
  ledgerSeq: number;
  timestamp: Date;
}

/**
 * Handle LikePostEvent
 * 1. Inserts like record into likes table
 * 2. Increments like_count on the corresponding post
 * Idempotent: Uses (post_id, user_address) unique constraint and tx_hash
 */
export async function handleLike(
  poolOrClient: Pool,
  event: LikePostEvent,
  context: LikeEventContext,
  options?: { client?: Pool }
): Promise<void> {
  const client = options?.client ?? (await poolOrClient.connect());
  const { user, post_id } = event;
  const { txHash, timestamp } = context;
  const release = options?.client === undefined;

  try {
    await client.query("BEGIN");

    const insertLikeQuery = `
      INSERT INTO likes (post_id, user_address, created_at, tx_hash)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (post_id, user_address) DO NOTHING
      RETURNING id
    `;

    const insertResult = await client.query(insertLikeQuery, [
      post_id.toString(),
      user,
      timestamp,
      txHash,
    ]);

    if ((insertResult.rowCount ?? 0) === 0) {
      console.log(`Like already exists for user ${user} on post ${post_id} (idempotent skip)`);
      await client.query("COMMIT");
      return;
    }

    const updatePostQuery = `
      UPDATE posts
      SET like_count = like_count + 1
      WHERE id = $1 AND deleted_at IS NULL
    `;

    await client.query(updatePostQuery, [post_id.toString()]);
    console.log(`Like from ${user} added to post ${post_id}`);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(`Error handling LikePostEvent for post ${post_id}:`, error);
    throw error;
  } finally {
    if (release) (client as import("pg").PoolClient).release();
  }
}

/**
 * Unit test helper: Mock event data
 */
export function createMockLikeEvent(
  user: string = "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  post_id: bigint = 1n
): { event: LikePostEvent; context: LikeEventContext } {
  return {
    event: { user, post_id },
    context: {
      txHash: `0x${Math.random().toString(16).substring(2)}`,
      ledgerSeq: 12345,
      timestamp: new Date(),
    },
  };
}
