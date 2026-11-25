import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "../context/ToastContext";
import { useWallet } from "./useWallet";
import { useSubmitTx } from "./useSubmitTx";
import { impact } from "../utils/haptics";
import { useNetwork } from "./useNetwork";
import { clearFeedAction, getFeedAction, queueFeedAction } from "../utils/db";

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
  const { isOffline } = useNetwork();
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

  // Restore an optimistic like that was queued offline and not confirmed yet,
  // so a feed refresh or app restart cannot silently drop it (#1779).
  useEffect(() => {
    if (!address) return;
    let active = true;
    getFeedAction("like", address, String(postId))
      .then((action) => {
        if (!active || !action) return;
        setLiked(action.value);
        setLikeCount((current) => (action.value && !current ? current + 1 : current));
      })
      .catch((err) => console.warn("Failed to restore pending like:", err));
    return () => {
      active = false;
    };
  }, [address, postId]);

  const like = useCallback(async (): Promise<boolean> => {
    if (liked || pending || isOffline) {
      return false;
    }

    if (!connected || !address) {
      const message = "Connect your wallet to like posts.";
      setError(message);
      showError(message);
      return false;
    }

    const postIdString = String(postId);
    setPending(true);
    setError(null);

    let actionId: string | null = null;
    let optimistic = false;
    try {
      actionId = await queueFeedAction("like", address, postIdString, true);
      setLiked(true);
      setLikeCount((current) => current + 1);
      optimistic = true;

      await submitTx(`like_post:${address}:${postIdString}`);
      await impact("medium");
      return true;
    } catch (err) {
      if (optimistic) {
        setLiked(false);
        setLikeCount((current) => Math.max(0, current - 1));
      }
      const message = err instanceof Error ? err.message : "Failed to like post.";
      setError(message);
      showError(message);
      return false;
    } finally {
      if (actionId) {
        await clearFeedAction(actionId).catch((err) =>
          console.warn("Failed to clear pending like:", err)
        );
      }
      setPending(false);
    }
  }, [address, connected, isOffline, liked, pending, postId, showError, submitTx]);

  return { liked, likeCount, pending, error, like };
}
