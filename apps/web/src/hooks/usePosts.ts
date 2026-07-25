"use client";

import { useState, useCallback, useEffect } from "react";
import { Post } from "@/components/PostCard";

export interface OptimisticPost extends Post {
  isOptimistic?: boolean;
  isPending?: boolean;
  error?: string;
  images?: string[];
  linkUrl?: string;
}

export function usePosts() {
  const [posts, setPosts] = useState<OptimisticPost[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/posts");
      if (res.ok) {
        const data = await res.json();
        setPosts(data.posts || []);
      } else {
        // Fallback default posts
        setPosts([
          {
            id: 1,
            author: "GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
            username: "stellar_dev",
            content: "Just deployed my first smart contract on Stellar! 🚀",
            tip_total: 100,
            like_count: 5,
            timestamp: Math.floor(Date.now() / 1000) - 3600,
          },
          {
            id: 2,
            author: "GXYZ9876543210ABCDEFGHIJKLMNOPQRSTUVWXYZ",
            username: "crypto_enthusiast",
            content: "The SocialFi ecosystem is growing fast. Excited to be part of it!",
            tip_total: 50,
            like_count: 3,
            timestamp: Math.floor(Date.now() / 1000) - 7200,
          },
        ]);
      }
    } catch {
      setError("Failed to fetch posts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const addPostOptimistic = useCallback(
    async (postData: { content: string; author?: string; images?: string[]; linkUrl?: string }) => {
      const tempId = `temp-${Date.now()}`;
      const optimisticPost: OptimisticPost = {
        id: tempId,
        author: postData.author || "GUSER1234567890ANONYMOUS",
        username: "you",
        content: postData.content,
        images: postData.images || [],
        linkUrl: postData.linkUrl || "",
        like_count: 0,
        tip_total: 0,
        created_at: new Date().toISOString(),
        timestamp: Math.floor(Date.now() / 1000),
        isOptimistic: true,
        isPending: true,
      };

      // 1. Immediately show post in feed
      setPosts((prev) => [optimisticPost, ...prev]);

      try {
        // 2. Call API
        const response = await fetch("/api/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(postData),
        });

        if (!response.ok) {
          throw new Error("Failed to publish post");
        }

        const data = await response.json();
        const createdPost: OptimisticPost = data.post;

        // 3. Replace optimistic post with real server response
        setPosts((prev) =>
          prev.map((p) =>
            p.id === tempId ? { ...createdPost, isOptimistic: false, isPending: false } : p
          )
        );
        return createdPost;
      } catch (err) {
        // 4. Rollback on error
        console.error("Optimistic update error:", err);
        setPosts((prev) => prev.filter((p) => p.id !== tempId));
        throw err;
      }
    },
    []
  );

  return {
    posts,
    loading,
    error,
    fetchPosts,
    addPostOptimistic,
  };
}
