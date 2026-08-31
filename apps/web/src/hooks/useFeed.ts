"use client";

import { useState, useEffect, useCallback } from "react";
import { Post } from "@/components/PostCard";

const PAGE_SIZE = 10;

// Replace with real contract SDK call when available.
async function fetchPostPage(offset: number, limit: number): Promise<Post[]> {
  // Mock data standing in for get_post() contract calls.
  const all: Post[] = [
    {
      id: 1,
      author: "GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      username: "stellar_dev",
      content: "Just deployed my first smart contract on Stellar! 🚀",
      tip_total: 100,
      timestamp: Math.floor(Date.now() / 1000) - 3600,
      like_count: 5,
    },
    {
      id: 2,
      author: "GXYZ9876543210ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      username: "crypto_enthusiast",
      content: "The SocialFi ecosystem is growing fast. Excited to be part of it!",
      tip_total: 50,
      timestamp: Math.floor(Date.now() / 1000) - 7200,
      like_count: 3,
    },
    {
      id: 3,
      author: "GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      username: "stellar_dev",
      content: "Working on a new DeFi protocol. Stay tuned! 🔥",
      tip_total: 200,
      timestamp: Math.floor(Date.now() / 1000) - 14400,
      like_count: 12,
    },
  ];
  return all.slice(offset, offset + limit);
}

export function useFeed() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(async (pageIndex: number) => {
    setLoading(true);
    setError(null);
    try {
      const offset = pageIndex * PAGE_SIZE;
      const fetched = await fetchPostPage(offset, PAGE_SIZE);
      setPosts((prev) => (pageIndex === 0 ? fetched : [...prev, ...fetched]));
      setHasMore(fetched.length >= PAGE_SIZE);
    } catch {
      setError("Failed to load posts. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(0);
  }, [load]);

  useEffect(() => {
    if (page > 0) {
      load(page);
    }
  }, [page, load]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      setPage((p) => p + 1);
    }
  }, [loading, hasMore]);

  const refresh = useCallback(() => {
    setPage(0);
    load(0);
  }, [load]);

  return { posts, loading, error, hasMore, loadMore, refresh };
}
