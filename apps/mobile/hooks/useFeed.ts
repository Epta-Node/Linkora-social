import { useCallback, useEffect, useRef, useState } from "react";
import { Post } from "../components/PostCard";
import { initDatabase, getCachedPosts, evictStaleCache } from "../utils/db";
import { fetchAndCachePosts, syncPendingPosts } from "../utils/sync";

const PAGE_SIZE = 10;

// Global event system for notifying feed updates (optimistic post creation/confirmations)
const feedUpdateListeners = new Set<() => void>();

export function notifyFeedUpdate(): void {
  feedUpdateListeners.forEach((listener) => listener());
}

export function subscribeToFeedUpdates(listener: () => void): () => void {
  feedUpdateListeners.add(listener);
  return () => {
    feedUpdateListeners.delete(listener);
  };
}

export function getFeedPostById(postId: string): Promise<Post | null> {
  // Return via DB import if needed, or query cache.
  // Note: Since this is now async, screens should fetch it asynchronously.
  return import("../utils/db").then((db) => db.getCachedPostById(postId));
}

export const getFeedPost = getFeedPostById;

export function markFeedPostDeleted(postId: string | number): void {
  // Mark post deleted in local cache
  import("../utils/db").then(async (db) => {
    await db.deleteCachedPost(String(postId));
    notifyFeedUpdate();
  });
}

export interface UseFeedReturn {
  posts: Post[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
}

export function useFeed(): UseFeedReturn {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const offsetRef = useRef(0);
  const loadingRef = useRef(false);

  // Load posts from SQLite cache
  const loadFromCache = useCallback(async (limit: number, replace: boolean) => {
    try {
      const offset = replace ? 0 : offsetRef.current;
      const cached = await getCachedPosts(limit, offset);

      setPosts((prev) => {
        const next = replace ? cached : [...prev, ...cached];
        offsetRef.current = next.length;
        return next;
      });
      setHasMore(cached.length >= limit);
    } catch (err) {
      console.warn("Failed to load posts from SQLite cache:", err);
    }
  }, []);

  // Fetch from network, reconcile, and reload cache
  const syncWithNetwork = useCallback(
    async (replace: boolean) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setError(null);

      try {
        // 1. Initialize DB if not done
        await initDatabase();

        // 2. Fetch remote page and upsert to SQLite
        const offset = replace ? 0 : offsetRef.current;
        await fetchAndCachePosts(PAGE_SIZE, offset);

        // 3. Evict stale rows periodically on initial refresh
        if (replace) {
          await evictStaleCache();
        }

        // 4. Reload from SQLite (the entire loaded list so far, to refresh all visible posts)
        const currentLoadedCount = replace ? PAGE_SIZE : posts.length + PAGE_SIZE;
        const cached = await getCachedPosts(currentLoadedCount, 0);
        setPosts(cached);
        offsetRef.current = cached.length;
        setHasMore(cached.length >= currentLoadedCount);

        // 5. Fire background sync for pending posts
        void syncPendingPosts().then(() => {
          notifyFeedUpdate();
        });
      } catch (err) {
        console.warn("Network sync failed, displaying cached data:", err);
        // Fallback: just load from cache if we haven't already
        if (posts.length === 0) {
          await loadFromCache(PAGE_SIZE, true);
        }
        setError("Offline mode. Serving cached posts.");
      } finally {
        setLoading(false);
        loadingRef.current = false;
      }
    },
    [posts.length, loadFromCache]
  );

  // Initial load
  useEffect(() => {
    let active = true;
    async function init() {
      await initDatabase();
      if (!active) return;
      // Load cache instantly
      await loadFromCache(PAGE_SIZE, true);
      setLoading(false);
      // Trigger network sync in background
      void syncWithNetwork(true);
    }
    init();
    return () => {
      active = false;
    };
  }, [loadFromCache, syncWithNetwork]);

  // Subscribe to feed updates (e.g. from optimistic creation or sync confirmation)
  useEffect(() => {
    return subscribeToFeedUpdates(async () => {
      const limit = Math.max(PAGE_SIZE, posts.length);
      const cached = await getCachedPosts(limit, 0);
      setPosts(cached);
      offsetRef.current = cached.length;
    });
  }, [posts.length]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      void syncWithNetwork(false);
    }
  }, [loading, hasMore, syncWithNetwork]);

  const refresh = useCallback(() => {
    void syncWithNetwork(true);
  }, [syncWithNetwork]);

  return { posts, loading, error, hasMore, loadMore, refresh };
}
