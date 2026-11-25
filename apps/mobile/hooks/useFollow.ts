import { useCallback, useEffect, useState } from "react";

import { useToast } from "../context/ToastContext";
import { useWallet } from "./useWallet";
import { useSubmitTx } from "./useSubmitTx";
import { impact } from "../utils/haptics";
import { useNetwork } from "./useNetwork";
import { clearFeedAction, getFeedAction, queueFeedAction } from "../utils/db";

export const useFollow = (targetAddress: string) => {
  const { address, connected } = useWallet();
  const { isOffline } = useNetwork();
  const { showError } = useToast();
  const submitTx = useSubmitTx();

  const [isFollowing, setIsFollowing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Pending follow/unfollow writes are persisted so a refresh or app restart
  // keeps the local optimistic state until the transaction confirms (#1779).
  useEffect(() => {
    if (!address) return;
    let active = true;
    getFeedAction("follow", address, targetAddress)
      .then((action) => {
        if (active && action) setIsFollowing(action.value);
      })
      .catch((err) => console.warn("Failed to restore pending follow:", err));
    return () => {
      active = false;
    };
  }, [address, targetAddress]);

  const toggleFollow = useCallback(async () => {
    if (isOffline) {
      const message = "You are offline. Follow actions are unavailable until your connection is restored.";
      showError(message);
      setError(new Error(message));
      return;
    }

    if (!connected || !address) {
      const message = "Connect your wallet to follow users.";
      showError(message);
      setError(new Error(message));
      return;
    }

    setIsLoading(true);
    setError(null);

    let actionId: string | null = null;
    let optimistic = false;
    const next = !isFollowing;
    try {
      actionId = await queueFeedAction("follow", address, targetAddress, next);
      setIsFollowing(next);
      optimistic = true;

      const txDescriptor = next
        ? `follow:${address}:${targetAddress}`
        : `unfollow:${address}:${targetAddress}`;
      await submitTx(txDescriptor);
      await impact("light");
    } catch (err) {
      if (optimistic) setIsFollowing(!next);
      setError(err instanceof Error ? err : new Error("Follow action failed"));
    } finally {
      if (actionId) {
        await clearFeedAction(actionId).catch((err) =>
          console.warn("Failed to clear pending follow:", err)
        );
      }
      setIsLoading(false);
    }
  }, [address, connected, isFollowing, isOffline, targetAddress, submitTx, showError]);

  return { isFollowing, isLoading, toggleFollow, error };
};
