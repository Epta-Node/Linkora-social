import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PostRepository } from "../db/PostRepository";
import type { PendingPost, PostRecord } from "../db/types";
import { FeedSyncService } from "../sync/feedSync";
import {
  createOptimisticPost,
  reconcilePendingPosts,
  retryPendingPost,
} from "../sync/optimisticPost";
import type { IndexerClient, SubmitPost } from "../sync/types";

const PAGE_SIZE = 20;

/** A feed row: either a confirmed post or a locally-pending one. */
export type OfflineFeedItem =
  | { kind: "confirmed"; post: PostRecord }
  | { kind: "pending"; post: PendingPost };

export interface UseOfflineFeedReturn {
  items: OfflineFeedItem[];
  loading: boolean;
  syncing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  hasMore: boolean;
  createPost: (content: string) => Promise<void>;
  retryPost: (localId: string) => Promise<void>;
}

export interface UseOfflineFeedParams {
  repo: PostRepository;
  sync: FeedSyncService;
  indexer?: IndexerClient;
  submit: SubmitPost;
  author: string;
}

/**
 * Drives the Feed screen from the local cache first, then keeps it fresh.
 *
 * On mount it renders confirmed + pending posts straight from SQLite (instant
 * cold start), reconciles any stale pending posts against the indexer, then
 * runs a background sync. New posts are created optimistically.
 */
export function useOfflineFeed({
  repo,
  sync,
  submit,
  author,
}: UseOfflineFeedParams): UseOfflineFeedReturn {
  const [confirmed, setConfirmed] = useState<PostRecord[]>([]);
  const [pending, setPending] = useState<PendingPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const offsetRef = useRef(0);

  const reloadFromCache = useCallback(async () => {
    const [page, pendingPosts] = await Promise.all([repo.getPage(0, PAGE_SIZE), repo.getPending()]);
    offsetRef.current = page.length;
    setConfirmed(page);
    setPending(pendingPosts);
    setHasMore(page.length >= PAGE_SIZE);
  }, [repo]);

  // Subscribe to sync lifecycle events.
  useEffect(() => {
    const offStart = sync.events.on("syncStarted", () => setSyncing(true));
    const offDone = sync.events.on("syncCompleted", () => {
      setSyncing(false);
      void reloadFromCache();
    });
    const offFail = sync.events.on("syncFailed", (p) => {
      setSyncing(false);
      setError(p.error);
    });
    return () => {
      offStart();
      offDone();
      offFail();
    };
  }, [sync, reloadFromCache]);

  // Cold start: cache first, then reconcile + background sync.
  useEffect(() => {
    let active = true;
    (async () => {
      await reloadFromCache();
      if (!active) return;
      setLoading(false);
      await reconcilePendingPosts(repo, author);
      if (!active) return;
      await reloadFromCache();
      void sync.syncNow();
    })();
    return () => {
      active = false;
    };
  }, [repo, sync, author, reloadFromCache]);

  const refresh = useCallback(async () => {
    setError(null);
    await sync.syncNow();
    await reloadFromCache();
  }, [sync, reloadFromCache]);

  const loadMore = useCallback(async () => {
    if (!hasMore) return;
    const next = await repo.getPage(offsetRef.current, PAGE_SIZE);
    offsetRef.current += next.length;
    setConfirmed((prev) => [...prev, ...next]);
    setHasMore(next.length >= PAGE_SIZE);
  }, [repo, hasMore]);

  const createPost = useCallback(
    async (content: string) => {
      const { settled } = await createOptimisticPost(repo, submit, author, content);
      setPending(await repo.getPending());
      void settled.then(async () => {
        setPending(await repo.getPending());
        await reloadFromCache();
      });
    },
    [repo, submit, author, reloadFromCache]
  );

  const retryPost = useCallback(
    async (localId: string) => {
      await retryPendingPost(repo, submit, author, localId);
      setPending(await repo.getPending());
      await reloadFromCache();
    },
    [repo, submit, author, reloadFromCache]
  );

  const items = useMemo<OfflineFeedItem[]>(
    () => [
      ...pending.map((post) => ({ kind: "pending" as const, post })),
      ...confirmed.map((post) => ({ kind: "confirmed" as const, post })),
    ],
    [pending, confirmed]
  );

  return {
    items,
    loading,
    syncing,
    error,
    refresh,
    loadMore,
    hasMore,
    createPost,
    retryPost,
  };
}
