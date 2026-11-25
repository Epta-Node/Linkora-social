"use client";

/**
 * usePosts — TanStack Query edition.
 *
 * The feed lives in the `queryKeys.posts` cache entry. Mutations apply their
 * optimistic change to that cache in `onMutate`, which means:
 *
 *  • `addPostOptimistic(postData)` — prepends a pending post, swaps it for the
 *                                   confirmed server post on success, and
 *                                   removes it (with a toast) on failure.
 *  • `deletePostOptimistic(postId)` — removes the post immediately, restores
 *                                   the previous list on failure.
 *
 * `isOptimistic` / `isPending` flags still drive the visual indicators in
 * FeedContainer; deletes remove the post immediately and restore it on
 * failure.
 */

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Post } from "@/components/PostCard";
import { queryKeys } from "@/lib/queryKeys";
import { toast } from "@/lib/toast";
import { classifyError } from "./usePoolContract";
import { getErrorMessage } from "@/lib/errorClassifier";
import { useDeletePostMutation } from "./useDeletePostMutation";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OptimisticPost extends Post {
  /** True while the post is not yet confirmed server-side. */
  isOptimistic?: boolean;
  /** True specifically during the in-flight API call. */
  isPending?: boolean;
  /** True while a deletion is in-flight. */
  isDeleting?: boolean;
  /** Set when a creation or deletion fails (triggers rollback). */
  error?: string;
  images?: string[];
  linkUrl?: string;
  transactionHash?: string;
}

export interface AddPostInput {
  content: string;
  author?: string;
  images?: string[];
  linkUrl?: string;
}

interface AddPostContext {
  previous: OptimisticPost[];
  tempId: string;
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

const DEMO_POSTS: OptimisticPost[] = [
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
];

async function fetchPosts(): Promise<OptimisticPost[]> {
  const res = await fetch("/api/posts");
  if (!res.ok) {
    // Fallback seed data for development / demo.
    return DEMO_POSTS;
  }
  const data = await res.json();
  return data.posts || [];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePosts() {
  const queryClient = useQueryClient();
  // Per-post error shown as a toast (set on failed optimistic mutation).
  const [postError, setPostError] = useState<string | null>(null);

  const postsQuery = useQuery<OptimisticPost[]>({
    queryKey: queryKeys.posts,
    queryFn: fetchPosts,
  });

  const fetchPostsFromServer = useCallback(async () => {
    await postsQuery.refetch();
  }, [postsQuery]);

  // ── Optimistic post creation ───────────────────────────────────────────────

  const addPostMutation = useMutation<OptimisticPost, Error, AddPostInput, AddPostContext>({
    mutationFn: async (postData) => {
      const response = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postData),
      });

      if (!response.ok) throw new Error("Failed to publish post");

      const data = await response.json();
      return data.post as OptimisticPost;
    },

    onMutate: async (postData) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.posts });

      const previous = queryClient.getQueryData<OptimisticPost[]>(queryKeys.posts) ?? [];
      const tempId = `temp-${Date.now()}`;

      const optimisticPost: OptimisticPost = {
        id: tempId,
        author: postData.author ?? "GUSER1234567890ANONYMOUS",
        username: "you",
        content: postData.content,
        images: postData.images ?? [],
        linkUrl: postData.linkUrl ?? "",
        like_count: 0,
        tip_total: 0,
        created_at: new Date().toISOString(),
        timestamp: Math.floor(Date.now() / 1000),
        isOptimistic: true,
        isPending: true,
      };

      queryClient.setQueryData<OptimisticPost[]>(queryKeys.posts, [optimisticPost, ...previous]);

      return { previous, tempId };
    },

    onSuccess: (confirmedPost, _postData, context) => {
      if (!context) return;

      queryClient.setQueryData<OptimisticPost[]>(queryKeys.posts, (current = []) =>
        current.map((post) =>
          post.id === context.tempId
            ? { ...confirmedPost, isOptimistic: false, isPending: false }
            : post
        )
      );
      toast.success({
        title: "Post published",
        txHash: confirmedPost.transactionHash,
        duration: 5000,
      });
    },

    onError: (error, _postData, context) => {
      if (context) {
        queryClient.setQueryData<OptimisticPost[]>(queryKeys.posts, context.previous);
      }

      const message = getErrorMessage(error);
      setPostError(message);
      toast.error({
        title: "Post wasn't published",
        description: `${message}. Your draft is still in the composer.`,
        duration: 5000,
      });
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.posts, refetchType: "none" });
    },
  });

  const addPostOptimistic = useCallback(
    async (postData: AddPostInput) => addPostMutation.mutateAsync(postData),
    [addPostMutation]
  );

  // ── Optimistic post deletion ───────────────────────────────────────────────

  const {
    deletePostAsync,
    deletePost,
    isPending: isDeleting,
  } = useDeletePostMutation({
    onError: (error) => setPostError(classifyError(error)),
  });

  const deletePostOptimistic = useCallback(
    async (postId: string | number) => {
      try {
        return await deletePostAsync(postId);
      } catch (error) {
        // The hook already restored the cache and raised a toast; rethrow so
        // callers can keep their existing error handling.
        throw error;
      }
    },
    [deletePostAsync]
  );

  // ── Clear post error ───────────────────────────────────────────────────────

  const clearPostError = useCallback(() => setPostError(null), []);

  return {
    posts: postsQuery.data ?? [],
    loading: postsQuery.isPending,
    error: postsQuery.error ? "Failed to fetch posts" : null,
    postError,
    clearPostError,
    fetchPosts: fetchPostsFromServer,
    addPostOptimistic,
    deletePostOptimistic,
    deletePost,
    isDeleting,
  };
}
