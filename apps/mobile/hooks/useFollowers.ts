import { useState, useEffect, useCallback, useRef } from "react";

const PAGE_SIZE = 50;

export interface FollowUser {
  address: string;
  username: string;
}

async function fetchFollowersPage(
  address: string,
  offset: number,
  limit: number,
): Promise<FollowUser[]> {
  const ALL_FOLLOWERS: FollowUser[] = [
    { address: "GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ", username: "stellar_dev" },
    { address: "GXYZ9876543210ABCDEFGHIJKLMNOPQRSTUVWXYZ", username: "crypto_enthusiast" },
    { address: "GDEF5678901234ABCDEFGHIJKLMNOPQRSTUVWXYZ", username: "linkora_fan" },
    { address: "GHIJ1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ", username: "soroban_builder" },
    { address: "GKLM5678901234ABCDEFGHIJKLMNOPQRSTUVWXYZ", username: "defi_explorer" },
    { address: "GNOP1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ", username: "nft_collector" },
    { address: "GQRS5678901234ABCDEFGHIJKLMNOPQRSTUVWXYZ", username: "dao_member" },
    { address: "GTUV1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ", username: "web3_builder" },
    { address: "GWXY5678901234ABCDEFGHIJKLMNOPQRSTUVWXYZ", username: "crypto_trader" },
    { address: "GZAB1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ", username: "soroban_dev" },
  ];

  await new Promise<void>((resolve) => setTimeout(resolve, 400));

  return ALL_FOLLOWERS.slice(offset, offset + limit);
}

export interface UseFollowersReturn {
  users: FollowUser[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
}

export function useFollowers(address: string): UseFollowersReturn {
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
        const fetched = await fetchFollowersPage(address, offset, PAGE_SIZE);
        setUsers((prev) => (replace ? fetched : [...prev, ...fetched]));
        setHasMore(fetched.length >= PAGE_SIZE);
        offsetRef.current = offset + fetched.length;
      } catch {
        setError("Failed to load followers. Please try again.");
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
