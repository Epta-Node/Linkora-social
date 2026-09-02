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

export type DmSyncStatus = "synced" | "pending" | "failed";

export interface DmMessage {
  id: string;
  conversationId: string;
  sender: string;
  recipient: string;
  content: string;
  ciphertextHash: string;
  timestamp: number;
  syncStatus: DmSyncStatus;
  errorMessage: string | null;
}

export interface IncomingDmMessage {
  id: string;
  sender: string;
  recipient: string;
  content: string;
  ciphertextHash: string;
  timestamp: number;
}

export interface DmMergeResult {
  mergedCount: number;
  newestTimestamp: number | null;
}

interface DmMessageRow {
  id: string;
  conversation_id: string;
  sender: string;
  recipient: string;
  content: string;
  ciphertext_hash: string;
  timestamp: number;
  sync_status: string;
  error_message: string | null;
}

function rowToDmMessage(row: DmMessageRow): DmMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sender: row.sender,
    recipient: row.recipient,
    content: row.content,
    ciphertextHash: row.ciphertext_hash,
    timestamp: Number(row.timestamp),
    syncStatus: row.sync_status as DmSyncStatus,
    errorMessage: row.error_message,
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

    CREATE TABLE IF NOT EXISTS dm_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      recipient TEXT NOT NULL,
      content TEXT NOT NULL,
      ciphertext_hash TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      sync_status TEXT NOT NULL, -- 'synced' | 'pending' | 'failed'
      error_message TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dm_messages_conversation_ts
      ON dm_messages (conversation_id, timestamp ASC);
    CREATE INDEX IF NOT EXISTS idx_dm_messages_conversation_hash
      ON dm_messages (conversation_id, ciphertext_hash);

    CREATE TABLE IF NOT EXISTS dm_sync_state (
      conversation_id TEXT PRIMARY KEY,
      sync_cursor INTEGER NOT NULL DEFAULT 0,
      last_read INTEGER NOT NULL DEFAULT 0
    );
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
 * Retrieves multiple cached posts by ID in a single query, keyed by ID.
 * IDs with no cached row are simply absent from the returned map.
 */
export async function getCachedPostsByIds(ids: string[]): Promise<Map<string, Post>> {
  const map = new Map<string, Post>();
  if (ids.length === 0) return map;

  const placeholders = ids.map(() => "?").join(",");
  const rows = await db.getAllAsync<CachedPostRow>(
    `SELECT * FROM cached_posts WHERE id IN (${placeholders})`,
    ids
  );
  for (const row of rows) {
    map.set(row.id, rowToPost(row));
  }
  return map;
}

/**
 * Reconciles remote (chain-confirmed) posts with the local cache.
 *
 * Chain-wins policy:
 *  - For every confirmed chain post, upsert it as 'synced'.
 *  - If a 'pending' or 'failed' optimistic row exists with the SAME author+content
 *    as a confirmed chain post, delete the optimistic row (chain state supersedes it).
 *  - Stale 'synced' rows not present in the remote set are deleted.
 *
 * Runs a fixed number of SQLite statements regardless of feed size: one
 * multi-row upsert, one multi-condition delete for superseded optimistic
 * rows, and one stale-eviction delete — instead of two `runAsync` calls per
 * post inside the transaction.
 */
