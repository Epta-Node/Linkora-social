/**
 * TTL purge job (#1649)
 * Deletes messages older than MESSAGE_TTL_SECONDS.
 * Idempotency keys cascade-delete automatically.
 */
import { Pool } from "pg";

export async function purgeExpiredMessages(db: Pool, ttlSeconds: number): Promise<number> {
  const result = await db.query(
    `DELETE FROM messages WHERE created_at < NOW() - ($1 || ' seconds')::INTERVAL`,
    [String(ttlSeconds)]
  );
  return result.rowCount ?? 0;
}

export function startPurgeJob(db: Pool, ttlSeconds: number, intervalMs: number): () => void {
  const run = async () => {
    try {
      const count = await purgeExpiredMessages(db, ttlSeconds);
      if (count > 0) console.log(`[purge] deleted ${count} expired message(s)`);
    } catch (err) {
      console.error("[purge] error:", err);
    }
  };
  run();
  const handle = setInterval(run, intervalMs);
  return () => clearInterval(handle);
}
