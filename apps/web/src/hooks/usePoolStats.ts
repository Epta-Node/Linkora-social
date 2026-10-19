"use client";

import { useState, useCallback, useEffect } from "react";

const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || "http://localhost:3001";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TimeRange = "7d" | "30d" | "90d";

/** A single data point for the TVL / member-count time series */
export interface PoolStatPoint {
  /** ISO date string, e.g. "2026-10-01" */
  date: string;
  /** Pool balance (TVL) expressed in token units (already divided by decimals) */
  tvl: number;
  /** Number of unique members at that point in time */
  memberCount: number;
}

/** A single data point for the deposit / withdrawal bar chart */
export interface PoolActivityPoint {
  /** ISO date string, e.g. "2026-10-01" */
  date: string;
  deposits: number;
  withdrawals: number;
}

export interface PoolEvent {
  type: "deposit" | "withdraw";
  address: string;
  amount: string;
  ledger: number;
  timestamp: string;
}

/** Shape returned by GET /pools/:id/stats */
export interface PoolStatsResponse {
  pool_id: string;
  token: string;
  balance: string;
  admins: string[];
  threshold: number;
  created_ledger: number;
  total_deposited: string;
  total_withdrawn: string;
  contributor_count: number;
  /** Historical TVL + member count snapshots, ordered oldest-first */
  tvl_history: PoolStatPoint[];
  /** Per-day deposit / withdrawal activity */
  activity: PoolActivityPoint[];
  /** Latest estimated APY expressed as a percentage, e.g. 8.45 */
  estimated_apy: number;
  recent_events: PoolEvent[];
  volume_7d: string;
  volume_30d: string;
}

export type PoolStatsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "loaded"; data: PoolStatsResponse };

// ── Helpers ───────────────────────────────────────────────────────────────────

const DECIMALS = 10_000_000; // Stellar 7-decimal stroops

function parseTokenUnits(raw: string | number | bigint): number {
  return Number(BigInt(raw.toString())) / DECIMALS;
}

/**
 * Derives time-series data from the flat recent_events list when the indexer
 * does not yet return pre-aggregated tvl_history / activity fields. This
 * keeps the hook backwards-compatible with older indexer versions.
 */
function deriveSeriesFromEvents(
  events: PoolEvent[],
  initialBalance: bigint,
  range: TimeRange,
): { tvlHistory: PoolStatPoint[]; activity: PoolActivityPoint[] } {
  const now = Date.now();
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  const cutoff = now - days * 24 * 60 * 60 * 1000;

  const filtered = events.filter((e) => {
    if (!e.timestamp) return true;
    return new Date(e.timestamp).getTime() >= cutoff;
  });

  // Group by date
  const byDate = new Map<string, { deposits: number; withdrawals: number }>();
  for (const e of filtered) {
    const date = e.timestamp
      ? new Date(e.timestamp).toISOString().slice(0, 10)
      : `L${e.ledger}`;
    const existing = byDate.get(date) ?? { deposits: 0, withdrawals: 0 };
    const amount = parseTokenUnits(e.amount);
    if (e.type === "deposit") existing.deposits += amount;
    else existing.withdrawals += amount;
    byDate.set(date, existing);
  }

  const activity: PoolActivityPoint[] = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { deposits, withdrawals }]) => ({ date, deposits, withdrawals }));

  // Build running TVL from the last known balance working backwards
  let runningBalance = Number(initialBalance) / DECIMALS;
  const tvlHistory: PoolStatPoint[] = activity
    .slice()
    .reverse()
    .map(({ date, deposits, withdrawals }, i) => {
      const tvl = runningBalance;
      // Unwind the net flow for each prior day
      if (i < activity.length - 1) {
        runningBalance = runningBalance - deposits + withdrawals;
      }
      return { date, tvl, memberCount: 0 };
    })
    .reverse();

  return { tvlHistory, activity };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePoolStats(poolId: string | null, range: TimeRange) {
  const [state, setState] = useState<PoolStatsState>({ status: "idle" });

  const load = useCallback(async () => {
    if (!poolId) {
      setState({ status: "error", message: "Invalid pool ID" });
      return;
    }

    setState({ status: "loading" });

    try {
      const res = await fetch(
        `${INDEXER_URL}/api/pools/${poolId}/stats?range=${range}`,
      );

      if (res.status === 404) {
        setState({ status: "empty" });
        return;
      }

      if (!res.ok) {
        throw new Error(`Indexer responded with ${res.status}`);
      }

      const raw: PoolStatsResponse = await res.json();

      // Back-fill derived series when the indexer omits them
      if (!raw.tvl_history?.length || !raw.activity?.length) {
        const { tvlHistory, activity } = deriveSeriesFromEvents(
          raw.recent_events ?? [],
          BigInt(raw.balance),
          range,
        );
        raw.tvl_history = raw.tvl_history?.length ? raw.tvl_history : tvlHistory;
        raw.activity = raw.activity?.length ? raw.activity : activity;
      }

      if (!raw.estimated_apy) {
        // Rough APY estimate: annualise the net yield inferred from fee accrual
        // (total_deposited - balance - total_withdrawn) / total_deposited * 365/days
        const deposited = Number(BigInt(raw.total_deposited)) / DECIMALS;
        const withdrawn = Number(BigInt(raw.total_withdrawn)) / DECIMALS;
        const balance = Number(BigInt(raw.balance)) / DECIMALS;
        const yield_ = balance - deposited + withdrawn;
        raw.estimated_apy =
          deposited > 0 ? Math.max(0, (yield_ / deposited) * (365 / 30) * 100) : 0;
      }

      setState({ status: "loaded", data: raw });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to load pool stats",
      });
    }
  }, [poolId, range]);

  useEffect(() => {
    load();
  }, [load]);

  return { state, reload: load };
}
