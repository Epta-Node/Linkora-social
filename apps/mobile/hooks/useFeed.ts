import { useCallback, useEffect, useRef, useState } from "react";
import { Post } from "../components/PostCard";
import { initDatabase, getCachedPosts, evictStaleCache } from "../utils/db";
import {
  fetchAndCachePosts,
  fetchPostById,
  getSyncPendingPostsOptions,
  resolvePostWithFallback,
  syncPendingPosts,
} from "../utils/sync";
import { useNetworkContext } from "../context/NetworkContext";

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

/**
 * Resolves a post for a detail screen: local cache first, then the indexer.
 *
 * The detail screen used to resolve its content from SQLite alone, so every
 * deep link, share and notification target for a post outside the newest cached
 * page rendered "not found" (#1544).
 */
export function getFeedPostById(postId: string): Promise<Post | null> {
  return resolvePostWithFallback(postId);
}

export const getFeedPost = getFeedPostById;

/**
 * Retry action for a post the screen could not load: forces a fresh indexer
 * fetch, bypassing the cache, and writes the result back.
 */
export function retryPostFetch(postId: string): Promise<Post | null> {
  return fetchPostById(postId);
}

export function markFeedPostDeleted(postId: string | number): void {
  // Mark post deleted in local cache
  import("../utils/db").then(async (db) => {
    await db.deleteCachedPost(String(postId));
    notifyFeedUpdate();
  });
}

export interface UseFeedReturn {
  posts: Post[];
  /** True only while the very first page is loading (skeleton state). */
  loading: boolean;
  /** True while a pull-to-refresh reload of the first page is in flight. */
  refreshing: boolean;
  /** True while the next page is being fetched (footer spinner). */
  loadingMore: boolean;
  error: string | null;
  /** Set when fetching the next page failed; the cursor is left untouched. */
  loadMoreError: string | null;
  /** False once the indexer returned a short page — the end of the feed. */
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
}

type SyncMode = "initial" | "refresh" | "more";

export function useFeed(): UseFeedReturn {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const { contractId, rpcUrl, network } = useNetworkContext();

  // Number of indexer rows fetched so far — the offset of the next page.
  const offsetRef = useRef(0);
  const loadingRef = useRef(false);
  const loadedPostsRef = useRef(0);
  const postsLengthRef = useRef(0);
  const hasMoreRef = useRef(true);
  // Always holds the *current* network id, independent of which network a
  // given syncWithNetwork call started under — read after the network
  // round-trip below to detect a switch that happened mid-flight.
  const networkIdRef = useRef(network.id);
  useEffect(() => {
    networkIdRef.current = network.id;
  }, [network.id]);

  const applyPosts = useCallback((next: Post[]) => {
    setPosts(next);
    loadedPostsRef.current = next.length;
    postsLengthRef.current = next.length;
  }, []);

  const applyHasMore = useCallback((value: boolean) => {
    hasMoreRef.current = value;
    setHasMore(value);
  }, []);

  // Load the first page from the SQLite cache so the feed paints instantly.
  const loadFromCache = useCallback(async () => {
    try {
      const cached = await getCachedPosts(PAGE_SIZE, 0);
      applyPosts(cached);
      offsetRef.current = cached.length;
    } catch (err) {
      console.warn("Failed to load posts from SQLite cache:", err);
    }
  }, [applyPosts]);

  // Fetch a page from the indexer, reconcile it into SQLite, then re-read the
  // visible window from the cache.
  const syncWithNetwork = useCallback(
    async (mode: SyncMode) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      const replace = mode !== "more";
      if (mode === "refresh") setRefreshing(true);
      if (mode === "more") {
        setLoadingMore(true);
        setLoadMoreError(null);
      } else {
        setError(null);
        setLoadMoreError(null);
      }
      // Captured once, together with contractId/rpcUrl in this closure — see
      // the dependency array below. Used to drop results from a call that was
      // still in flight when the user switched networks (#1550).
      const startNetworkId = network.id;

      try {
        await initDatabase();

        const offset = replace ? 0 : offsetRef.current;
        const page = await fetchAndCachePosts(PAGE_SIZE, offset, !replace);

        if (networkIdRef.current !== startNetworkId) return;

        if (replace) {
          await evictStaleCache();
        }

        // A short page means the indexer has nothing beyond it (#1851).
        const reachedEnd = page.length < PAGE_SIZE;
        offsetRef.current = offset + page.length;

        const windowSize = replace
          ? Math.max(PAGE_SIZE, page.length)
          : loadedPostsRef.current + page.length;
        const cached = await getCachedPosts(windowSize, 0);

        if (networkIdRef.current !== startNetworkId) return;

        applyPosts(cached);
        applyHasMore(!reachedEnd);

        // Fire background sync for pending posts (only if wallet kit is available)
        const syncOptions = getSyncPendingPostsOptions(contractId, rpcUrl, network.id);
        if (syncOptions) {
          void syncPendingPosts(syncOptions).then(() => {
            notifyFeedUpdate();
          });
        }
      } catch (err) {
        console.warn("Network sync failed, displaying cached data:", err);
        if (mode === "more") {
          // Keep the cursor where it was so a retry asks for the same page.
          setLoadMoreError("Could not load more posts.");
        } else {
          if (loadedPostsRef.current === 0) {
            await loadFromCache();
          }
          setError("Offline mode. Serving cached posts.");
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
        loadingRef.current = false;
      }
    },
    [applyHasMore, applyPosts, loadFromCache, contractId, rpcUrl, network.id]
  );

  // Initial load
  useEffect(() => {
    let active = true;
    async function init() {
      await initDatabase();
      if (!active) return;
      // Load cache instantly
      await loadFromCache();
      if (!active) return;
      if (loadedPostsRef.current > 0) setLoading(false);
      // Trigger network sync in background
      void syncWithNetwork("initial");
    }
    init();
    return () => {
      active = false;
    };
    // Re-runs whenever syncWithNetwork's identity changes — i.e. whenever
    // contractId/rpcUrl/network.id change (#1550) — so switching networks
    // re-syncs against the new one instead of the closure this effect
    // captured on mount.
  }, [loadFromCache, syncWithNetwork]);

  // Subscribe to feed updates (e.g. from optimistic creation or sync confirmation)
  useEffect(() => {
    return subscribeToFeedUpdates(async () => {
      const limit = Math.max(PAGE_SIZE, postsLengthRef.current);
      const cached = await getCachedPosts(limit, 0);
      applyPosts(cached);
    });
  }, [applyPosts]);

  const loadMore = useCallback(() => {
    if (!loadingRef.current && hasMoreRef.current && loadedPostsRef.current > 0) {
      void syncWithNetwork("more");
    }
  }, [syncWithNetwork]);

  const refresh = useCallback(() => {
    void syncWithNetwork("refresh");
  }, [syncWithNetwork]);

  return {
    posts,
    loading,
    refreshing,
    loadingMore,
    error,
    loadMoreError,
    hasMore,
    loadMore,
    refresh,
  };
}
