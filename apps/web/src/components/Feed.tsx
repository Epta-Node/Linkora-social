"use client";

import { PostCard, Post } from "./PostCard";

interface FeedProps {
  posts: Post[];
  loading?: boolean;
  onLike?: (postId: number) => void;
  onTip?: (postId: number) => void;
  likedPosts?: Set<number>;
}

export function Feed({ posts, loading, onLike, onTip, likedPosts = new Set() }: FeedProps) {
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
      {posts.map((post) => (
        <div key={post.id} style={styles.postWrap}>
          <PostCard post={post} />
          {(onLike || onTip) && (
            <div style={styles.actions}>
              {onLike && (
                <button
                  type="button"
                  style={styles.actionButton}
                  onClick={() => onLike(Number(post.id))}
                >
                  {likedPosts.has(Number(post.id)) ? "Liked" : "Like"}
                </button>
              )}
              {onTip && (
                <button
                  type="button"
                  style={styles.actionButton}
                  onClick={() => onTip(Number(post.id))}
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
