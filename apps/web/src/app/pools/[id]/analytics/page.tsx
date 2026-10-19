"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  AreaChart,
  Area,
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
import { usePoolStats, type TimeRange } from "@/hooks/usePoolStats";
import { truncateAddress } from "@/hooks/usePools";

// ── Constants ─────────────────────────────────────────────────────────────────

const RANGES: TimeRange[] = ["7d", "30d", "90d"];

const CHART_COLORS = {
  tvl: "#7c3aed",
  deposits: "#10b981",
  withdrawals: "#ef4444",
  members: "#60a5fa",
} as const;

const TOOLTIP_STYLE = {
  backgroundColor: "var(--bg-secondary)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  color: "var(--text-primary)",
  fontSize: "12px",
} as const;

const AXIS_TICK = { fontSize: 11, fill: "var(--text-secondary)" } as const;

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PoolAnalyticsPage() {
  const params = useParams();
  const poolId = typeof params.id === "string" ? params.id : null;
  const [range, setRange] = useState<TimeRange>("7d");
  const { state, reload } = usePoolStats(poolId, range);

  if (!poolId) {
    return (
      <main className="min-h-screen bg-[var(--bg-primary)]">
        <div className="max-w-6xl mx-auto p-4 md:p-8">
          <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border)] p-12 text-center">
            <h1 className="text-2xl font-bold mb-3 text-[var(--text-primary)]">Invalid Pool</h1>
            <p className="text-[var(--text-secondary)] mb-6">No pool ID provided.</p>
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
          <span className="text-[var(--text-secondary)]" aria-hidden="true">/</span>
          <Link
            href={`/pools/${poolId}`}
            className="text-[var(--accent-teal)] hover:underline font-medium"
          >
            {poolId}
          </Link>
          <span className="text-[var(--text-secondary)]" aria-hidden="true">/</span>
          <span className="text-[var(--text-secondary)] font-medium">Analytics</span>
        </nav>

        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">Pool Analytics</h1>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              Activity insights for pool{" "}
              <span className="font-mono">{truncateAddress(poolId, 8, 6)}</span>
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Time range toggle */}
            <div
              className="flex rounded-xl border border-[var(--border)] overflow-hidden"
              role="group"
              aria-label="Time range"
            >
              {RANGES.map((r) => (
                <button
                  key={r}
                  id={`range-${r}`}
                  onClick={() => setRange(r)}
                  aria-pressed={range === r}
                  className={`px-4 py-2 text-sm font-semibold transition-colors ${
                    range === r
                      ? "bg-[var(--color-primary)] text-white"
                      : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>

            <button
              onClick={reload}
              disabled={state.status === "loading"}
              className="px-4 py-2 text-sm font-medium rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-colors disabled:opacity-50"
              aria-label="Refresh analytics data"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* States */}
        {state.status === "loading" && <LoadingSkeleton />}

        {state.status === "error" && (
          <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border)] p-12 text-center">
            <p className="text-[var(--error)] mb-4 font-medium">{state.message}</p>
            <button
              onClick={reload}
              className="px-6 py-2 rounded-xl bg-[var(--color-primary)] text-white font-medium hover:opacity-90 transition-opacity"
            >
              Retry
            </button>
          </div>
        )}

        {state.status === "empty" && (
          <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border)] p-12 text-center">
            <p className="text-4xl mb-4" aria-hidden="true">📊</p>
            <p className="text-[var(--text-primary)] font-semibold mb-2">No analytics data yet</p>
            <p className="text-sm text-[var(--text-secondary)]">
              Pool activity will appear here once deposits or withdrawals are made.
            </p>
          </div>
        )}

        {state.status === "loaded" && (
          <AnalyticsDashboard data={state.data} range={range} />
        )}
      </div>
    </main>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

import type { PoolStatsResponse } from "@/hooks/usePoolStats";

function AnalyticsDashboard({
  data,
  range,
}: {
  data: PoolStatsResponse;
  range: TimeRange;
}) {
  const balance = Number(BigInt(data.balance)) / 10_000_000;
  const deposited = Number(BigInt(data.total_deposited)) / 10_000_000;
  const withdrawn = Number(BigInt(data.total_withdrawn)) / 10_000_000;
  const netFlow = deposited - withdrawn;
  const apy = data.estimated_apy ?? 0;

  // Filter time-series to selected range
  const rangeMs =
    range === "7d" ? 7 * 86_400_000 : range === "30d" ? 30 * 86_400_000 : 90 * 86_400_000;
  const cutoff = Date.now() - rangeMs;

  const tvlSeries = (data.tvl_history ?? []).filter(
    (p) => !p.date.startsWith("L") && new Date(p.date).getTime() >= cutoff,
  );

  const activitySeries = (data.activity ?? []).filter(
    (p) => !p.date.startsWith("L") && new Date(p.date).getTime() >= cutoff,
  );

  const memberSeries = tvlSeries.map((p) => ({
    date: p.date,
    members: p.memberCount,
  }));

  // Formatted summary strings for screen readers
  const tvlSummary = `TVL over ${range}: starts at ${fmtNum(tvlSeries[0]?.tvl ?? balance)} tokens and ends at ${fmtNum(tvlSeries[tvlSeries.length - 1]?.tvl ?? balance)} tokens.`;
  const activitySummary = `Deposit and withdrawal activity over ${range}: ${activitySeries.length} data points.`;
  const memberSummary = `Member count over ${range}: latest value ${fmtNum(memberSeries[memberSeries.length - 1]?.members ?? data.contributor_count)}.`;

  return (
    <div className="space-y-6">

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          id="stat-tvl"
          label="Total Value Locked"
          value={`${fmtNum(balance)}`}
          unit="tokens"
          icon="🏦"
        />
        <StatCard
          id="stat-apy"
          label="Estimated APY"
          value={`${apy.toFixed(2)}%`}
          unit="annualised"
          icon="📈"
          highlight={apy > 0}
        />
        <StatCard
          id="stat-members"
          label="Members"
          value={String(data.contributor_count)}
          unit="contributors"
          icon="👥"
        />
        <StatCard
          id="stat-net-flow"
          label="Net Flow"
          value={`${netFlow >= 0 ? "+" : ""}${fmtNum(netFlow)}`}
          unit="tokens"
          icon={netFlow >= 0 ? "⬆️" : "⬇️"}
          positive={netFlow >= 0}
        />
      </div>

      {/* ── TVL area chart ── */}
      <ChartCard
        title="Total Value Locked"
        subtitle={`Pool TVL over the last ${range}`}
        summary={tvlSummary}
        chartId="chart-tvl"
      >
        {tvlSeries.length === 0 ? (
          <EmptyChart />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={tvlSeries} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="tvlGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={CHART_COLORS.tvl} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={CHART_COLORS.tvl} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={60} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${fmtNum(v)} tokens`, "TVL"]} />
              <Area
                type="monotone"
                dataKey="tvl"
                stroke={CHART_COLORS.tvl}
                strokeWidth={2}
                fill="url(#tvlGrad)"
                name="TVL"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* ── Deposit / withdraw bar chart + Member count line chart ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Deposit / withdrawal activity */}
        <ChartCard
          title="Deposit & Withdrawal Activity"
          subtitle={`Daily volume over the last ${range}`}
          summary={activitySummary}
          chartId="chart-activity"
        >
          {activitySeries.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={activitySeries} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={60} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number, name: string) => [`${fmtNum(v)} tokens`, name]}
                />
                <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} />
                <Bar dataKey="deposits" name="Deposits" fill={CHART_COLORS.deposits} radius={[4, 4, 0, 0]} />
                <Bar dataKey="withdrawals" name="Withdrawals" fill={CHART_COLORS.withdrawals} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Member count */}
        <ChartCard
          title="Member Count"
          subtitle={`Unique members over the last ${range}`}
          summary={memberSummary}
          chartId="chart-members"
        >
          {memberSeries.length === 0 ? (
            <EmptyChart />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={memberSeries} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                <YAxis
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number) => [v, "Members"]}
                />
                <Line
                  type="monotone"
                  dataKey="members"
                  stroke={CHART_COLORS.members}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4 }}
                  name="Members"
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* ── Recent activity feed ── */}
      <ChartCard
        title="Recent Activity"
        subtitle="Latest pool events"
        summary={`${data.recent_events.length} recent events.`}
        chartId="chart-recent"
        noPad
      >
        {data.recent_events.length === 0 ? (
          <p className="text-[var(--text-secondary)] text-sm p-6">No recent activity.</p>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {data.recent_events.slice(0, 10).map((event, i) => (
              <div
                key={`${event.ledger}-${i}`}
                className="flex items-center justify-between px-6 py-3 hover:bg-[var(--bg-card)] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      event.type === "deposit"
                        ? "bg-emerald-900/30 text-emerald-400"
                        : "bg-red-900/30 text-red-400"
                    }`}
                  >
                    {event.type === "deposit" ? "↓ DEPOSIT" : "↑ WITHDRAW"}
                  </span>
                  <span className="font-mono text-sm text-[var(--text-primary)]">
                    {truncateAddress(event.address)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-sm font-semibold text-[var(--text-primary)]">
                    {fmtNum(Number(BigInt(event.amount)) / 10_000_000)} tokens
                  </span>
                  {event.timestamp && (
                    <p className="text-xs text-[var(--text-secondary)]">
                      {new Date(event.timestamp).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </ChartCard>

      {/* ── Pool info footer ── */}
      <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border)] p-6">
        <h2 className="text-base font-semibold text-[var(--text-primary)] mb-4">Pool Info</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-[var(--text-secondary)]">Token: </span>
            <span className="font-mono text-[var(--text-primary)]">
              {truncateAddress(data.token, 8, 4)}
            </span>
          </div>
          <div>
            <span className="text-[var(--text-secondary)]">Threshold: </span>
            <span className="text-[var(--text-primary)]">
              {data.threshold} / {data.admins.length} admins
            </span>
          </div>
          <div>
            <span className="text-[var(--text-secondary)]">Created: </span>
            <span className="text-[var(--text-primary)]">Ledger {data.created_ledger}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({
  id,
  label,
  value,
  unit,
  icon,
  highlight,
  positive,
}: {
  id: string;
  label: string;
  value: string;
  unit: string;
  icon: string;
  highlight?: boolean;
  positive?: boolean;
}) {
  const valueColor =
    positive === true
      ? "text-emerald-400"
      : positive === false
        ? "text-red-400"
        : highlight
          ? "text-[var(--color-primary)]"
          : "text-[var(--text-primary)]";

  return (
    <div
      id={id}
      className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border)] p-4 flex flex-col gap-2"
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-[var(--text-secondary)] uppercase tracking-wide">
          {label}
        </p>
        <span className="text-lg" aria-hidden="true">{icon}</span>
      </div>
      <p className={`text-2xl font-bold truncate ${valueColor}`}>{value}</p>
      <p className="text-xs text-[var(--text-secondary)]">{unit}</p>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  summary,
  chartId,
  children,
  noPad,
}: {
  title: string;
  subtitle: string;
  summary: string;
  chartId: string;
  children: React.ReactNode;
  noPad?: boolean;
}) {
  return (
    <section
      className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border)] overflow-hidden"
      aria-labelledby={`${chartId}-title`}
    >
      <div className="px-6 pt-6 pb-4">
        <h2
          id={`${chartId}-title`}
          className="text-base font-semibold text-[var(--text-primary)]"
        >
          {title}
        </h2>
        <p className="text-xs text-[var(--text-secondary)] mt-0.5">{subtitle}</p>
      </div>

      {/* Chart area — role="img" with aria-label for screen readers */}
      <div
        role="img"
        aria-label={`${title} chart. ${summary}`}
        className={noPad ? "" : "px-2 pb-6"}
      >
        {children}
      </div>

      {/* Visually hidden text summary for screen readers */}
      <p className="sr-only">{summary}</p>
    </section>
  );
}

function EmptyChart() {
  return (
    <div className="flex items-center justify-center h-40 text-[var(--text-secondary)] text-sm">
      No data available for this range.
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <section className="space-y-6" aria-busy="true" aria-label="Loading analytics">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="animate-pulse bg-[var(--bg-secondary)] rounded-2xl p-4 h-28 border border-[var(--border)]" />
        ))}
      </div>
      <div className="animate-pulse bg-[var(--bg-secondary)] rounded-2xl h-80 border border-[var(--border)]" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[1, 2].map((i) => (
          <div key={i} className="animate-pulse bg-[var(--bg-secondary)] rounded-2xl h-72 border border-[var(--border)]" />
        ))}
      </div>
    </section>
  );
}

// ── Formatting ─────────────────────────────────────────────────────────────────

function fmtNum(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}
