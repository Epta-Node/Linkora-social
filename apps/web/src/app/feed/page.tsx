"use client";

/**
 * /feed — main feed page with "For You" and "Following" tabs.
 *
 * Fix for issue #1580:
 *  - Removed the broken Server Component shell that referenced undeclared
 *    identifiers (followingRes, allFetchedPosts) and non-existent modules
 *    (@/lib/auth, @/lib/persist, @/lib/posts, @/lib/following, @/constants,
 *    @/config.indexerUrl).
 *  - Replaced with a client component that owns both feed tabs and performs
 *    the fan-out fetch correctly (Promise.all awaited and consumed).
 *  - setPosts / persistFeed called exactly once per successful fetch.
 *  - Cursor is kept independently per tab so switching tabs does not reset
 *    the other tab's pagination state.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useWallet } from "@/hooks/useWallet";
import { PostCard, type Post } from "@/components/PostCard";
import { PostCardSkeleton } from "@/components/PostCard";

const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:3001";
const PAGE_SIZE = 20;

type FeedTab = "for-you" | "following";

interface FeedState {
  posts: Post[];
  cursor: string | null;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
}

const EMPTY_FEED: FeedState = {
  posts: [],
  cursor: null,
  hasMore: true,
  loading: false,
  error: null,
};

// ---------------------------------------------------------------------------
// Data-fetching helpers
// ---------------------------------------------------------------------------

/** Fetch the global / "For You" feed from the indexer. */
async function fetchForYouPage(cursor: string | null): Promise<{
  posts: Post[];
  nextCursor: string | null;
}> {
  const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
  const res = await fetch(
    `${INDEXER_URL}/api/posts?limit=${PAGE_SIZE}${cursorQuery}`
  );
  if (!res.ok) throw new Error(`Indexer returned ${res.status}`);
  const data = await res.json();
  const posts: Post[] = data.posts ?? [];
  return { posts, nextCursor: data.cursor ?? null };
}

/**
 * Fetch the Following feed for a given user address.
 *
 * Strategy:
 *  1. Fetch the user's following list (paginated by cursor).
 *  2. Fan out one GET /api/posts?author=<addr> per followee in parallel.
 *  3. Merge, sort by timestamp desc, return the first PAGE_SIZE entries.
 */
