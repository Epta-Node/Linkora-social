import { useState, useEffect, useCallback } from "react";

import { useToast } from "../context/ToastContext";
import { useWallet } from "./useWallet";
import { useSubmitTx } from "./useSubmitTx";

export interface BlockedUser {
  address: string;
  reason: string;
}

const INDEXER_URL = process.env.EXPO_PUBLIC_INDEXER_URL || "http://localhost:3001";

export interface UseBlockReturn {
  blocked: BlockedUser[];
  loading: boolean;
  error: string | null;
  blocking: string | null;
  blockUser: (address: string) => Promise<void>;
  unblockUser: (address: string) => Promise<void>;
  refresh: () => void;
}

export function useBlock(): UseBlockReturn {
  const { address: currentUserAddress, connected } = useWallet();
  const { showError } = useToast();
  const submitTx = useSubmitTx();

  const [blocked, setBlocked] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blocking, setBlocking] = useState<string | null>(null);

  const loadBlocked = useCallback(async () => {
    if (!currentUserAddress) {
      setBlocked([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${INDEXER_URL}/api/users/${currentUserAddress}/blocked`);
      if (!response.ok) {
        throw new Error("Failed to fetch blocked users");
      }
      const data = await response.json();
      const mapped: BlockedUser[] = (data.blocked || []).map((addr: string) => ({
        address: addr,
        reason: "Blocked",
      }));
      setBlocked(mapped);
    } catch (err) {
      setError("Failed to load blocked users. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [currentUserAddress]);

  useEffect(() => {
    loadBlocked();
  }, [loadBlocked]);

  const blockUser = useCallback(
    async (address: string) => {
      if (!connected || !currentUserAddress) {
        showError("Connect your wallet to block users.");
        return;
      }

      setBlocking(address);
      setError(null);

      try {
        await submitTx(`block_user:${currentUserAddress}:${address}`);
        setBlocked((prev) => [...prev, { address, reason: "Blocked" }]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to block user. Please try again.");
      } finally {
        setBlocking(null);
      }
    },
    [currentUserAddress, connected, submitTx, showError]
  );

  const unblockUser = useCallback(
    async (address: string) => {
      if (!connected || !currentUserAddress) {
        showError("Connect your wallet to unblock users.");
        return;
      }

      setBlocking(address);
      setError(null);

      try {
        await submitTx(`unblock_user:${currentUserAddress}:${address}`);
        setBlocked((prev) => prev.filter((item) => item.address !== address));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to unblock user. Please try again.");
      } finally {
        setBlocking(null);
      }
    },
    [currentUserAddress, connected, submitTx, showError]
  );

  const refresh = useCallback(() => {
    loadBlocked();
  }, [loadBlocked]);

  return { blocked, loading, error, blocking, blockUser, unblockUser, refresh };
}
