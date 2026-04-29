"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Feed } from "../components/Feed";
import { Post } from "../components/PostCard";
import { CreatePost } from "../components/CreatePost";

export default function FeedPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [likedPosts, setLikedPosts] = useState<Set<number>>(new Set());

  useEffect(() => {
    // Mock data for demonstration
    setTimeout(() => {
      setPosts([
        {
          id: 1,
          author: "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
          username: "alice",
          content: "Just deployed my first Soroban smart contract! 🚀",
          tip_total: 50000000,
          timestamp: Date.now() / 1000 - 3600,
          like_count: 12,
        },
        {
          id: 2,
          author: "GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
          username: "bob",
          content:
            "Building on Stellar is amazing. The speed and low fees make it perfect for social apps.",
          tip_total: 25000000,
          timestamp: Date.now() / 1000 - 7200,
          like_count: 8,
        },
      ]);
      setLoading(false);
    }, 500);
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

    setPosts((prev) =>
      prev.map((post) =>
        post.id === postId
          ? {
              ...post,
              like_count: post.like_count + (likedPosts.has(postId) ? -1 : 1),
            }
          : post,
      ),
    );
  };

  const handleTip = async (postId: number) => {
    alert(`Tip functionality for post ${postId} - Connect wallet to tip`);
  };

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <h1 style={styles.title}>Linkora Feed</h1>
        <Link href="/new" style={styles.newPostButton}>
          + New Post
        </Link>
      </header>
      
      <div style={styles.content}>
        {/* Inline post composer */}
        <div style={styles.composerSection}>
          <CreatePost compact />
        </div>
        
        <Feed
          posts={posts}
          loading={loading}
          onLike={handleLike}
          onTip={handleTip}
          likedPosts={likedPosts}
        />
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
};