async function fetchFollowingPage(
  userAddress: string,
  cursor: string | null
): Promise<{ posts: Post[]; nextCursor: string | null }> {
  const cursorQuery = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
  const followingRes = await fetch(
    `${INDEXER_URL}/api/feed/following/${userAddress}?limit=${PAGE_SIZE}${cursorQuery}`
  );
  if (!followingRes.ok) throw new Error("Failed to fetch following list");
  const followingData = await followingRes.json();
  const followingList: string[] = followingData.following ?? [];
  const nextCursor: string | null = followingData.cursor ?? null;

  if (followingList.length === 0) {
    return { posts: [], nextCursor: null };
  }

  // Fan out in parallel — await the full array.
  const postsArrays = await Promise.all(
    followingList.map(async (addr) => {
      const postsRes = await fetch(
        `${INDEXER_URL}/api/posts?author=${encodeURIComponent(addr)}&limit=${PAGE_SIZE}`
      );
      if (!postsRes.ok) return [] as Post[];
      const data = await postsRes.json();
      return (data.posts ?? []) as Post[];
    })
  );

  const allPosts = postsArrays
    .flat()
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
    .slice(0, PAGE_SIZE);

  return { posts: allPosts, nextCursor };
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function FeedPage() {
  const { address: userAddress } = useWallet();
  const [activeTab, setActiveTab] = useState<FeedTab>("for-you");

  const [forYouState, setForYouState] = useState<FeedState>(EMPTY_FEED);
  const [followingState, setFollowingState] = useState<FeedState>(EMPTY_FEED);

  // Track which tabs have been loaded at least once.
  const loadedTabs = useRef<Set<FeedTab>>(new Set());

  const loadFeed = useCallback(
    async (tab: FeedTab, append = false) => {
      const setState =
        tab === "for-you" ? setForYouState : setFollowingState;
      const currentState =
        tab === "for-you" ? forYouState : followingState;

      if (tab === "following" && !userAddress) {
        setState((prev) => ({
          ...prev,
          error: "Connect your wallet to see your Following feed.",
          loading: false,
        }));
        return;
      }

      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const cursor = append ? currentState.cursor : null;
        const { posts: fetched, nextCursor } =
          tab === "for-you"
            ? await fetchForYouPage(cursor)
            : await fetchFollowingPage(userAddress!, cursor);

        // Exactly one setPosts call per fetch.
        setState((prev) => ({
          posts: append ? [...prev.posts, ...fetched] : fetched,
          cursor: nextCursor,
          hasMore: fetched.length === PAGE_SIZE,
          loading: false,
          error: null,
        }));
      } catch (err) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error:
            err instanceof Error
              ? err.message
              : "Failed to load feed. Please try again.",
        }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [userAddress, forYouState.cursor, followingState.cursor]
  );

  // Load "For You" on mount.
  useEffect(() => {
    if (!loadedTabs.current.has("for-you")) {
      loadedTabs.current.add("for-you");
      loadFeed("for-you");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load "Following" the first time the user switches to that tab.
  useEffect(() => {
    if (activeTab === "following" && !loadedTabs.current.has("following")) {
      loadedTabs.current.add("following");
      loadFeed("following");
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTabChange = (tab: FeedTab) => {
    setActiveTab(tab);
  };

  const state = activeTab === "for-you" ? forYouState : followingState;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      {/* Tab switcher */}
      <div
        role="tablist"
        aria-label="Feed tabs"
        className="mb-6 flex border-b border-[var(--border)]"
      >
        {(["for-you", "following"] as FeedTab[]).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`tabpanel-${tab}`}
            id={`tab-${tab}`}
            onClick={() => handleTabChange(tab)}
            className={[
              "px-5 py-2.5 text-sm font-semibold capitalize transition-colors",
              "border-b-2 -mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
              activeTab === tab
                ? "border-violet-500 text-violet-400"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--foreground)]",
            ].join(" ")}
            data-testid={`tab-${tab}`}
          >
            {tab === "for-you" ? "For You" : "Following"}
          </button>
        ))}
      </div>

      {/* Tab panel */}
      <section
        role="tabpanel"
        id={`tabpanel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
        data-testid={`tabpanel-${activeTab}`}
      >
        {state.error && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400"
            data-testid="feed-error"
          >
            {state.error}
          </div>
        )}

        {state.loading && state.posts.length === 0 ? (
          <div data-testid="loading-indicator" className="space-y-4">
            <PostCardSkeleton />
            <PostCardSkeleton />
            <PostCardSkeleton />
          </div>
        ) : state.posts.length === 0 && !state.loading ? (
          <div
            className="py-16 text-center text-[var(--text-muted)]"
            data-testid="empty-feed"
          >
            {activeTab === "following"
              ? "Follow some accounts to see their posts here."
              : "No posts yet. Be the first to share something!"}
          </div>
        ) : (
          <div className="space-y-4" data-testid="post-list">
            {state.posts.map((post) => (
              <PostCard key={post.id} post={post} data-testid="post-card" />
            ))}

            {state.loading && (
              <div data-testid="loading-more" className="space-y-4">
                <PostCardSkeleton />
              </div>
            )}

            {state.hasMore && !state.loading && (
              <div className="flex justify-center pt-4">
                <button
                  onClick={() => loadFeed(activeTab, true)}
                  className="rounded-lg border border-[var(--border)] bg-[var(--muted)] px-6 py-2 text-sm font-medium text-[var(--foreground)] hover:border-violet-500/50 transition-colors"
                  data-testid="load-more"
                >
                  Load more
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
