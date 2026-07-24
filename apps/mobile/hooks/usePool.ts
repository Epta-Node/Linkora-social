import { useState, useEffect, useCallback } from "react";
import type { Pool } from "../types/pool";

const MOCK_POOLS: Record<string, Pool> = {
  "pool-1": {
    pool_id: "pool-1",
    token: "USDC",
    balance: BigInt("50000"),
    admins: ["GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ"],
    threshold: 1,
  },
  "pool-2": {
    pool_id: "pool-2",
    token: "EUR",
    balance: BigInt("100000"),
    admins: [
      "GXYZ9876543210ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      "GDEF5678901234ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    ],
    threshold: 2,
  },
  "pool-3": {
    pool_id: "pool-3",
    token: "BRL",
    balance: BigInt("25000"),
    admins: ["GHIJ1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ"],
    threshold: 1,
  },
};

export interface UsePoolReturn {
  pool: Pool | null;
  loading: boolean;
  error: string | null;
  isAdmin: (address: string) => boolean;
  refresh: () => void;
}

export function usePool(poolId: string): UsePoolReturn {
  const [pool, setPool] = useState<Pool | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPool = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
      const foundPool = MOCK_POOLS[poolId] || null;
      if (!foundPool) {
        setError("Pool not found");
      }
      setPool(foundPool);
    } catch (err) {
      setError("Failed to load pool. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [poolId]);

  useEffect(() => {
    loadPool();
  }, [loadPool]);

  const isAdmin = useCallback(
    (address: string) => {
      return pool?.admins.includes(address) ?? false;
    },
    [pool]
  );

  const refresh = useCallback(() => {
    loadPool();
  }, [loadPool]);

  return { pool, loading, error, isAdmin, refresh };
}
