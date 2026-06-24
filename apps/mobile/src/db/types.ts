/**
 * Shared types for the offline-first post cache.
 *
 * These mirror the SQLite schema defined in {@link ./schema.ts} but are kept
 * framework agnostic so the repository can be unit tested without a native
 * SQLite module present.
 */

/** A confirmed post as stored in the `posts` table. */
export interface PostRecord {
  /** Contract-assigned post id. */
  id: string;
  author: string;
  content: string;
  /** Total tips, kept as a string to avoid 53-bit precision loss. */
  tip_total: string;
  like_count: number;
  /** Unix seconds. */
  timestamp: number;
  /** Unix seconds at which the row was last written from the indexer. */
  synced_at: number;
}

export type PendingStatus = "pending" | "syncing" | "failed";

/** A locally created post awaiting on-chain confirmation. */
export interface PendingPost {
  local_id: string;
  content: string;
  /** Unix seconds. */
  created_at: number;
  status: PendingStatus;
  error: string | null;
}

/** Cursor bookkeeping for incremental, cursor-based feed syncs. */
export interface FeedCursor {
  feed_type: string;
  last_cursor: string | null;
  updated_at: number;
}

/**
 * Storage backend contract. Implemented by both the production SQLite store
 * ({@link ./SqlitePostStore.SqlitePostStore}) and the in-memory store
 * ({@link ./MemoryPostStore.MemoryPostStore}) used as a fallback and in tests.
 */
export interface PostStore {
  init(): Promise<void>;

  upsertPosts(posts: PostRecord[]): Promise<void>;
  getPage(offset: number, limit: number): Promise<PostRecord[]>;
  /**
   * Finds a confirmed post by the same author whose content matches and whose
   * timestamp falls within `windowSeconds` of `timestamp`. Used for idempotency
   * checks when reconciling stale pending posts.
   */
  findMatchingPost(
    author: string,
    content: string,
    timestamp: number,
    windowSeconds: number
  ): Promise<PostRecord | null>;

  insertPending(post: PendingPost): Promise<void>;
  getPending(): Promise<PendingPost[]>;
  getPendingById(localId: string): Promise<PendingPost | null>;
  updatePendingStatus(localId: string, status: PendingStatus, error: string | null): Promise<void>;
  removePending(localId: string): Promise<void>;

  getCursor(feedType: string): Promise<string | null>;
  setCursor(feedType: string, cursor: string | null): Promise<void>;
}
