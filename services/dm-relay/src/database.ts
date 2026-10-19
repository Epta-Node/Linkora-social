/**
 * Database connection and schema for DM relay service.
 */

import { Pool } from "pg";
import fs from "fs";
import path from "path";
import { logger } from "./logger";
import {
  attachPoolMonitoring,
  checkPoolHealth,
  getPoolMetrics,
  type PoolMetrics,
  type PoolHealthResult,
} from "./db-pool-monitor";
import { optionalInt } from "./config";

export interface DbMessage {
  id: string;
  conversation_id: string;
  sender: string;
  recipient: string;
  ciphertext_b64: string;
  message_index: number;
  timestamp: number;
  created_at: Date;
}

// A `response_status` of 0 is a sentinel meaning "claimed but not yet
// completed" — real HTTP status codes are always >= 100.
const IDEMPOTENCY_PENDING_STATUS = 0;

/**
 * Retention cleanup removes rows in bounded batches.
 *
 * A single unbounded `DELETE` over the whole expired backlog takes one long
 * exclusive lock on the table, produces one large WAL/dead-tuple burst, and
 * rolls back every row at once if it fails — all of which stall live message
 * traffic. Deleting oldest-first in batches keeps each statement short and
 * resumable, and lets the loop pause between batches.
 */
const CLEANUP_BATCH_SIZE = 1000;

/** Pause between cleanup batches so live traffic is never starved. */
const CLEANUP_BATCH_PAUSE_MS = 25;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Clamp a caller-supplied batch size to a positive integer. */
function normaliseBatchSize(batchSize: number): number {
  return Math.max(1, Math.floor(batchSize));
}

export type IdempotencyClaimResult =
  | { status: "claimed" }
  | { status: "in_progress" }
  | { status: "cached"; responseStatus: number; responseBody: unknown }
  | { status: "conflict" };

class Database {
  private pool: Pool;

  constructor(connectionString: string) {
    // Tunable via env (issue #888); defaults match the pre-existing values.
    this.pool = new Pool({
      connectionString,
      max: optionalInt("DB_POOL_MAX", 20),
      idleTimeoutMillis: optionalInt("DB_POOL_IDLE_TIMEOUT_MS", 30000),
      connectionTimeoutMillis: optionalInt("DB_POOL_CONNECTION_TIMEOUT_MS", 2000),
    });
    // pool.on('error') is required: without it, an idle client that dies
    // (e.g. Postgres restarting underneath it) crashes the process instead
    // of being logged and discarded.
    attachPoolMonitoring(this.pool, {
      logger,
      serviceName: "dm-relay",
      statsIntervalMs: optionalInt("DB_POOL_STATS_INTERVAL_MS", 0),
    });
  }

  /** Current pool utilisation (active, idle, waiting) — issue #888. */
  getPoolMetrics(): PoolMetrics {
    return getPoolMetrics(this.pool);
  }

  /** Proactive `SELECT 1` health check, distinct from metrics — issue #888. */
  async getPoolHealth(): Promise<PoolHealthResult> {
    return checkPoolHealth(this.pool);
  }

  async init(): Promise<void> {
    await this.runMigrations();
    logger.info("Database initialized successfully");
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  private async runMigrations(): Promise<void> {
    // #1527 — Use a single checked-out client for the entire migration
    // sequence so BEGIN/DDL/INSERT/COMMIT all execute on the same connection.
    // Previous code used pool.query for each statement, which could check out
    // a different client per call, leaving partial schema on failure.
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          filename   VARCHAR(255) PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      const appliedResult = await client.query(
        "SELECT filename FROM schema_migrations ORDER BY filename"
      );
      const applied = new Set(appliedResult.rows.map((r) => r.filename));

      const migrationsDir = path.resolve(__dirname, "../migrations");
      const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".sql"))
        .sort();

