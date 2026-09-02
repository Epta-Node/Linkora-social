"use client";

import { useEffect, useState } from "react";
import { PostCard, Post } from "./PostCard";
import { fetchIsPaused } from "../lib/api";
import { OptimisticStore } from "../lib/optimisticStore";

/** How often to re-check the contract's pause status while the feed is mounted. */
const PAUSE_POLL_INTERVAL_MS = 30_000;

interface FeedProps {
  posts: Post[];
  loading?: boolean;
  onLike?: (postId: number) => void;
  onTip?: (postId: number) => void;
  likedPosts?: Set<number>;
}

export function Feed({ posts, loading, onLike, onTip, likedPosts = new Set() }: FeedProps) {
  // Fetch on bootstrap and keep polling so the banner reflects pause/unpause
  // without requiring a page reload.
  const [paused, setPaused] = useState(false);

  // Post ids with an optimistic like/follow transaction currently in flight.
  // Used to show transient "pending" styling that is cleared on rollback or
  // once the optimistic write settles.
  const [pendingLikes, setPendingLikes] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      const isPaused = await fetchIsPaused();
      if (!cancelled) setPaused(isPaused);
    };

    check();
    const interval = setInterval(check, PAUSE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Clear transient "pending" styling for the affected post when an optimistic
  // like/follow write is rolled back after a failed transaction.
  useEffect(() => {
    const unsubscribe = OptimisticStore.onRolledBack((event) => {
      if (event.kind !== "like" && event.kind !== "follow") return;
      // Like/follow keys are `${userAddress}:${postId}`.
      const postId = Number(event.key.split(":").pop());
      if (Number.isNaN(postId)) return;
      setPendingLikes((prev) => {
        if (!prev.has(postId)) return prev;
        const next = new Set(prev);
        next.delete(postId);
        return next;
      });
    });
    return unsubscribe;
  }, []);

  const beginOptimisticWrite = (postId: number) => {
    setPendingLikes((prev) => {
      const next = new Set(prev);
      next.add(postId);
      return next;
    });
  };

  // Re-check immediately before submitting a write, to catch the contract
  // being paused between polls (race condition), and only proceed if clear.
  const guardedWrite = async (action: (postId: number) => void, postId: number) => {
    const isPaused = await fetchIsPaused();
    setPaused(isPaused);
    if (isPaused) return;
    beginOptimisticWrite(postId);
    action(postId);
  };

  if (loading) {
    return (
      <div style={styles.container}>
        {[1, 2, 3].map((i) => (
          <div key={i} style={styles.skeleton}></div>
        ))}
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <div style={styles.empty}>
        <div style={styles.emptyIcon}>📝</div>
        <h3>No posts yet</h3>
        <p style={styles.emptyText}>Be the first to share something!</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {paused && (
        <div style={styles.pausedBanner} role="alert">
          Linkora is temporarily paused. Writes are disabled until the protocol resumes.
        </div>
      )}
      {posts.map((post) => (
        <div key={post.id} style={styles.postWrap}>
          <PostCard post={post} />
          {(onLike || onTip) && (
            <div style={styles.actions}>
              {onLike && (
                <button
                  type="button"
                  style={{
                    ...styles.actionButton,
                    ...(paused ? styles.actionButtonDisabled : {}),
                    ...(pendingLikes.has(Number(post.id)) ? styles.actionButtonPending : {}),
                  }}
                  disabled={paused}
                  onClick={() => guardedWrite(() => onLike(Number(post.id)), Number(post.id))}
                >
                  {pendingLikes.has(Number(post.id))
                    ? "Liking..."
                    : likedPosts.has(Number(post.id))
                      ? "Liked"
                      : "Like"}
                </button>
              )}
              {onTip && (
                <button
                  type="button"
                  style={{ ...styles.actionButton, ...(paused ? styles.actionButtonDisabled : {}) }}
                  disabled={paused}
                  onClick={() => guardedWrite(() => onTip(Number(post.id)), Number(post.id))}
                >
                  Tip
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: "600px",
    width: "100%",
    margin: "0 auto",
    padding: "var(--spacing-md)",
  },
  skeleton: {
    height: "200px",
    background: "var(--color-bg-secondary)",
    borderRadius: "12px",
    marginBottom: "var(--spacing-md)",
    animation: "pulse 1.5s ease-in-out infinite",
  },
  postWrap: {
    marginBottom: "var(--spacing-md)",
  },
  pausedBanner: {
    background: "var(--color-warning-bg, #fff3cd)",
    color: "var(--color-warning-text, #664d03)",
    border: "1px solid var(--color-warning-border, #ffe69c)",
    borderRadius: "8px",
    padding: "var(--spacing-sm) var(--spacing-md)",
    marginBottom: "var(--spacing-md)",
    fontSize: "0.9rem",
  },
  actions: {
    display: "flex",
    gap: "var(--spacing-sm)",
    padding: "var(--spacing-sm) 0",
  },
  actionButton: {
    border: "1px solid var(--border)",
    borderRadius: "8px",
    background: "var(--muted)",
    color: "var(--foreground)",
    padding: "8px 12px",
    cursor: "pointer",
  },
  actionButtonDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  actionButtonPending: {
    opacity: 0.7,
    cursor: "progress",
    animation: "pulse 1.5s ease-in-out infinite",
  },
  empty: {
    textAlign: "center",
    padding: "var(--spacing-xl)",
    color: "var(--color-text-secondary)",
  },
  emptyIcon: {
    fontSize: "3rem",
    marginBottom: "var(--spacing-md)",
  },
  emptyText: {
    marginTop: "var(--spacing-sm)",
  },
};
