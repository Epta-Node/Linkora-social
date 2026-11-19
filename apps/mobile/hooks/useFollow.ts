import { useCallback, useState } from "react";

import { useToast } from "../context/ToastContext";
import { useWallet } from "./useWallet";
import { useSubmitTx } from "./useSubmitTx";
import { impact } from "../utils/haptics";
import { useNetwork } from "./useNetwork";

export const useFollow = (targetAddress: string) => {
  const { address, connected } = useWallet();
  const { isOffline } = useNetwork();
  const { showError } = useToast();
  const submitTx = useSubmitTx();

  const [isFollowing, setIsFollowing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

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

    try {
      const txDescriptor = isFollowing
        ? `unfollow:${address}:${targetAddress}`
        : `follow:${address}:${targetAddress}`;

      await submitTx(txDescriptor);
      await impact("light");
      setIsFollowing((prev) => !prev);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Follow action failed"));
    } finally {
      setIsLoading(false);
    }
  }, [address, connected, isFollowing, isOffline, targetAddress, submitTx, showError]);

  return { isFollowing, isLoading, toggleFollow, error };
};
