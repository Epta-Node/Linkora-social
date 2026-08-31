/**
 * Database connection and schema for DM relay service.
 */

import { Pool } from "pg";
import fs from "fs";
import path from "path";
import { logger } from "./logger";

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

export type IdempotencyClaimResult =
  | { status: "claimed" }
  | { status: "in_progress" }
  | { status: "cached"; responseStatus: number; responseBody: unknown }
  | { status: "conflict" };

class Database {
  private pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
  }

  async init(): Promise<void> {
    await this.runMigrations();
    logger.info("Database initialized successfully");
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  private async runMigrations(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const appliedResult = await this.pool.query(
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
      await this.pool.query("BEGIN");
      try {
        await this.pool.query(sql);
        await this.pool.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]);
        await this.pool.query("COMMIT");
        logger.info({ migration: filename }, "Migration applied");
      } catch (error) {
        await this.pool.query("ROLLBACK");
        logger.error({ migration: filename, err: error }, "Migration failed");
        throw error;
      }
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
    beforeCreatedAt?: Date
  ): Promise<DbMessage[]> {
    let query = `
      SELECT id, conversation_id, sender, recipient, ciphertext_b64, 
             message_index, timestamp, created_at
      FROM dm_messages
      WHERE conversation_id = $1
    `;

    const values: (string | number | Date)[] = [conversationId];

    if (beforeCreatedAt) {
      query += " AND created_at < $2";
      values.push(beforeCreatedAt);
    }

    query += " ORDER BY created_at DESC LIMIT $" + (values.length + 1);
    values.push(limit);

    const result = await this.pool.query(query, values);
    return result.rows;
  }

  async getMessagesByRecipient(
    recipient: string,
    limit: number = 50,
    beforeCreatedAt?: Date
  ): Promise<DbMessage[]> {
    let query = `
      SELECT id, conversation_id, sender, recipient, ciphertext_b64,
             message_index, timestamp, created_at
      FROM dm_messages
      WHERE recipient = $1
    `;

    const values: (string | number | Date)[] = [recipient];

    if (beforeCreatedAt) {
      query += " AND created_at < $2";
      values.push(beforeCreatedAt);
    }

    query += " ORDER BY created_at DESC LIMIT $" + (values.length + 1);
    values.push(limit);

    const result = await this.pool.query(query, values);
    return result.rows;
  }

  async getMessageCount(conversationId: string): Promise<number> {
    const query = "SELECT COUNT(*) as count FROM dm_messages WHERE conversation_id = $1";
    const result = await this.pool.query(query, [conversationId]);
    return parseInt(result.rows[0].count);
  }

  async deleteExpiredMessages(ttlDays: number): Promise<number> {
    const query = `
      DELETE FROM dm_messages
      WHERE created_at < NOW() - $1::integer * INTERVAL '1 day'
    `;

    const result = await this.pool.query(query, [ttlDays]);
    return result.rowCount || 0;
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
    const result = await this.pool.query(query, [
      senderAddress,
      key,
      IDEMPOTENCY_PENDING_STATUS,
    ]);
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

  async deleteExpiredIdempotencyKeys(ttlHours: number): Promise<number> {
    const hours = Math.max(0, Math.floor(ttlHours));
    const query = `
      DELETE FROM message_idempotency
      WHERE created_at < NOW() - $1::integer * INTERVAL '1 hour'
    `;

    const result = await this.pool.query(query, [hours]);
    return result.rowCount || 0;
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