export async function reconcilePosts(remotePosts: Post[]): Promise<void> {
  if (remotePosts.length === 0) return;

  await db.withTransactionAsync(async () => {
    const createdAt = Math.floor(Date.now() / 1000);

    // Upsert every confirmed chain post in one multi-row statement — chain
    // state always wins on conflict.
    const insertPlaceholders = remotePosts
      .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, 'synced', ?)")
      .join(", ");
    const insertParams = remotePosts.flatMap((post) => [
      String(post.id),
      post.author,
      post.username || "stellar_user",
      post.content,
      post.tip_total,
      post.timestamp,
      post.like_count,
      post.has_liked ? 1 : 0,
      createdAt,
    ]);
    await db.runAsync(
      `INSERT INTO cached_posts (id, author, username, content, tip_total, timestamp, like_count, has_liked, sync_status, created_at)
       VALUES ${insertPlaceholders}
       ON CONFLICT(id) DO UPDATE SET
         author      = excluded.author,
         username    = excluded.username,
         content     = excluded.content,
         tip_total   = excluded.tip_total,
         timestamp   = excluded.timestamp,
         like_count  = excluded.like_count,
         has_liked   = excluded.has_liked,
         sync_status = 'synced';`,
      insertParams
    );

    // Chain-wins conflict resolution, batched across every post: delete any
    // optimistic (pending/failed) row that matches a confirmed post's
    // author+content but has a different local ID.
    const deleteConditions = remotePosts
      .map(() => "(author = ? AND content = ? AND id != ?)")
      .join(" OR ");
    const deleteParams = remotePosts.flatMap((post) => [
      post.author,
      post.content,
      String(post.id),
    ]);
    await db.runAsync(
      `DELETE FROM cached_posts WHERE sync_status IN ('pending', 'failed') AND (${deleteConditions})`,
      deleteParams
    );

    // Evict stale synced rows that are no longer in the remote set.
    if (remotePosts.length > 0) {
      const remoteIds = remotePosts.map(() => "?").join(",");
      await db.runAsync(
        `DELETE FROM cached_posts WHERE sync_status = 'synced' AND id NOT IN (${remoteIds})`,
        remotePosts.map((post) => String(post.id))
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

/**
 * Returns all locally known messages for a conversation, oldest first.
 * Includes outbox entries still 'pending' or 'failed' alongside 'synced' ones
 * so the thread renders optimistic sends immediately.
 */
export async function getDmMessages(conversationId: string): Promise<DmMessage[]> {
  const rows = await db.getAllAsync<DmMessageRow>(
    `SELECT * FROM dm_messages WHERE conversation_id = ? ORDER BY timestamp ASC`,
    [conversationId]
  );
  return rows.map(rowToDmMessage);
}

/**
 * Reconciles relay-confirmed messages into the local thread.
 *
 * Relay-wins policy:
 *  - Every incoming message is upserted as 'synced', keyed by its relay-assigned id.
 *  - A local 'pending'/'failed' outbox row with the SAME ciphertext hash (the same
 *    logical message, composed on this or another device before the relay assigned
 *    it an id) is deleted once its confirmed counterpart lands — this is what
 *    prevents an optimistic send from showing up twice after reconciliation.
 */
export async function mergeDmDeltas(
  conversationId: string,
  incoming: IncomingDmMessage[]
): Promise<DmMergeResult> {
  let newestTimestamp: number | null = null;

  await db.withTransactionAsync(async () => {
    for (const msg of incoming) {
      await db.runAsync(
        `INSERT INTO dm_messages (id, conversation_id, sender, recipient, content, ciphertext_hash, timestamp, sync_status, error_message, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'synced', NULL, ?)
         ON CONFLICT(id) DO UPDATE SET
           content         = excluded.content,
           ciphertext_hash = excluded.ciphertext_hash,
           timestamp       = excluded.timestamp,
           sync_status     = 'synced',
           error_message   = NULL;`,
        [
          msg.id,
          conversationId,
          msg.sender,
          msg.recipient,
          msg.content,
          msg.ciphertextHash,
          msg.timestamp,
          Math.floor(Date.now() / 1000),
        ]
      );

      await db.runAsync(
        `DELETE FROM dm_messages
         WHERE conversation_id = ?
           AND sync_status IN ('pending', 'failed')
           AND ciphertext_hash = ?
           AND id != ?`,
        [conversationId, msg.ciphertextHash, msg.id]
      );

      if (newestTimestamp === null || msg.timestamp > newestTimestamp) {
        newestTimestamp = msg.timestamp;
      }
    }
  });

  return { mergedCount: incoming.length, newestTimestamp };
}

/**
 * Inserts a locally composed message awaiting relay confirmation.
 */
export async function addOutboxDmMessage(
  conversationId: string,
  sender: string,
  recipient: string,
  content: string,
  ciphertextHash: string
): Promise<DmMessage> {
  const localId = `dm_local_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const timestamp = Math.floor(Date.now() / 1000);
  await db.runAsync(
    `INSERT INTO dm_messages (id, conversation_id, sender, recipient, content, ciphertext_hash, timestamp, sync_status, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?)`,
    [localId, conversationId, sender, recipient, content, ciphertextHash, timestamp, timestamp]
  );
  return {
    id: localId,
    conversationId,
    sender,
    recipient,
    content,
    ciphertextHash,
    timestamp,
    syncStatus: "pending",
    errorMessage: null,
  };
}

/**
 * Marks an outbox message as rejected by the relay, preserving the reason so
 * the thread UI can surface it instead of leaving it silently pending.
 */
export async function markDmMessageFailed(localId: string, errorMessage: string): Promise<void> {
  await db.runAsync(
    `UPDATE dm_messages SET sync_status = 'failed', error_message = ? WHERE id = ?`,
    [errorMessage, localId]
  );
}

/**
 * Returns the timestamp this device last reconciled up to for a conversation.
 * 0 means the conversation has never been synced.
 */
export async function getDmSyncCursor(conversationId: string): Promise<number> {
  const row = await db.getFirstAsync<{ sync_cursor: number }>(
    `SELECT sync_cursor FROM dm_sync_state WHERE conversation_id = ?`,
    [conversationId]
  );
  return row ? Number(row.sync_cursor) : 0;
}

/**
 * Advances the per-conversation sync cursor. Monotonic: never moves backward,
 * even if called with an older timestamp than what's already stored.
 */
export async function setDmSyncCursor(conversationId: string, cursor: number): Promise<void> {
  await db.runAsync(
    `INSERT INTO dm_sync_state (conversation_id, sync_cursor, last_read)
     VALUES (?, ?, 0)
     ON CONFLICT(conversation_id) DO UPDATE SET
       sync_cursor = MAX(sync_cursor, excluded.sync_cursor);`,
    [conversationId, cursor]
  );
}

/**
 * Returns the timestamp up to which the user has read this conversation.
 */
export async function getDmLastRead(conversationId: string): Promise<number> {
  const row = await db.getFirstAsync<{ last_read: number }>(
    `SELECT last_read FROM dm_sync_state WHERE conversation_id = ?`,
    [conversationId]
  );
  return row ? Number(row.last_read) : 0;
}

/**
 * Advances the read watermark. Monotonic, like the sync cursor.
 *
 * Callers must only pass the timestamp of a message that has actually been
 * reconciled (sync_status = 'synced') from the merged state — advancing it
 * from a pre-reconciliation local snapshot can mark messages that arrived on
 * another device while this one was offline as already read.
 */
export async function setDmLastRead(conversationId: string, timestamp: number): Promise<void> {
  await db.runAsync(
    `INSERT INTO dm_sync_state (conversation_id, sync_cursor, last_read)
     VALUES (?, 0, ?)
     ON CONFLICT(conversation_id) DO UPDATE SET
       last_read = MAX(last_read, excluded.last_read);`,
    [conversationId, timestamp]
  );
}
