"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { truncateAddress } from "@/hooks/usePools";

const indexerUrl = process.env.NEXT_PUBLIC_INDEXER_URL || "http://localhost:3001";

interface PoolEvent {
  type: "deposit" | "withdraw";
  address: string;
  amount: string;
  ledger: number;
  timestamp: string;
}

interface PoolAnalytics {
  pool_id: string;
  token: string;
  balance: string;
  admins: string[];
  threshold: number;
  created_ledger: number;
  total_deposited: string;
  total_withdrawn: string;
  contributor_count: number;
  recent_events: PoolEvent[];
  volume_7d: string;
  volume_30d: string;
}

type AnalyticsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "loaded"; data: PoolAnalytics };

export default function PoolAnalyticsPage() {
  const params = useParams();
  const poolId = typeof params.id === "string" ? params.id : null;
  const [state, setState] = useState<AnalyticsState>({ status: "loading" });
  const [dateRange, setDateRange] = useState<7 | 30>("7d");

  const loadAnalytics = useCallback(async () => {
    if (!poolId) {
      setState({ status: "error", message: "Invalid pool ID" });
      return;
    }

    setState({ status: "loading" });
    try {
      const res = await fetch(`${indexerUrl}/api/pools/${poolId}/analytics`);
      if (res.status === 404) {
        setState({ status: "empty" });
        return;
      }
      if (!res.ok) throw new Error("Failed to fetch pool analytics");
      const data: PoolAnalytics = await res.json();
      setState({ status: "loaded", data });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to load analytics",
      });
    }
  }, [poolId]);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  if (!poolId) {
    return (
      <main className="min-h-screen bg-[var(--bg-primary)]">
        <div className="max-w-6xl mx-auto p-4 md:p-8">
          <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--bg-tertiary)] p-12 text-center">
            <h1 className="text-2xl font-bold mb-3">Invalid Pool</h1>
            <p className="text-[var(--text-muted)] mb-6">No pool ID provided.</p>
            <Link href="/pools" className="text-[var(--accent-teal)] hover:underline font-medium">
              Back to Pools
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[var(--bg-primary)]">
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm" aria-label="Breadcrumb">
          <Link href="/pools" className="text-[var(--accent-teal)] hover:underline font-medium">
            Pools
          </Link>
          <span className="text-[var(--text-muted)]">/</span>
          <Link
            href={`/pools/${poolId}`}
            className="text-[var(--accent-teal)] hover:underline font-medium"
          >
            {poolId}
          </Link>
          <span className="text-[var(--text-muted)]">/</span>
          <span className="text-[var(--text-muted)] font-medium">Analytics</span>
        </nav>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Pool Analytics</h1>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              Activity insights for pool <span className="font-mono">{poolId}</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex rounded-xl border border-[var(--bg-tertiary)] overflow-hidden">
              {(["7d", "30d"] as const).map((range) => (
                <button
                  key={range}
                  onClick={() => setDateRange(range)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    dateRange === range
                      ? "bg-[var(--accent-coral)] text-white"
                      : "bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {range}
                </button>
              ))}
            </div>
            <button
              onClick={loadAnalytics}
              disabled={state.status === "loading"}
              className="px-4 py-2 text-sm font-medium rounded-xl border border-[var(--bg-tertiary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Content */}
        {state.status === "loading" && <LoadingSkeleton />}

        {state.status === "error" && (
          <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--bg-tertiary)] p-12 text-center">
            <p className="text-[var(--error)] mb-4">{state.message}</p>
            <button
              onClick={loadAnalytics}
              className="px-6 py-2 rounded-xl bg-[var(--accent-coral)] text-white font-medium hover:opacity-90 transition-opacity"
            >
              Retry
            </button>
          </div>
        )}

        {state.status === "empty" && (
          <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--bg-tertiary)] p-12 text-center">
            <p className="text-[var(--text-muted)] mb-2">No analytics data available yet.</p>
            <p className="text-sm text-[var(--text-muted)]">
              Pool activity will appear here once deposits or withdrawals are made.
            </p>
          </div>
        )}

        {state.status === "loaded" && <AnalyticsDashboard data={state.data} dateRange={dateRange} />}
      </div>
    </main>
  );
}

