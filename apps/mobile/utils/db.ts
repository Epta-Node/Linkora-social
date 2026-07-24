import * as SQLite from "expo-sqlite";
import { Post } from "../components/PostCard";

const db = SQLite.openDatabaseSync("linkora_cache.db");

interface CachedPostRow {
  id: string;
  author: string;
  username: string;
  content: string;
  tip_total: number;
  timestamp: number;
  like_count: number;
  has_liked: number;
  sync_status: string;
}

function rowToPost(row: CachedPostRow): Post {
  return {
    id: row.id,
    author: row.author,
    username: row.username,
    content: row.content,
    tip_total: Number(row.tip_total),
    timestamp: Number(row.timestamp),
    like_count: Number(row.like_count),
    has_liked: row.has_liked === 1,
    sync_status: row.sync_status as "synced" | "pending" | "failed",
  };
}

/**
 * Initializes the database schema and indices.
 */
export async function initDatabase(): Promise<void> {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS cached_posts (
      id TEXT PRIMARY KEY,
      author TEXT NOT NULL,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      tip_total INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      like_count INTEGER NOT NULL,
      has_liked INTEGER DEFAULT 0,
      sync_status TEXT NOT NULL, -- 'synced' | 'pending' | 'failed'
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_posts_timestamp ON cached_posts (timestamp DESC);
  `);
}

/**
 * Retrieves paginated posts from the local cache.
 */
export async function getCachedPosts(limit: number, offset: number): Promise<Post[]> {
  const rows = await db.getAllAsync<CachedPostRow>(
    `SELECT * FROM cached_posts ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  return rows.map(rowToPost);
}

/**
 * Retrieves a single cached post by ID.
 */
export async function getCachedPostById(id: string): Promise<Post | null> {
  const row = await db.getFirstAsync<CachedPostRow>(`SELECT * FROM cached_posts WHERE id = ?`, [
    id,
  ]);
  return row ? rowToPost(row) : null;
}

/**
 * Reconciles remote (chain-confirmed) posts with the local cache.
 *
 * Chain-wins policy:
 *  - For every confirmed chain post, upsert it as 'synced'.
 *  - If a 'pending' or 'failed' optimistic row exists with the SAME author+content
 *    as a confirmed chain post, delete the optimistic row (chain state supersedes it).
 *  - Stale 'synced' rows not present in the remote set are deleted.
 */
export async function reconcilePosts(remotePosts: Post[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const post of remotePosts) {
      // Upsert the confirmed chain post — chain state always wins on conflict.
      await db.runAsync(
        `INSERT INTO cached_posts (id, author, username, content, tip_total, timestamp, like_count, has_liked, sync_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?)
         ON CONFLICT(id) DO UPDATE SET
           author      = excluded.author,
           username    = excluded.username,
           content     = excluded.content,
           tip_total   = excluded.tip_total,
           timestamp   = excluded.timestamp,
           like_count  = excluded.like_count,
           has_liked   = excluded.has_liked,
           sync_status = 'synced';`,
        [
          String(post.id),
          post.author,
          post.username || "stellar_user",
          post.content,
          post.tip_total,
          post.timestamp,
          post.like_count,
          post.has_liked ? 1 : 0,
          Math.floor(Date.now() / 1000),
        ]
      );

      // Chain-wins conflict resolution:
      // If an optimistic (pending/failed) row exists for the same author+content
      // but with a different local ID, the chain version is the truth — remove the local stub.
      await db.runAsync(
        `DELETE FROM cached_posts
         WHERE sync_status IN ('pending', 'failed')
           AND author  = ?
           AND content = ?
           AND id     != ?`,
        [post.author, post.content, String(post.id)]
      );
    }

    // Evict stale synced rows that are no longer in the remote set.
    if (remotePosts.length > 0) {
      const remoteIds = remotePosts.map((p) => `'${String(p.id)}'`).join(",");
      await db.runAsync(
        `DELETE FROM cached_posts WHERE sync_status = 'synced' AND id NOT IN (${remoteIds})`,
        []
      );
    }
  });
}

/**
 * Inserts an optimistic/pending post.
 */
export async function addOptimisticPost(
  author: string,
  content: string,
  username: string
): Promise<string> {
  const localId = `opt_${Date.now()}`;
  const timestamp = Math.floor(Date.now() / 1000);
  await db.runAsync(
    `INSERT INTO cached_posts (id, author, username, content, tip_total, timestamp, like_count, has_liked, sync_status, created_at)
     VALUES (?, ?, ?, ?, 0, ?, 0, 0, 'pending', ?)`,
    [localId, author, username, content, timestamp, timestamp]
  );
  return localId;
}

/**
 * Updates a pending post's sync status to synced and re-keys its ID.
 */
export async function confirmPendingPost(localId: string, realId: string): Promise<void> {
  const exists = await getCachedPostById(realId);
  await db.withTransactionAsync(async () => {
    if (exists) {
      await db.runAsync(`DELETE FROM cached_posts WHERE id = ?`, [localId]);
    } else {
      await db.runAsync(`UPDATE cached_posts SET id = ?, sync_status = 'synced' WHERE id = ?`, [
        realId,
        localId,
      ]);
    }
  });
}

/**
 * Marks a pending post as failed.
 */
export async function markPendingPostFailed(localId: string): Promise<void> {
  await db.runAsync(`UPDATE cached_posts SET sync_status = 'failed' WHERE id = ?`, [localId]);
}

/**
 * Returns all pending or failed posts.
 */
export async function getPendingPosts(): Promise<Post[]> {
  const rows = await db.getAllAsync<CachedPostRow>(
    `SELECT * FROM cached_posts WHERE sync_status = 'pending' OR sync_status = 'failed'`,
    []
  );
  return rows.map(rowToPost);
}

/**
 * Evicts old posts to keep the cache lightweight.
 */
export async function evictStaleCache(
  maxAgeSeconds: number = 86400 * 7,
  maxRows: number = 100
): Promise<void> {
  const cutoff = Math.floor(Date.now() / 1000) - maxAgeSeconds;
  await db.runAsync(`DELETE FROM cached_posts WHERE sync_status = 'synced' AND timestamp < ?`, [
    cutoff,
  ]);
  await db.runAsync(
    `DELETE FROM cached_posts
     WHERE sync_status = 'synced'
     AND id NOT IN (
       SELECT id FROM cached_posts
       WHERE sync_status = 'synced'
       ORDER BY timestamp DESC
       LIMIT ?
     )`,
    [maxRows]
  );
}

/**
 * Deletes a cached post by its ID.
 */
export async function deleteCachedPost(id: string): Promise<void> {
  await db.runAsync(`DELETE FROM cached_posts WHERE id = ?`, [id]);
}
