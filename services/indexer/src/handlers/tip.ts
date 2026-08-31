/**
 * Tip Event Handler
 * Handles TipEvent from the Linkora contract
 */

import { Pool } from "pg";

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
 * Handle TipEvent
 * 1. Inserts tip record into tips table
 * 2. Increments tip_total on the corresponding post
 * Idempotent: Uses tx_hash uniqueness constraint
 */
export async function handleTip(
  poolOrClient: Pool,
  event: TipEvent,
  context: TipEventContext,
  options?: { client?: Pool }
): Promise<void> {
  const client = options?.client ?? (await poolOrClient.connect());
  const { tipper, post_id, amount, fee } = event;
  const { txHash, timestamp } = context;
  const release = options?.client === undefined;

  try {
    await client.query("BEGIN");

    const insertTipQuery = `
      INSERT INTO tips (post_id, tipper, amount, fee, created_at, tx_hash)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (tx_hash) DO NOTHING
      RETURNING id
    `;

    const insertResult = await client.query(insertTipQuery, [
      post_id.toString(),
      tipper,
      amount.toString(),
      fee.toString(),
      timestamp,
      txHash,
    ]);

    if ((insertResult.rowCount ?? 0) === 0) {
      console.log(`Tip already processed for tx ${txHash} (idempotent skip)`);
      await client.query("COMMIT");
      return;
    }

    const updatePostQuery = `
      UPDATE posts
      SET tip_total = tip_total + $1
      WHERE id = $2 AND deleted_at IS NULL
    `;

    await client.query(updatePostQuery, [amount.toString(), post_id.toString()]);
    console.log(`Tip of ${amount} from ${tipper} added to post ${post_id}`);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(`Error handling TipEvent for post ${post_id}:`, error);
    throw error;
  } finally {
    if (release) (client as import("pg").PoolClient).release();
  }
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