function AnalyticsDashboard({
  data,
  dateRange,
}: {
  data: PoolAnalytics;
  dateRange: "7d" | "30d";
}) {
  const balance = BigInt(data.balance);
  const deposited = BigInt(data.total_deposited);
  const withdrawn = BigInt(data.total_withdrawn);
  const netFlow = deposited - withdrawn;

  const volumeData = data.recent_events
    .filter((e) => {
      if (dateRange === "7d") return true;
      return true;
    })
    .map((e) => ({
      date: e.timestamp ? new Date(e.timestamp).toLocaleDateString() : `L${e.ledger}`,
      deposit: e.type === "deposit" ? Number(e.amount) / 10_000_000 : 0,
      withdraw: e.type === "withdraw" ? Number(e.amount) / 10_000_000 : 0,
    }))
    .reverse();

  const leaderboard = new Map<string, number>();
  for (const event of data.recent_events) {
    const current = leaderboard.get(event.address) ?? 0;
    leaderboard.set(event.address, current + Number(event.amount));
  }
  const topContributors = Array.from(leaderboard.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Total Value Locked" value={`${formatAmount(balance)} tokens`} />
        <SummaryCard label="Contributors" value={String(data.contributor_count)} />
        <SummaryCard label="Total Deposited" value={`${formatAmount(deposited)} tokens`} />
        <SummaryCard
          label="Net Flow"
          value={`${netFlow >= 0 ? "+" : ""}${formatAmount(netFlow)} tokens`}
          positive={netFlow >= 0}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Volume Chart */}
        <ChartCard title="Contribution Volume" subtitle={`Deposit vs withdrawal volume`}>
          {volumeData.length === 0 ? (
            <p className="text-[var(--text-muted)] text-sm p-4">No volume data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={volumeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: "var(--text-muted)" }} />
                <YAxis tick={{ fontSize: 12, fill: "var(--text-muted)" }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                    color: "var(--text-primary)",
                  }}
                />
                <Legend />
                <Bar dataKey="deposit" fill="#4ECDC4" radius={[4, 4, 0, 0]} name="Deposits" />
                <Bar dataKey="withdraw" fill="#FF6B5B" radius={[4, 4, 0, 0]} name="Withdrawals" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Balance Trend */}
        <ChartCard title="Balance Trend" subtitle="Pool balance over time">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={volumeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: "var(--text-muted)" }} />
              <YAxis tick={{ fontSize: 12, fill: "var(--text-muted)" }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  color: "var(--text-primary)",
                }}
              />
              <Line
                type="monotone"
                dataKey="deposit"
                stroke="#7c3aed"
                strokeWidth={2}
                dot={false}
                name="Deposits"
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Top Contributors */}
        <ChartCard title="Top Contributors" subtitle="Ranked by total amount">
          {topContributors.length === 0 ? (
            <p className="text-[var(--text-muted)] text-sm p-4">No contributors yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--bg-tertiary)]">
                    <th className="text-left py-2 px-3 text-[var(--text-muted)] font-medium">#</th>
                    <th className="text-left py-2 px-3 text-[var(--text-muted)] font-medium">
                      Address
                    </th>
                    <th className="text-right py-2 px-3 text-[var(--text-muted)] font-medium">
                      Amount
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topContributors.map(([address, amount], i) => (
                    <tr
                      key={address}
                      className="border-b border-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] transition-colors"
                    >
                      <td className="py-2 px-3 text-[var(--text-muted)]">{i + 1}</td>
                      <td className="py-2 px-3 font-mono text-[var(--text-primary)]">
                        {truncateAddress(address)}
                      </td>
                      <td className="py-2 px-3 text-right font-semibold text-[var(--accent-teal)]">
                        {formatAmount(BigInt(amount))} tokens
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>

        {/* Recent Activity */}
        <ChartCard title="Recent Activity" subtitle="Latest pool events">
          {data.recent_events.length === 0 ? (
            <p className="text-[var(--text-muted)] text-sm p-4">No recent activity.</p>
          ) : (
            <div className="space-y-3">
              {data.recent_events.slice(0, 10).map((event, i) => (
                <div
                  key={`${event.ledger}-${i}`}
                  className="flex items-center justify-between py-2 border-b border-[var(--bg-tertiary)] last:border-0"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded ${
                        event.type === "deposit"
                          ? "bg-green-900/30 text-green-400"
                          : "bg-red-900/30 text-red-400"
                      }`}
                    >
                      {event.type === "deposit" ? "↓ DEPOSIT" : "↑ WITHDRAW"}
                    </span>
                    <span className="font-mono text-sm text-[var(--text-primary)]">
                      {truncateAddress(event.address)}
                    </span>
                  </div>
                  <span className="text-sm font-semibold text-[var(--text-primary)]">
                    {formatAmount(BigInt(event.amount))} tokens
                  </span>
                </div>
              ))}
            </div>
          )}
        </ChartCard>
      </div>

      {/* Admin & Pool Info */}
      <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--bg-tertiary)] p-6">
        <h3 className="text-lg font-semibold mb-3">Pool Info</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-[var(--text-muted)]">Token:</span>{" "}
            <span className="font-mono">{truncateAddress(data.token, 8, 4)}</span>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Threshold:</span>{" "}
            <span>
              {data.threshold} / {data.admins.length} admins
            </span>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Created:</span>{" "}
            <span>Ledger {data.created_ledger}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  positive,
}: {
  label: string;
  value: string;
  positive?: boolean;
}) {
  return (
    <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--bg-tertiary)] p-4">
      <p className="text-xs text-[var(--text-muted)] mb-1">{label}</p>
      <p
        className={`text-lg font-bold truncate ${
          positive === true
            ? "text-green-400"
            : positive === false
              ? "text-red-400"
              : "text-[var(--text-primary)]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--bg-tertiary)] p-6">
      <h3 className="text-lg font-semibold mb-1">{title}</h3>
      <p className="text-sm text-[var(--text-muted)] mb-4">{subtitle}</p>
      {children}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="animate-pulse bg-[var(--bg-secondary)] rounded-2xl p-4 h-24" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2].map((i) => (
          <div key={i} className="animate-pulse bg-[var(--bg-secondary)] rounded-2xl p-6 h-80" />
        ))}
      </div>
    </div>
  );
}

function formatAmount(value: bigint): string {
  const divisor = BigInt(10_000_000);
  const whole = value / divisor;
  const frac = value % divisor;
  if (frac === BigInt(0)) return whole.toString();
  return `${whole}.${frac.toString().padStart(7, "0").replace(/0+$/, "")}`;
}
