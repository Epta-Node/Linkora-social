import { useState, useEffect, useCallback, useRef } from "react";

import type { FollowUser } from "./useFollowers";

const PAGE_SIZE = 50;

async function fetchFollowingPage(
  address: string,
  offset: number,
  limit: number,
): Promise<FollowUser[]> {
  const ALL_FOLLOWING: FollowUser[] = [
    { address: "GBCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ", username: "rustacean" },
    { address: "GDEF5678901234ABCDEFGHIJKLMNOPQRSTUVWXYZ", username: "linkora_fan" },
    { address: "GHIJ1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ", username: "soroban_builder" },
    { address: "GKLM5678901234ABCDEFGHIJKLMNOPQRSTUVWXYZ", username: "defi_explorer" },
    { address: "GNOP1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ", username: "nft_collector" },
  ];

  await new Promise<void>((resolve) => setTimeout(resolve, 400));

  return ALL_FOLLOWING.slice(offset, offset + limit);
}

export interface UseFollowingReturn {
  users: FollowUser[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
}

export function useFollowing(address: string): UseFollowingReturn {
  const [users, setUsers] = useState<FollowUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const offsetRef = useRef(0);
  const loadingRef = useRef(false);

  const load = useCallback(
    async (offset: number, replace: boolean) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setError(null);

      try {
        const fetched = await fetchFollowingPage(address, offset, PAGE_SIZE);
        setUsers((prev) => (replace ? fetched : [...prev, ...fetched]));
        setHasMore(fetched.length >= PAGE_SIZE);
        offsetRef.current = offset + fetched.length;
      } catch {
        setError("Failed to load following. Please try again.");
      } finally {
        setLoading(false);
        loadingRef.current = false;
      }
    },
    [address],
  );

  useEffect(() => {
    offsetRef.current = 0;
    load(0, true);
  }, [load]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      load(offsetRef.current, false);
    }
  }, [loading, hasMore, load]);

  const refresh = useCallback(() => {
    offsetRef.current = 0;
    load(0, true);
  }, [load]);

  return { users, loading, error, hasMore, loadMore, refresh };
}
