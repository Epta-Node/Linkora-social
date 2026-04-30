"use client";

import { useState, useEffect, useCallback } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Post {
  id: number;
  author: string;
  username?: string;
  content: string;
  tip_total: number;
  timestamp: number;
  like_count: number;
}

// ── Mock contract calls ───────────────────────────────────────────────────────
// Replace with real SDK calls once the generated client is available.

async function getFollowing(
  userAddress: string,
  offset: number,
  limit: number
): Promise<string[]> {
  // TODO: Replace with actual contract call using SDK
  // For now, return mock data
  const allFollowing = [
    "GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    "GXYZ9876543210ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  ];
  return allFollowing.slice(offset, offset + limit);
}

async function getPostsByAuthor(
  authorAddress: string,
  offset: number,
  limit: number
): Promise<number[]> {
  // TODO: Replace with actual contract call using SDK
  // For now, return mock post IDs
  const mockPosts: Post[] = [
    {
      id: 1,
      author: "GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      username: "stellar_dev",
      content: "Just deployed my first smart contract on Stellar! 🚀",
      tip_total: 100,
      timestamp: Date.now() / 1000 - 3600,
      like_count: 5,
    },
    {
      id: 2,
      author: "GXYZ9876543210ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      username: "crypto_enthusiast",
      content: "The SocialFi ecosystem is growing fast. Excited to be part of it!",
      tip_total: 50,
      timestamp: Date.now() / 1000 - 7200,
      like_count: 3,
    },
    {
      id: 3,
      author: "GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      username: "stellar_dev",
      content: "Working on a new DeFi protocol. Stay tuned! 🔥",
      tip_total: 200,
      timestamp: Date.now() / 1000 - 14400,
      like_count: 12,
    },
  ];
  return mockPosts
    .filter((p) => p.author === authorAddress)
    .map((p) => p.id)
    .slice(offset, offset + limit);
}

async function getPost(postId: number): Promise<Post | null> {
  // TODO: Replace with actual contract call using SDK
  const mockPosts: Post[] = [
    {
      id: 1,
      author: "GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      username: "stellar_dev",
      content: "Just deployed my first smart contract on Stellar! 🚀",
      tip_total: 100,
      timestamp: Date.now() / 1000 - 3600,
      like_count: 5,
    },
    {
      id: 2,
      author: "GXYZ9876543210ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      username: "crypto_enthusiast",
      content: "The SocialFi ecosystem is growing fast. Excited to be part of it!",
      tip_total: 50,
      timestamp: Date.now() / 1000 - 7200,
      like_count: 3,
    },
    {
      id: 3,
      author: "GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      username: "stellar_dev",
      content: "Working on a new DeFi protocol. Stay tuned! 🔥",
      tip_total: 200,
      timestamp: Date.now() / 1000 - 14400,
      like_count: 12,
    },
  ];
  return mockPosts.find((p) => p.id === postId) || null;
}

async function getProfile(userAddress: string): Promise<{ username: string } | null> {
  // TODO: Replace with actual contract call using SDK
  const mockProfiles: Map<string, { username: string }> = new Map([
    [
      "GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      { username: "stellar_dev" },
    ],
    [
      "GXYZ9876543210ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      { username: "crypto_enthusiast" },
    ],
  ]);
  return mockProfiles.get(userAddress) || null;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useFollowingFeed(walletAddress: string | null) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const loadFeed = useCallback(async () => {
    if (!walletAddress) return;

    try {
      setLoading(true);
      const offset = page * 10;
      const limit = 10;

      // Get list of followed accounts
      const following = await getFollowing(walletAddress, offset, limit);

      if (following.length === 0 && page === 0) {
        setPosts([]);
        setHasMore(false);
        setLoading(false);
        return;
      }

      // Fetch posts from each followed account
      const allPosts: Post[] = [];
      for (const author of following) {
        const postIds = await getPostsByAuthor(author, 0, 10);
        for (const postId of postIds) {
          const post = await getPost(postId);
          if (post) {
            const profile = await getProfile(author);
            allPosts.push({ ...post, username: profile?.username });
          }
        }
      }

      // Sort by timestamp descending
      allPosts.sort((a, b) => b.timestamp - a.timestamp);

      if (page === 0) {
        setPosts(allPosts);
      } else {
        setPosts((prev) => [...prev, ...allPosts]);
      }

      setHasMore(following.length >= limit);
    } catch (err) {
      setError("Failed to load feed");
    } finally {
      setLoading(false);
    }
  }, [walletAddress, page]);

  useEffect(() => {
    if (walletAddress) {
      loadFeed();
    } else {
      setPosts([]);
      setLoading(false);
    }
  }, [walletAddress, loadFeed]);

  const loadMore = useCallback(() => {
    setPage((prev) => prev + 1);
  }, []);

  return {
    posts,
    loading,
    error,
    hasMore,
    loadMore,
    refresh: loadFeed,
  };
}
