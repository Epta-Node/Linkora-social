import { useState, useEffect, useCallback } from "react";

import { getIndexerBaseUrl } from "../utils/indexerConfig";
import {
  formatPoolBalance,
  getPoolCatalogEntry,
  POOL_CATALOG,
  type PoolCatalogEntry,
} from "../utils/poolCatalog";

/** A pool as rendered by the Pools tab. */
export interface PoolListItem extends PoolCatalogEntry {
  admins: string[];
  threshold: number;
  /** Where the balance/admins came from — the catalog is offline metadata only. */
  source: "indexer" | "catalog";
}

export interface UsePoolsReturn {
  pools: PoolListItem[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

interface IndexerPoolRow {
  pool_id?: unknown;
  token?: unknown;
  balance?: unknown;
  admins?: unknown;
  threshold?: unknown;
}

function catalogPools(): PoolListItem[] {
  return POOL_CATALOG.map((entry) => ({
    ...entry,
    admins: [],
    threshold: 0,
    source: "catalog",
  }));
}

/**
 * #1592 — the Pools tab is driven by the canonical catalog in
 * `utils/poolCatalog`, the same module the `/pools/[id]` route resolves
 * against. The `MOCK_POOLS` list that used to live here carried `pool-1/2/3`
 * ids that no other part of the app knew about, so every card opened
 * "Pool not found".
 *
 * Live state is read from the indexer's pool list; if it cannot be reached the
 * tab falls back to the catalog so the ids stay navigable, with `error` set so
 * the caller can say the data is not live.
 */
export function usePools(): UsePoolsReturn {
  const [pools, setPools] = useState<PoolListItem[]>(() => catalogPools());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPools = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const indexerUrl = getIndexerBaseUrl();
      const response = await fetch(`${indexerUrl}/api/pools`);
      if (!response.ok) {
        throw new Error(`Failed to load pools (${response.status})`);
      }

      const data = (await response.json()) as { pools?: unknown };
      const rows = Array.isArray(data.pools) ? (data.pools as IndexerPoolRow[]) : [];

      if (rows.length === 0) {
        setPools(catalogPools());
        return;
      }

      setPools(
        rows
          .filter(
            (row): row is IndexerPoolRow & { pool_id: string } => typeof row.pool_id === "string"
          )
          .map((row) => {
            const entry = getPoolCatalogEntry(row.pool_id);
            const token = typeof row.token === "string" ? row.token : (entry?.token ?? "XLM");
            const balance = typeof row.balance === "string" ? row.balance : "0";

            return {
              id: row.pool_id,
              name: entry?.name ?? row.pool_id,
              description: entry?.description ?? "Community managed pool",
              token,
              balance: formatPoolBalance(balance, token),
              members: entry?.members ?? 0,
              admins: Array.isArray(row.admins) ? row.admins.map(String) : [],
              threshold: Number(row.threshold) || 0,
              source: "indexer" as const,
            };
          })
      );
    } catch {
      // Keep the pool list navigable offline; `error` tells the tab the
      // balances it is showing are not live.
      setPools(catalogPools());
      setError("Could not reach the indexer. Showing saved pools.");
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
