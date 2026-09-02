/**
 * Like Event Handler
 * Handles LikePostEvent from the Linkora contract
 */

import { Pool, PoolClient } from "pg";
import { PgClientLike } from "../pipeline";

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
 * Handle LikePostEvent using a shared transaction client (pipeline path).
 *
 * The caller owns the transaction. This function issues no BEGIN/COMMIT —
 * all writes join the caller's open transaction so the batch remains atomic.
 *
 * 1. Inserts a like record into the likes table (idempotent via post_id + user_address).
 * 2. Increments like_count on the corresponding post.
 */
export async function handleLike(
  client: PgClientLike,
  event: LikePostEvent,
  context: LikeEventContext
): Promise<void>;

/**
 * Handle LikePostEvent with an owned connection (standalone / test path).
 *
 * Acquires a connection from the pool, opens its own BEGIN/COMMIT/ROLLBACK,
 * and releases the connection when done.
 */
export async function handleLike(
  pool: Pool,
  event: LikePostEvent,
  context: LikeEventContext
): Promise<void>;

export async function handleLike(
  clientOrPool: PgClientLike | Pool,
  event: LikePostEvent,
  context: LikeEventContext
): Promise<void> {
  // Distinguish between a PgClientLike (has query + release, no connect) and a Pool.
  const isPool = typeof (clientOrPool as Pool).connect === "function";

  if (isPool) {
    // Standalone path: own the connection and transaction lifecycle.
    const pool = clientOrPool as Pool;
    const conn = await pool.connect();
    try {
      await conn.query("BEGIN");
      await _likeWrites(conn as unknown as PgClientLike, event, context);
      await conn.query("COMMIT");
    } catch (error) {
      await conn.query("ROLLBACK");
      console.error(`Error handling LikePostEvent for post ${event.post_id}:`, error);
      throw error;
    } finally {
      (conn as PoolClient).release();
    }
  } else {
    // Pipeline path: use the caller's transaction client directly.
    await _likeWrites(clientOrPool as PgClientLike, event, context);
  }
}

async function _likeWrites(
  client: PgClientLike,
  event: LikePostEvent,
  context: LikeEventContext
): Promise<void> {
  const { user, post_id } = event;
  const { txHash, timestamp } = context;

  const insertResult = await client.query(
    `INSERT INTO likes (post_id, user_address, created_at, tx_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (post_id, user_address) DO NOTHING
     RETURNING id`,
    [post_id.toString(), user, timestamp, txHash]
  );

  if ((insertResult.rowCount ?? 0) === 0) {
    console.log(`Like already exists for user ${user} on post ${post_id} (idempotent skip)`);
    return;
  }

  await client.query(
    `UPDATE posts
     SET like_count = like_count + 1
     WHERE id = $1 AND deleted_at IS NULL`,
    [post_id.toString()]
  );
  console.log(`Like from ${user} added to post ${post_id}`);
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
