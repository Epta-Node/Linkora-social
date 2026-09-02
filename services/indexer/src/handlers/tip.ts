/**
 * Tip Event Handler
 * Handles TipEvent from the Linkora contract
 */

import { Pool, PoolClient } from "pg";
import { PgClientLike } from "../pipeline";

export interface TipEvent {
  tipper: string;
  post_id: bigint;
  amount: bigint;
  fee: bigint;
}

export interface TipEventContext {
  txHash: string;
  ledgerSeq: number;
  timestamp: Date;
}

/**
 * Handle TipEvent using a shared transaction client (pipeline path).
 *
 * The caller owns the transaction. This function issues no BEGIN/COMMIT —
 * all writes join the caller's open transaction so the batch remains atomic.
 *
 * 1. Inserts a tip record into the tips table (idempotent via tx_hash).
 * 2. Increments tip_total on the corresponding post.
 */
export async function handleTip(
  client: PgClientLike,
  event: TipEvent,
  context: TipEventContext
): Promise<void>;

/**
 * Handle TipEvent with an owned connection (standalone / test path).
 *
 * Acquires a connection from the pool, opens its own BEGIN/COMMIT/ROLLBACK,
 * and releases the connection when done.
 */
export async function handleTip(
  pool: Pool,
  event: TipEvent,
  context: TipEventContext
): Promise<void>;

export async function handleTip(
  clientOrPool: PgClientLike | Pool,
  event: TipEvent,
  context: TipEventContext
): Promise<void> {
  // Distinguish between a PgClientLike (has query + release, no connect) and a Pool.
  const isPool = typeof (clientOrPool as Pool).connect === "function";

  if (isPool) {
    // Standalone path: own the connection and transaction lifecycle.
    const pool = clientOrPool as Pool;
    const conn = await pool.connect();
    try {
      await conn.query("BEGIN");
      await _tipWrites(conn as unknown as PgClientLike, event, context);
      await conn.query("COMMIT");
    } catch (error) {
      await conn.query("ROLLBACK");
      console.error(`Error handling TipEvent for post ${event.post_id}:`, error);
      throw error;
    } finally {
      (conn as PoolClient).release();
    }
  } else {
    // Pipeline path: use the caller's transaction client directly.
    await _tipWrites(clientOrPool as PgClientLike, event, context);
  }
}

async function _tipWrites(
  client: PgClientLike,
  event: TipEvent,
  context: TipEventContext
): Promise<void> {
  const { tipper, post_id, amount, fee } = event;
  const { txHash, timestamp } = context;

  const insertResult = await client.query(
    `INSERT INTO tips (post_id, tipper, amount, fee, created_at, tx_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (tx_hash) DO NOTHING
     RETURNING id`,
    [post_id.toString(), tipper, amount.toString(), fee.toString(), timestamp, txHash]
  );

  if ((insertResult.rowCount ?? 0) === 0) {
    console.log(`Tip already processed for tx ${txHash} (idempotent skip)`);
    return;
  }

  await client.query(
    `UPDATE posts
     SET tip_total = tip_total + $1
     WHERE id = $2 AND deleted_at IS NULL`,
    [amount.toString(), post_id.toString()]
  );
  console.log(`Tip of ${amount} from ${tipper} added to post ${post_id}`);
}

/**
 * Unit test helper: Mock event data
 */
export function createMockTipEvent(
  tipper: string = "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  post_id: bigint = 1n,
  amount: bigint = 1000000n,
  fee: bigint = 25000n
): { event: TipEvent; context: TipEventContext } {
  return {
    event: { tipper, post_id, amount, fee },
    context: {
      txHash: `0x${Math.random().toString(16).substring(2)}`,
      ledgerSeq: 12345,
      timestamp: new Date(),
    },
  };
}
