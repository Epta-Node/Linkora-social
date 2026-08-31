import { useState, useEffect, useCallback } from "react";
import type { Pool } from "../types/pool";

const MOCK_POOLS: Pool[] = [
  {
    pool_id: "pool-1",
    token: "USDC",
    balance: BigInt("50000"),
    admins: ["GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ"],
    threshold: 1,
  },
  {
    pool_id: "pool-2",
    token: "EUR",
    balance: BigInt("100000"),
    admins: [
      "GXYZ9876543210ABCDEFGHIJKLMNOPQRSTUVWXYZ",
      "GDEF5678901234ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    ],
    threshold: 2,
  },
  {
    pool_id: "pool-3",
    token: "BRL",
    balance: BigInt("25000"),
    admins: ["GHIJ1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ"],
    threshold: 1,
  },
];

export interface UsePoolsReturn {
  pools: Pool[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function usePools(): UsePoolsReturn {
  const [pools, setPools] = useState<Pool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPools = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
      setPools(MOCK_POOLS);
    } catch (err) {
      setError("Failed to load pools. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPools();
  }, [loadPools]);

  const refresh = useCallback(() => {
    loadPools();
  }, [loadPools]);

  return { pools, loading, error, refresh };
}
