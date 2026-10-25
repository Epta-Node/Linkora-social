"use client";

/**
 * Paginated feed list for one tab (issue #1724).
 *
 * Kept separate from `FeedStream` so the pagination UI can be unit-tested
 * without the `use()` suspension boundary: `FeedStream` streams the first page
 * and hands this component the resolved snapshot.
 *
 * Behaviour:
 *  - continues from the streamed snapshot's cursor through `useInfiniteFeed`,
 *    seeded with the first page so it is never fetched twice;
 *  - IntersectionObserver-driven infinite scroll, with a manual "Load more"
 *    fallback for slow connections and browsers without the observer;
 *  - skeletons that reserve their layout slot, so appending a page does not
 *    shift the posts above it (CLS);
 *  - polite aria-live announcements for the pages that get appended; the
 *    initial page is never announced.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { InfiniteScroll } from "@/components/InfiniteScroll";
import { PostCardSkeleton, type Post } from "@/components/PostCard";
import { OptimisticPostCard } from "@/components/feed/OptimisticPostCard";
import { isAboveTheFold } from "@/lib/responsiveImage";
import { useInfiniteFeed, type CursorPage } from "@/hooks/useInfiniteFeed";
import { useSlowConnection } from "@/hooks/useSlowConnection";
import { fetchFeedSnapshot, type FeedSnapshot, type FeedTab } from "@/services/feed";

export const EMPTY_MESSAGE: Record<FeedTab, string> = {
  "for-you": "No posts yet. Be the first to share something!",
  following: "Follow some accounts to see their posts here.",
};

const ERROR_CLASS =
  "mb-4 rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400";

// Stable identity function so page de-duplication does not re-run needlessly.
const getPostId = (post: Post) => post.id;

/** Skeleton shown while a tab streams in or its first page is pending. */
export function FeedSkeleton() {
  return (
    <div data-testid="loading-indicator" className="space-y-4">
      <PostCardSkeleton />
      <PostCardSkeleton />
      <PostCardSkeleton />
    </div>
  );
}

export interface FeedListProps {
  tab: FeedTab;
  address: string | null;
  /** First page, already loaded by `FeedStream`. */
  initial: FeedSnapshot;
}

export function FeedList({ tab, address, initial }: FeedListProps) {
  const isSlowConnection = useSlowConnection();

  // Continue from the streamed page instead of requesting it a second time.
  const initialPage = useMemo<CursorPage<Post>>(
    () => ({
      items: initial.posts,
      nextCursor: initial.hasMore ? initial.cursor : null,
    }),
    [initial]
  );

  const queryFn = useCallback(
    async (cursor: string | null): Promise<CursorPage<Post>> => {
      const snapshot = await fetchFeedSnapshot(tab, address, { cursor });

      // `fetchFeedSnapshot` encodes failures in the snapshot rather than
      // rejecting, but the hook needs a rejection to offer an inline retry.
      if (snapshot.error) throw new Error(snapshot.error);

      return {
        items: snapshot.posts,
        nextCursor: snapshot.hasMore ? snapshot.cursor : null,
      };
    },
    [tab, address]
  );

  const { items, hasNextPage, isFetchingNextPage, isError, error, fetchNextPage, retry } =
    useInfiniteFeed<Post>({
      queryKey: ["feed", tab, address ?? "anonymous"],
      queryFn,
      initialPage,
      getItemId: getPostId,
    });

  // Posts removed optimistically (awaiting the delete request). They stay
  // hidden on success and are removed from this set on failure, which makes
  // them reappear in place.
  const [deletedIds, setDeletedIds] = useState<Array<string | number>>([]);

  const handleOptimisticDelete = useCallback((postId: string | number) => {
    setDeletedIds((previous) => [...previous, postId]);
  }, []);

  const handleDeleteFailed = useCallback((postId: string | number) => {
    setDeletedIds((previous) => previous.filter((id) => String(id) !== String(postId)));
  }, []);

  const visibleItems = useMemo(
    () => items.filter((post) => !deletedIds.some((id) => String(id) === String(post.id))),
    [deletedIds, items]
  );

  // Item count before the in-flight "next page" request; null when idle.
  const announceBaselineRef = useRef<number | null>(null);
  // Announced by a visually hidden aria-live region after a page is appended.
  const [announcement, setAnnouncement] = useState("");

  const handleLoadMore = useCallback(() => {
    if (isFetchingNextPage || !hasNextPage || isError) return;

    announceBaselineRef.current = items.length;
    fetchNextPage();
  }, [fetchNextPage, hasNextPage, isError, isFetchingNextPage, items.length]);

  const handleRetry = useCallback(() => {
    if (isFetchingNextPage) return;

    announceBaselineRef.current = items.length;
    retry();
  }, [isFetchingNextPage, items.length, retry]);

  // Announce only appended pages: never the initial page, never a page twice,
  // and not a failed request (the inline retry describes the failure itself).
  useEffect(() => {
    const baseline = announceBaselineRef.current;
    if (baseline === null || isFetchingNextPage) return;

    announceBaselineRef.current = null;

    if (isError || items.length <= baseline) return;
    const added = items.length - baseline;
    setAnnouncement(`${added} more ${added === 1 ? "post" : "posts"} loaded`);
  }, [isError, isFetchingNextPage, items.length]);

  // Only reachable during the server prerender pass (see getFeedSnapshotPromise).
  if (initial.pending) return <FeedSkeleton />;

  const errorMessage =
    initial.error ??
    (isError ? (error?.message ?? "Failed to load feed. Please try again.") : null);

  if (errorMessage && items.length === 0) {
    return (
      <div role="alert" className={ERROR_CLASS} data-testid="feed-error">
        {errorMessage}
      </div>
    );
  }

  if (visibleItems.length === 0 && !isFetchingNextPage) {
    return (
      <div className="py-16 text-center text-[var(--text-muted)]" data-testid="empty-feed">
        {EMPTY_MESSAGE[tab]}
      </div>
    );
  }

  return (
    <>
      {/*
        Visually hidden live region. The initial page is never announced; only
        appended pages write text here.
      */}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="feed-announcer"
      >
        {announcement}
      </div>

      <div className="space-y-4" data-testid="post-list">
        {visibleItems.map((post, index) => (
          <OptimisticPostCard
            key={post.id}
            post={post}
            currentUser={address}
            onOptimisticDelete={handleOptimisticDelete}
            onDeleteFailed={handleDeleteFailed}
            priority={isAboveTheFold(index)}
            data-testid="post-card"
          />
        ))}

        <InfiniteScroll
          key="infinite-scroll"
          onLoadMore={handleLoadMore}
          onRetry={handleRetry}
          hasMore={hasNextPage}
          isLoading={isFetchingNextPage}
          manual={isSlowConnection}
          error={isError}
          skeleton={<PostCardSkeleton />}
        />
      </div>
    </>
  );
}
