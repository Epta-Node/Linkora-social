import type { SqlDatabase } from "./database";
import type { FeedCursor, PendingPost, PendingStatus, PostRecord, PostStore } from "./types";

/**
 * SQLite-backed implementation of {@link PostStore}.
 *
 * Holds all of the SQL for the offline cache. The logic mirrors
 * {@link ./MemoryPostStore.MemoryPostStore} exactly so behaviour is consistent
 * regardless of which backend is active at runtime.
 */
export class SqlitePostStore implements PostStore {
  constructor(private readonly db: SqlDatabase) {}

  async init(): Promise<void> {
    // Migrations are applied by `openLinkoraDatabase`; nothing else to do.
  }

  async upsertPosts(posts: PostRecord[]): Promise<void> {
    for (const post of posts) {
      await this.db.runAsync(
        `INSERT INTO posts (id, author, content, tip_total, like_count, timestamp, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           author = excluded.author,
           content = excluded.content,
           tip_total = excluded.tip_total,
           like_count = excluded.like_count,
           timestamp = excluded.timestamp,
           synced_at = excluded.synced_at;`,
        [
          post.id,
          post.author,
          post.content,
          post.tip_total,
          post.like_count,
          post.timestamp,
          post.synced_at,
        ]
      );
    }
  }

  async getPage(offset: number, limit: number): Promise<PostRecord[]> {
    return this.db.getAllAsync<PostRecord>(
      `SELECT id, author, content, tip_total, like_count, timestamp, synced_at
       FROM posts
       ORDER BY timestamp DESC, id ASC
       LIMIT ? OFFSET ?;`,
      [limit, offset]
    );
  }

  async findMatchingPost(
    author: string,
    content: string,
    timestamp: number,
    windowSeconds: number
  ): Promise<PostRecord | null> {
    return this.db.getFirstAsync<PostRecord>(
      `SELECT id, author, content, tip_total, like_count, timestamp, synced_at
       FROM posts
       WHERE author = ? AND content = ? AND ABS(timestamp - ?) <= ?
       LIMIT 1;`,
      [author, content, timestamp, windowSeconds]
    );
  }

  async insertPending(post: PendingPost): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO pending_posts (local_id, content, created_at, status, error)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(local_id) DO UPDATE SET
         content = excluded.content,
         created_at = excluded.created_at,
         status = excluded.status,
         error = excluded.error;`,
      [post.local_id, post.content, post.created_at, post.status, post.error]
    );
  }

  async getPending(): Promise<PendingPost[]> {
    return this.db.getAllAsync<PendingPost>(
      `SELECT local_id, content, created_at, status, error
       FROM pending_posts
       ORDER BY created_at ASC;`
    );
  }

  async getPendingById(localId: string): Promise<PendingPost | null> {
    return this.db.getFirstAsync<PendingPost>(
      `SELECT local_id, content, created_at, status, error
       FROM pending_posts
       WHERE local_id = ?
       LIMIT 1;`,
      [localId]
    );
  }

  async updatePendingStatus(
    localId: string,
    status: PendingStatus,
    error: string | null
  ): Promise<void> {
    await this.db.runAsync(`UPDATE pending_posts SET status = ?, error = ? WHERE local_id = ?;`, [
      status,
      error,
      localId,
    ]);
  }

  async removePending(localId: string): Promise<void> {
    await this.db.runAsync(`DELETE FROM pending_posts WHERE local_id = ?;`, [localId]);
  }

  async getCursor(feedType: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<FeedCursor>(
      `SELECT feed_type, last_cursor, updated_at FROM feed_cursor WHERE feed_type = ? LIMIT 1;`,
      [feedType]
    );
    return row?.last_cursor ?? null;
  }

  async setCursor(feedType: string, cursor: string | null): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO feed_cursor (feed_type, last_cursor, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(feed_type) DO UPDATE SET
         last_cursor = excluded.last_cursor,
         updated_at = excluded.updated_at;`,
      [feedType, cursor, Math.floor(Date.now() / 1000)]
    );
  }
}
