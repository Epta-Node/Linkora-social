import type { FeedCursor, PendingPost, PendingStatus, PostRecord, PostStore } from "./types";

/**
 * In-memory implementation of {@link PostStore}.
 *
 * Used both as a graceful fallback when a native SQLite module is unavailable
 * (e.g. on web or during tests) and as the unit-test backend for the
 * repository and sync logic. Behaviour is intentionally kept identical to the
 * SQLite store so tests are meaningful.
 */
export class MemoryPostStore implements PostStore {
  private posts = new Map<string, PostRecord>();
  private pending = new Map<string, PendingPost>();
  private cursors = new Map<string, FeedCursor>();

  async init(): Promise<void> {
    // Nothing to migrate for the in-memory backend.
  }

  async upsertPosts(posts: PostRecord[]): Promise<void> {
    for (const post of posts) {
      this.posts.set(post.id, { ...post });
    }
  }

  async getPage(offset: number, limit: number): Promise<PostRecord[]> {
    return [...this.posts.values()]
      .sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id))
      .slice(offset, offset + limit)
      .map((post) => ({ ...post }));
  }

  async findMatchingPost(
    author: string,
    content: string,
    timestamp: number,
    windowSeconds: number
  ): Promise<PostRecord | null> {
    for (const post of this.posts.values()) {
      if (
        post.author === author &&
        post.content === content &&
        Math.abs(post.timestamp - timestamp) <= windowSeconds
      ) {
        return { ...post };
      }
    }
    return null;
  }

  async insertPending(post: PendingPost): Promise<void> {
    this.pending.set(post.local_id, { ...post });
  }

  async getPending(): Promise<PendingPost[]> {
    return [...this.pending.values()]
      .sort((a, b) => a.created_at - b.created_at)
      .map((post) => ({ ...post }));
  }

  async getPendingById(localId: string): Promise<PendingPost | null> {
    const found = this.pending.get(localId);
    return found ? { ...found } : null;
  }

  async updatePendingStatus(
    localId: string,
    status: PendingStatus,
    error: string | null
  ): Promise<void> {
    const existing = this.pending.get(localId);
    if (!existing) return;
    this.pending.set(localId, { ...existing, status, error });
  }

  async removePending(localId: string): Promise<void> {
    this.pending.delete(localId);
  }

  async getCursor(feedType: string): Promise<string | null> {
    return this.cursors.get(feedType)?.last_cursor ?? null;
  }

  async setCursor(feedType: string, cursor: string | null): Promise<void> {
    this.cursors.set(feedType, {
      feed_type: feedType,
      last_cursor: cursor,
      updated_at: Math.floor(Date.now() / 1000),
    });
  }
}
