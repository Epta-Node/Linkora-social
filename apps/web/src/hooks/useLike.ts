"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useWallet } from "@/components/WalletProvider";
import { classifyError } from "./usePoolContract";

// ── Mock contract client ──────────────────────────────────────────────────────
// Replace the body with the real SDK call once the generated client is wired up
// (packages/sdk). Liking is idempotent on-chain: a second call by the same liker
// is rejected, which is why the UI disables the button after the first like.
async function contractLikePost(_liker: string, _postId: number): Promise<void> {
  // TODO: replace with: await client.like_post({ liker, post_id: postId })
  await new Promise((resolve) => setTimeout(resolve, 600));
}

export interface UseLikeOptions {
  postId: number;
  /** Whether the connected user has already liked this post, from `has_liked`. */
  initialHasLiked?: boolean;
  /** The post's current like count, used to seed the optimistic counter. */
  initialLikeCount: number;
}

export interface UseLikeResult {
  liked: boolean;
  likeCount: number;
  /** True while a like request is in flight. */
  pending: boolean;
  error: string | null;
  /**
   * Like the post once. Optimistically bumps the count, rolls back on failure,
   * and is a no-op when already liked or a request is in flight (idempotent).
   * Resolves to `true` only when the like was committed.
   */
  like: () => Promise<boolean>;
}

/**
 * Drives the like button on a post with optimistic UI.
 *
 * - Initial state is derived from `has_liked` (`initialHasLiked`).
 * - The count increments immediately on click, before the network round-trip.
 * - On transaction failure the optimistic update is rolled back.
 * - Once liked, the action becomes a no-op so the button can stay disabled.
 */
export function useLike({
  postId,
  initialHasLiked = false,
  initialLikeCount,
}: UseLikeOptions): UseLikeResult {
  const { publicKey } = useWallet();
  const [liked, setLiked] = useState(initialHasLiked);
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed state when the hook is reused for a different post (e.g. a detail
  // page that swaps the post in place rather than remounting).
  const lastPostId = useRef(postId);
  useEffect(() => {
    if (lastPostId.current === postId) return;
    lastPostId.current = postId;
    setLiked(initialHasLiked);
    setLikeCount(initialLikeCount);
    setPending(false);
    setError(null);
  }, [postId, initialHasLiked, initialLikeCount]);

  const like = useCallback(async (): Promise<boolean> => {
    // Idempotent: ignore if already liked or a request is mid-flight.
    if (liked || pending) return false;
    if (!publicKey) {
      setError("Connect your wallet to like posts");
      return false;
    }

    setPending(true);
    setError(null);

    // Optimistic update — reflect the like before the round-trip completes.
    setLiked(true);
    setLikeCount((c) => c + 1);

    try {
      await contractLikePost(publicKey, postId);
      return true;
    } catch (err) {
      // Roll back the optimistic update on transaction failure.
      setLiked(false);
      setLikeCount((c) => c - 1);
      setError(classifyError(err));
      return false;
    } finally {
      setPending(false);
    }
  }, [liked, pending, publicKey, postId]);

  return { liked, likeCount, pending, error, like };
}

export { contractLikePost };
