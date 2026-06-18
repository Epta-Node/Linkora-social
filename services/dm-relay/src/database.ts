/**
 * Database connection and schema for DM relay service.
 */

import { Pool } from 'pg';

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
    console.log('Database initialized successfully');
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

    await this.pool.query(createMessagesTable);
    await this.pool.query(createIndexes);
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
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') { // Unique violation
        throw new Error('Message with this index already exists for this sender-recipient pair');
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
    
    const values: (string | number)[] = [conversationId];

    if (beforeCreatedAt) {
      query += ' AND created_at < $2';
      values.push(beforeCreatedAt);
    }

    query += ' ORDER BY created_at DESC LIMIT $' + (values.length + 1);
    values.push(limit);

    const result = await this.pool.query(query, values);
    return result.rows;
  }

  async getMessageCount(conversationId: string): Promise<number> {
    const query = 'SELECT COUNT(*) as count FROM dm_messages WHERE conversation_id = $1';
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

  async getHealthStats(): Promise<{
    totalMessages: number;
    messagesLast24h: number;
    oldestMessage?: Date;
  }> {
    const totalQuery = 'SELECT COUNT(*) as count FROM dm_messages';
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
      this.pool.query(oldestQuery)
    ]);

    return {
      totalMessages: parseInt(totalResult.rows[0].count),
      messagesLast24h: parseInt(recentResult.rows[0].count),
      oldestMessage: oldestResult.rows[0].oldest || undefined
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export { Database };