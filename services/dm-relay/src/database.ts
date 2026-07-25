/**
 * Database connection and schema for DM relay service.
 */

import { Pool } from "pg";

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
  | { status: "cached"; responseStatus: number; responseBody: unknown };

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
    await this.createTables();
    console.log("Database initialized successfully");
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  private async createTables(): Promise<void> {
    const createMessagesTable = `
      CREATE TABLE IF NOT EXISTS dm_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id VARCHAR(64) NOT NULL,
        sender VARCHAR(56) NOT NULL,
        recipient VARCHAR(56) NOT NULL,
        ciphertext_b64 TEXT NOT NULL,
        message_index INTEGER NOT NULL,
        timestamp BIGINT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        
        CONSTRAINT unique_sender_message_index UNIQUE (sender, recipient, message_index)
      );
    `;

    const createIndexes = `
      CREATE INDEX IF NOT EXISTS idx_dm_messages_conversation_created
        ON dm_messages (conversation_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_dm_messages_created_at
        ON dm_messages (created_at);

      CREATE INDEX IF NOT EXISTS idx_dm_messages_timestamp
        ON dm_messages (timestamp);
    `;

    const createIdempotencyTable = `
      CREATE TABLE IF NOT EXISTS message_idempotency (
        idempotency_key UUID PRIMARY KEY,
        response_status INT NOT NULL,
        response_body JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `;

    const createIdempotencyIndex = `
      CREATE INDEX IF NOT EXISTS idx_message_idempotency_created_at
        ON message_idempotency (created_at);
    `;

    await this.pool.query(createMessagesTable);
    await this.pool.query(createIndexes);
    await this.pool.query(createIdempotencyTable);
    await this.pool.query(createIdempotencyIndex);
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
      WHERE created_at < NOW() - INTERVAL '${ttlDays} days'
    `;

    const result = await this.pool.query(query);
    return result.rowCount || 0;
  }

  /**
   * Atomically claim an idempotency key for processing.
   *
   * - 'claimed': no prior attempt exists; the caller owns processing and
   *   must call `completeIdempotencyKey` once it has a response.
   * - 'cached': a prior attempt already completed; the caller should replay
   *   the stored response instead of reprocessing.
   * - 'in_progress': a concurrent request already claimed this key and
   *   hasn't finished yet.
   */
  async claimIdempotencyKey(key: string): Promise<IdempotencyClaimResult> {
    const insertQuery = `
      INSERT INTO message_idempotency (idempotency_key, response_status, response_body)
      VALUES ($1, $2, '{}'::jsonb)
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING idempotency_key
    `;

    const insertResult = await this.pool.query(insertQuery, [key, IDEMPOTENCY_PENDING_STATUS]);
    if (insertResult.rowCount && insertResult.rowCount > 0) {
      return { status: "claimed" };
    }

    const cached = await this.getIdempotencyResponse(key);
    if (cached) {
      return {
        status: "cached",
        responseStatus: cached.responseStatus,
        responseBody: cached.responseBody,
      };
    }
    return { status: "in_progress" };
  }

  /**
   * Fetch a completed (non-pending) idempotency response, if one exists.
   */
  async getIdempotencyResponse(
    key: string
  ): Promise<{ responseStatus: number; responseBody: unknown } | null> {
    const query = `
      SELECT response_status, response_body
      FROM message_idempotency
      WHERE idempotency_key = $1 AND response_status <> $2
    `;
    const result = await this.pool.query(query, [key, IDEMPOTENCY_PENDING_STATUS]);
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
  async completeIdempotencyKey(key: string, status: number, body: unknown): Promise<void> {
    const query = `
      UPDATE message_idempotency
      SET response_status = $2, response_body = $3
      WHERE idempotency_key = $1
    `;
    await this.pool.query(query, [key, status, JSON.stringify(body)]);
  }

  async deleteExpiredIdempotencyKeys(ttlHours: number): Promise<number> {
    const hours = Math.max(0, Math.floor(ttlHours));
    const query = `
      DELETE FROM message_idempotency
      WHERE created_at < NOW() - INTERVAL '${hours} hours'
    `;

    const result = await this.pool.query(query);
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
