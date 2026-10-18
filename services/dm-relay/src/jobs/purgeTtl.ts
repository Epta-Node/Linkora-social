/**
 * TTL purge job — #1649
 *
 * Deletes messages (and their associated idempotency keys via CASCADE)
 * that are older than MESSAGE_TTL_SECONDS.  Runs on a configurable interval
 * to minimise retained E2EE ciphertext.
 */

import { Pool } from "pg";

export interface PurgeResult {
  purgedCount: number;
  ranAt: Date;
}

/**
 * Delete all messages whose created_at is older than `ttlSeconds`.
 * Idempotency keys are removed automatically by the ON DELETE CASCADE FK.
 *
 * @returns number of rows deleted
 */
export async function purgeExpiredMessages(
  db: Pool,
  ttlSeconds: number
): Promise<number> {
  const result = await db.query<{ count: string }>(
    `DELETE FROM messages
     WHERE created_at < NOW() - ($1 || ' seconds')::INTERVAL
     RETURNING id`,
    [ttlSeconds.toString()]
  );
  return result.rowCount ?? 0;
}

/**
 * Start the background purge job.
 *
 * @param db           pg Pool
 * @param ttlSeconds   message lifetime in seconds (MESSAGE_TTL_SECONDS)
 * @param intervalMs   how often to run (PURGE_INTERVAL_MS)
 * @returns a cancel function that stops the interval
 */
export function startPurgeJob(
  db: Pool,
  ttlSeconds: number,
  intervalMs: number
): () => void {
  const run = async () => {
    try {
      const count = await purgeExpiredMessages(db, ttlSeconds);
      if (count > 0) {
        console.log(`[purge] deleted ${count} expired message(s)`);
      }
    } catch (err) {
      console.error("[purge] error during TTL purge:", err);
    }
  };

  // Run once immediately, then on interval
  run();
  const handle = setInterval(run, intervalMs);

  return () => clearInterval(handle);
}