      for (const filename of files) {
        if (applied.has(filename)) continue;

        const sql = fs.readFileSync(path.join(migrationsDir, filename), "utf-8");

        logger.info({ migration: filename }, "Applying migration");
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
          await client.query("COMMIT");
          logger.info({ migration: filename }, "Migration applied");
        } catch (error) {
          await client.query("ROLLBACK");
          logger.error({ migration: filename, err: error }, "Migration failed");
          throw error;
        }
      }
    } finally {
      client.release();
    }
  }

  async insertMessage(
    conversationId: string,
    sender: string,
    recipient: string,
    ciphertextB64: string,
    messageIndex: number,
    timestamp: number
  ): Promise<string> {
    const query = `
      INSERT INTO dm_messages 
        (conversation_id, sender, recipient, ciphertext_b64, message_index, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `;

    const values = [conversationId, sender, recipient, ciphertextB64, messageIndex, timestamp];

    try {
      const result = await this.pool.query(query, values);
      return result.rows[0].id;
    } catch (error: unknown) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        // Unique violation
        throw new Error("Message with this index already exists for this sender-recipient pair");
      }
      throw error;
    }
  }

  async getMessages(
    conversationId: string,
    limit: number = 50,
    cursor?: { createdAt: Date; id: string }
  ): Promise<DbMessage[]> {
    let query = `
      SELECT id, conversation_id, sender, recipient, ciphertext_b64,
             message_index, timestamp, created_at
      FROM dm_messages
      WHERE conversation_id = $1
    `;

    const values: (string | number | Date)[] = [conversationId];

    // #1529 — Composite cursor: (created_at, id) to prevent skipping
    // messages that share a timestamp within the same transaction.
    if (cursor) {
      query += " AND (created_at, id) < ($2, $3)";
      values.push(cursor.createdAt, cursor.id);
    }

    query += " ORDER BY created_at DESC, id DESC LIMIT $" + (values.length + 1);
    values.push(limit);

    const result = await this.pool.query(query, values);
    return result.rows;
  }

  async getMessagesByRecipient(
    recipient: string,
    limit: number = 50,
    cursor?: { createdAt: Date; id: string }
  ): Promise<DbMessage[]> {
    let query = `
      SELECT id, conversation_id, sender, recipient, ciphertext_b64,
             message_index, timestamp, created_at
      FROM dm_messages
      WHERE recipient = $1
    `;

    const values: (string | number | Date)[] = [recipient];

    // #1529 — Composite cursor: (created_at, id) to prevent skipping
    // messages that share a timestamp within the same transaction.
    if (cursor) {
      query += " AND (created_at, id) < ($2, $3)";
      values.push(cursor.createdAt, cursor.id);
    }

    query += " ORDER BY created_at DESC, id DESC LIMIT $" + (values.length + 1);
    values.push(limit);

    const result = await this.pool.query(query, values);
    return result.rows;
  }

  async getMessageCount(conversationId: string): Promise<number> {
    const query = "SELECT COUNT(*) as count FROM dm_messages WHERE conversation_id = $1";
    const result = await this.pool.query(query, [conversationId]);
    return parseInt(result.rows[0].count);
  }

  /**
   * Whether `address` is a sender or recipient of any message in
   * `conversationId` (issue #1331).
   *
   * `conversation_id` is a deterministic hash of the two participant
   * addresses, so it does not itself prove who they are; this checks
   * membership against the actual message rows before a caller is allowed to
   * read a conversation's metadata. A conversation with no messages yet has
   * no rows to match, so it returns `false` — nobody can prove membership of
   * an empty conversation, and there is nothing in it to protect either way.
   */
  async isConversationParticipant(conversationId: string, address: string): Promise<boolean> {
    const query =
      "SELECT 1 FROM dm_messages WHERE conversation_id = $1 AND (sender = $2 OR recipient = $2) LIMIT 1";
    const result = await this.pool.query(query, [conversationId, address]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Delete every message older than `ttlDays`, in bounded batches.
   *
   * Each statement removes at most `batchSize` rows (oldest first, matching
   * the `created_at` index) and the loop stops as soon as a batch comes back
   * short — which means the expired backlog is drained. Returns the total
   * number of rows removed across all batches.
   */
  async deleteExpiredMessages(
    ttlDays: number,
    batchSize: number = CLEANUP_BATCH_SIZE
  ): Promise<number> {
    const limit = normaliseBatchSize(batchSize);
    let total = 0;

    for (;;) {
      const result = await this.pool.query(
        `
        DELETE FROM dm_messages
        WHERE id IN (
          SELECT id
          FROM dm_messages
          WHERE created_at < NOW() - $1::integer * INTERVAL '1 day'
          ORDER BY created_at
          LIMIT $2
        )
        `,
        [ttlDays, limit]
      );

      const deleted = result.rowCount || 0;
      total += deleted;

      // A short batch means there is nothing left that is expired.
      if (deleted < limit) return total;

      logger.info({ deleted, total }, "Expired-message cleanup batch deleted");
      await sleep(CLEANUP_BATCH_PAUSE_MS);
    }
  }

  /**
   * Atomically claim an idempotency key for processing, scoped to the
   * authenticated sender. Two different senders reusing the same
   * client-generated key are independent — the key alone is not a global
   * lock.
   *
   * - 'claimed': no prior attempt exists for this (sender, key); the caller
   *   owns processing and must call `completeIdempotencyKey` once it has a
   *   response.
   * - 'cached': a prior attempt for this (sender, key) with the same payload
   *   already completed; the caller should replay the stored response
   *   instead of reprocessing.
   * - 'in_progress': a concurrent request already claimed this (sender, key)
   *   with the same payload and hasn't finished yet.
   * - 'conflict': this (sender, key) pair was already used with a
   *   *different* payload.
   */
  async claimIdempotencyKey(
    senderAddress: string,
    key: string,
    requestFingerprint: string
  ): Promise<IdempotencyClaimResult> {
    const insertQuery = `
      INSERT INTO message_idempotency
        (sender_address, idempotency_key, response_status, response_body, request_fingerprint)
      VALUES ($1, $2, $3, '{}'::jsonb, $4)
      ON CONFLICT (sender_address, idempotency_key) DO NOTHING
      RETURNING idempotency_key
    `;

    const insertResult = await this.pool.query(insertQuery, [
      senderAddress,
      key,
      IDEMPOTENCY_PENDING_STATUS,
      requestFingerprint,
    ]);
    if (insertResult.rowCount && insertResult.rowCount > 0) {
      return { status: "claimed" };
    }

    const existing = await this.getIdempotencyRecord(senderAddress, key);
    if (!existing) {
      // The row was pruned (expired) between the failed insert and this
      // read; treat it as a concurrent claim still settling.
      return { status: "in_progress" };
    }

    if (existing.requestFingerprint !== requestFingerprint) {
      return { status: "conflict" };
    }

    if (existing.responseStatus === IDEMPOTENCY_PENDING_STATUS) {
      return { status: "in_progress" };
    }

    return {
      status: "cached",
      responseStatus: existing.responseStatus,
      responseBody: existing.responseBody,
    };
  }

  /**
   * Fetch the idempotency record for (senderAddress, key), pending or
   * completed, along with the fingerprint of the payload that claimed it.
   */
  private async getIdempotencyRecord(
    senderAddress: string,
    key: string
  ): Promise<{
    responseStatus: number;
    responseBody: unknown;
    requestFingerprint: string;
  } | null> {
    const query = `
      SELECT response_status, response_body, request_fingerprint
      FROM message_idempotency
      WHERE sender_address = $1 AND idempotency_key = $2
    `;
    const result = await this.pool.query(query, [senderAddress, key]);
    if (result.rowCount === 0) return null;

    return {
      responseStatus: result.rows[0].response_status,
      responseBody: result.rows[0].response_body,
      requestFingerprint: result.rows[0].request_fingerprint,
    };
  }

  /**
   * Fetch a completed (non-pending) idempotency response, if one exists.
   */
  async getIdempotencyResponse(
    senderAddress: string,
    key: string
  ): Promise<{ responseStatus: number; responseBody: unknown } | null> {
    const query = `
      SELECT response_status, response_body
      FROM message_idempotency
      WHERE sender_address = $1 AND idempotency_key = $2 AND response_status <> $3
    `;
    const result = await this.pool.query(query, [senderAddress, key, IDEMPOTENCY_PENDING_STATUS]);
    if (result.rowCount === 0) return null;

    return {
      responseStatus: result.rows[0].response_status,
      responseBody: result.rows[0].response_body,
    };
  }

  /**
   * Record the final response for a claimed idempotency key so future
   * duplicate submissions can replay it instead of reprocessing.
   */
  async completeIdempotencyKey(
    senderAddress: string,
    key: string,
    status: number,
    body: unknown
  ): Promise<void> {
    const query = `
      UPDATE message_idempotency
      SET response_status = $3, response_body = $4
      WHERE sender_address = $1 AND idempotency_key = $2
    `;
    await this.pool.query(query, [senderAddress, key, status, JSON.stringify(body)]);
  }

  /**
   * Delete every idempotency key older than `ttlHours`, in bounded batches.
   *
   * Same batching rationale as {@link deleteExpiredMessages}: the primary key
   * is the composite (sender_address, idempotency_key), so each batch selects
   * up to `batchSize` expired keys oldest-first and deletes exactly those.
   * Returns the total number of rows removed across all batches.
   */
  async deleteExpiredIdempotencyKeys(
    ttlHours: number,
    batchSize: number = CLEANUP_BATCH_SIZE
  ): Promise<number> {
    const hours = Math.max(0, Math.floor(ttlHours));
    const limit = normaliseBatchSize(batchSize);
    let total = 0;

    for (;;) {
      const result = await this.pool.query(
        `
        DELETE FROM message_idempotency
        WHERE (sender_address, idempotency_key) IN (
          SELECT sender_address, idempotency_key
          FROM message_idempotency
          WHERE created_at < NOW() - $1::integer * INTERVAL '1 hour'
          ORDER BY created_at
          LIMIT $2
        )
        `,
        [hours, limit]
      );

      const deleted = result.rowCount || 0;
      total += deleted;

      // A short batch means there is nothing left that is expired.
      if (deleted < limit) return total;

      logger.info({ deleted, total }, "Expired idempotency-key cleanup batch deleted");
      await sleep(CLEANUP_BATCH_PAUSE_MS);
    }
  }

  async getHealthStats(): Promise<{
    totalMessages: number;
    messagesLast24h: number;
    oldestMessage?: Date;
  }> {
    const totalQuery = "SELECT COUNT(*) as count FROM dm_messages";
    const recentQuery = `
      SELECT COUNT(*) as count FROM dm_messages 
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `;
    const oldestQuery = `
      SELECT MIN(created_at) as oldest FROM dm_messages
    `;

    const [totalResult, recentResult, oldestResult] = await Promise.all([
      this.pool.query(totalQuery),
      this.pool.query(recentQuery),
      this.pool.query(oldestQuery),
    ]);

    return {
      totalMessages: parseInt(totalResult.rows[0].count),
      messagesLast24h: parseInt(recentResult.rows[0].count),
      oldestMessage: oldestResult.rows[0].oldest || undefined,
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export { Database };
