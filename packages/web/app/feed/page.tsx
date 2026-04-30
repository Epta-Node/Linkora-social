"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Feed } from "../components/Feed";
import { Post } from "../components/PostCard";
import { CreatePost } from "../components/CreatePost";
import { useFollowingFeed } from "../hooks/useFollowingFeed";

export default function FeedPage() {
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [likedPosts, setLikedPosts] = useState<Set<number>>(new Set());
  const { posts, loading, error, hasMore, loadMore } = useFollowingFeed(walletAddress);

  useEffect(() => {
    // Check for wallet connection
    const checkWallet = async () => {
      try {
        // @ts-ignore - Freighter API
        if (window.freighter) {
          // @ts-ignore
          const address = await window.freighter.getPublicKey();
          setWalletAddress(address);
        }
      } catch (err) {
        console.error("Failed to connect wallet:", err);
      }
    };

    checkWallet();
  }, []);

  const handleLike = async (postId: number) => {
    setLikedPosts((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });

    // TODO: Call contract to like post
  };

  const handleTip = async (postId: number) => {
    // TODO: Call contract to tip post
    alert(`Tip functionality for post ${postId} - Connect wallet to tip`);
  };

  const handleConnectWallet = async () => {
    try {
      // @ts-ignore - Freighter API
      if (window.freighter) {
        // @ts-ignore
        const address = await window.freighter.getPublicKey();
        setWalletAddress(address);
      }
    } catch (err) {
      console.error("Failed to connect wallet:", err);
    }
  };

  // Wallet connection required
  if (!walletAddress) {
    return (
      <main style={styles.main}>
        <div style={styles.connectWalletContainer}>
          <div style={styles.connectWalletCard}>
            <h2 style={styles.connectTitle}>Connect Your Wallet</h2>
            <p style={styles.connectText}>
              Connect your Freighter wallet to view posts from accounts you follow
            </p>
            <button
              onClick={handleConnectWallet}
              style={styles.connectButton}
            >
              Connect Wallet
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <h1 style={styles.title}>Following Feed</h1>
        <Link href="/new" style={styles.newPostButton}>
          + New Post
        </Link>
      </header>
      
      <div style={styles.content}>
        {/* Inline post composer */}
        <div style={styles.composerSection}>
          <CreatePost compact />
        </div>
        
        {error && (
          <div style={styles.error}>
            {error}
            <button onClick={() => window.location.reload()} style={styles.retryButton}>
              Retry
            </button>
          </div>
        )}
        
        <Feed
          posts={posts}
          loading={loading}
          onLike={handleLike}
          onTip={handleTip}
          likedPosts={likedPosts}
        />

        {hasMore && posts.length > 0 && !loading && (
          <div style={styles.loadMoreContainer}>
            <button onClick={loadMore} style={styles.loadMoreButton}>
              Load More
            </button>
          </div>
        )}

        {posts.length === 0 && !loading && !error && (
          <div style={styles.emptyState}>
            <div style={styles.emptyIcon}>👥</div>
            <h3 style={styles.emptyTitle}>No posts yet</h3>
            <p style={styles.emptyText}>
              Follow some accounts to see their posts here
            </p>
          </div>
        )}
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: "100vh",
    background: "var(--color-bg-secondary)",
  },
  header: {
    background: "var(--color-bg)",
    borderBottom: "1px solid var(--color-border)",
    padding: "var(--spacing-md) var(--spacing-lg)",
    position: "sticky",
    top: 0,
    zIndex: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: "1.25rem",
    fontWeight: 700,
    margin: 0,
  },
  newPostButton: {
    padding: "var(--spacing-sm) var(--spacing-md)",
    background: "var(--color-primary)",
    color: "white",
    borderRadius: "20px",
    fontSize: "0.9rem",
    fontWeight: 600,
    textDecoration: "none",
  },
  content: {
    maxWidth: "600px",
    margin: "0 auto",
    padding: "var(--spacing-md)",
  },
  composerSection: {
    marginBottom: "var(--spacing-md)",
  },
  connectWalletContainer: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "var(--spacing-lg)",
  },
  connectWalletCard: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "16px",
    padding: "var(--spacing-xl)",
    textAlign: "center",
    maxWidth: "400px",
  },
  connectTitle: {
    fontSize: "1.5rem",
    fontWeight: 700,
    margin: "0 0 var(--spacing-md) 0",
    color: "var(--color-text)",
  },
  connectText: {
    fontSize: "1rem",
    color: "var(--color-text-secondary)",
    margin: "0 0 var(--spacing-lg) 0",
  },
  connectButton: {
    padding: "var(--spacing-md) var(--spacing-xl)",
    background: "var(--color-primary)",
    color: "white",
    border: "none",
    borderRadius: "8px",
    fontSize: "1rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  error: {
    background: "var(--color-error-bg)",
    border: "1px solid var(--color-error)",
    color: "var(--color-error)",
    padding: "var(--spacing-md)",
    borderRadius: "8px",
    marginBottom: "var(--spacing-md)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  retryButton: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    padding: "var(--spacing-sm) var(--spacing-md)",
    borderRadius: "4px",
    cursor: "pointer",
  },
  loadMoreContainer: {
    textAlign: "center",
    marginTop: "var(--spacing-lg)",
  },
  loadMoreButton: {
    padding: "var(--spacing-md) var(--spacing-xl)",
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "8px",
    cursor: "pointer",
    fontSize: "1rem",
  },
  emptyState: {
    textAlign: "center",
    padding: "var(--spacing-xl)",
    color: "var(--color-text-secondary)",
  },
  emptyIcon: {
    fontSize: "3rem",
    marginBottom: "var(--spacing-md)",
  },
  emptyTitle: {
    fontSize: "1.25rem",
    fontWeight: 600,
    margin: "0 0 var(--spacing-sm) 0",
  },
  emptyText: {
    margin: 0,
  },
};
