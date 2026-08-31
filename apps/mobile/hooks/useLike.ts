import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "../context/ToastContext";
import { useWallet } from "./useWallet";
import { useSubmitTx } from "./useSubmitTx";

export interface UseLikeOptions {
  postId: number | string;
  initialHasLiked?: boolean;
  initialLikeCount: number;
}

export interface UseLikeResult {
  liked: boolean;
  likeCount: number;
  pending: boolean;
  error: string | null;
  like: () => Promise<boolean>;
}

export function useLike({
  postId,
  initialHasLiked = false,
  initialLikeCount,
}: UseLikeOptions): UseLikeResult {
  const { address, connected } = useWallet();
  const { showError } = useToast();
  const submitTx = useSubmitTx();

  const [liked, setLiked] = useState(initialHasLiked);
  const [likeCount, setLikeCount] = useState(initialLikeCount);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastPostId = useRef(postId);

  useEffect(() => {
    if (lastPostId.current === postId) {
      return;
    }

    lastPostId.current = postId;
    setLiked(initialHasLiked);
    setLikeCount(initialLikeCount);
    setPending(false);
    setError(null);
  }, [initialHasLiked, initialLikeCount, postId]);

  const like = useCallback(async (): Promise<boolean> => {
    if (liked || pending) {
      return false;
    }

    if (!connected || !address) {
      const message = "Connect your wallet to like posts.";
      setError(message);
      showError(message);
      return false;
    }

    setPending(true);
    setError(null);
    setLiked(true);
    setLikeCount((current) => current + 1);

    try {
      const convertedPostId = typeof postId === "number" ? postId : BigInt(postId);
      await submitTx(`like_post:${address}:${convertedPostId}`);
      return true;
    } catch (err) {
      setLiked(false);
      setLikeCount((current) => Math.max(0, current - 1));
      const message = err instanceof Error ? err.message : "Failed to like post.";
      setError(message);
      return false;
    } finally {
      setPending(false);
    }
  }, [address, connected, liked, pending, postId, showError, submitTx]);

  return { liked, likeCount, pending, error, like };
}
