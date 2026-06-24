import { MemoryPostStore } from "./MemoryPostStore";
import { openLinkoraDatabase } from "./database";
import { SqlitePostStore } from "./SqlitePostStore";
import type { PendingPost, PostRecord, PostStore } from "./types";

/** Window (24h) within which a stale pending post is matched to an indexer post. */
export const CONFLICT_WINDOW_SECONDS = 24 * 60 * 60;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * High-level persistence API for the offline-first feed.
 *
 * Wraps a {@link PostStore} backend (SQLite in production, in-memory as a
 * fallback) and exposes the operations the feed and sync layers need.
 */
export class PostRepository {
  constructor(private readonly store: PostStore) {}

  /**
   * Builds a repository backed by SQLite when available, otherwise falls back
   * to an in-memory store so the app still functions (e.g. on web or in tests).
   */
  static async create(): Promise<PostRepository> {
    const db = await openLinkoraDatabase();
    const store: PostStore = db ? new SqlitePostStore(db) : new MemoryPostStore();
    await store.init();
    return new PostRepository(store);
  }

  init(): Promise<void> {
    return this.store.init();
  }

  /** Upserts confirmed posts coming from the indexer. */
  upsert(posts: PostRecord[]): Promise<void> {
    return this.store.upsertPosts(posts);
  }

  /** Reads a page of confirmed posts ordered newest first. */
  getPage(offset: number, limit: number): Promise<PostRecord[]> {
    return this.store.getPage(offset, limit);
  }

  /** Lists locally created posts awaiting confirmation. */
  getPending(): Promise<PendingPost[]> {
    return this.store.getPending();
  }

  getPendingById(localId: string): Promise<PendingPost | null> {
    return this.store.getPendingById(localId);
  }

  /** Inserts a new optimistic (pending) post and returns it. */
  async addPending(localId: string, content: string): Promise<PendingPost> {
    const pending: PendingPost = {
      local_id: localId,
      content,
      created_at: nowSeconds(),
      status: "pending",
      error: null,
    };
    await this.store.insertPending(pending);
    return pending;
  }

  /** Marks a pending post as actively submitting. */
  async markSyncing(localId: string): Promise<void> {
    await this.store.updatePendingStatus(localId, "syncing", null);
  }

  /**
   * Promotes a confirmed pending post into the `posts` table under its
   * contract-assigned id and removes it from `pending_posts`.
   */
  async markSynced(
    localId: string,
    contractId: string,
    author: string
  ): Promise<PostRecord | null> {
    const pending = await this.store.getPendingById(localId);
    if (!pending) {
      await this.store.removePending(localId);
      return null;
    }
    const record: PostRecord = {
      id: contractId,
      author,
      content: pending.content,
      tip_total: "0",
      like_count: 0,
      timestamp: pending.created_at,
      synced_at: nowSeconds(),
    };
    await this.store.upsertPosts([record]);
    await this.store.removePending(localId);
    return record;
  }

  /** Marks a pending post as failed so the UI can offer a retry. */
  async markFailed(localId: string, error: string): Promise<void> {
    await this.store.updatePendingStatus(localId, "failed", error);
  }

  /**
   * Idempotency check: returns the matching confirmed post if the indexer
   * already contains the post represented by `pending` (same author + content
   * within the conflict window), otherwise `null`.
   */
  findConfirmedMatch(author: string, pending: PendingPost): Promise<PostRecord | null> {
    return this.store.findMatchingPost(
      author,
      pending.content,
      pending.created_at,
      CONFLICT_WINDOW_SECONDS
    );
  }

  getCursor(feedType: string): Promise<string | null> {
    return this.store.getCursor(feedType);
  }

  setCursor(feedType: string, cursor: string | null): Promise<void> {
    return this.store.setCursor(feedType, cursor);
  }
}
