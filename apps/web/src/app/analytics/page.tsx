"use client";

import { useEffect, useState, useCallback } from "react";
import { useWallet } from "@/hooks/useWallet";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  fetchPosts,
  fetchAttestation,
  computeAnalytics,
  generateCSV,
  dateRangeToLedgerRange,
  type AnalyticsData,
} from "@/lib/analytics";

type DateRange = 7 | 30 | 90;
type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "loaded"; data: AnalyticsData };

export default function AnalyticsPage() {
  const { address, connected } = useWallet();
  const [dateRange, setDateRange] = useState<DateRange>(30);
  const [state, setState] = useState<State>({ status: "loading" });
  const [exporting, setExporting] = useState(false);

  const loadData = useCallback(async () => {
    if (!connected || !address) {
      setState({ status: "empty" });
      return;
    }

    setState({ status: "loading" });
    try {
      const [posts, attestation] = await Promise.all([
        fetchPosts(address),
        fetchAttestation(address),
      ]);

      if (posts.length === 0) {
        setState({ status: "empty" });
        return;
      }

      const ledgerRange = dateRangeToLedgerRange(dateRange);
      const data = computeAnalytics(posts, attestation, ledgerRange);
      setState({ status: "loaded", data });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to load analytics",
      });
    }
  }, [address, connected, dateRange]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleExport = useCallback(() => {
    if (state.status !== "loaded") return;
    setExporting(true);
    try {
      const csv = generateCSV(state.data);
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `analytics-${address?.slice(0, 8)}-${dateRange}d.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [state, address, dateRange]);

  if (!connected || !address) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)]">
        <div className="max-w-6xl mx-auto p-4 md:p-8">
          <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--bg-tertiary)] p-12 text-center">
            <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-3">
              Creator Analytics
            </h1>
            <p className="text-[var(--text-muted)]">
              Connect your wallet to view your analytics dashboard.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">Creator Analytics</h1>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              Performance metrics for your content
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Date range selector */}
            <div className="flex rounded-xl border border-[var(--bg-tertiary)] overflow-hidden">
              {([7, 30, 90] as DateRange[]).map((d) => (
                <button
                  key={d}
                  onClick={() => setDateRange(d)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    dateRange === d
                      ? "bg-[var(--accent-coral)] text-white"
                      : "bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>

            {/* Export */}
            <button
              onClick={handleExport}
              disabled={state.status !== "loaded" || exporting}
              className="px-4 py-2 text-sm font-medium rounded-xl border border-[var(--bg-tertiary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50"
            >
              {exporting ? "Exporting..." : "Export CSV"}
            </button>
          </div>
        </div>

        {state.status === "loading" && (
          <div className="flex items-center justify-center py-24">
            <div className="animate-pulse flex flex-col items-center gap-4">
              <div className="h-8 w-48 bg-[var(--bg-tertiary)] rounded" />
              <div className="h-4 w-64 bg-[var(--bg-tertiary)] rounded" />
            </div>
          </div>
        )}

        {state.status === "error" && (
          <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--bg-tertiary)] p-12 text-center">
            <p className="text-[var(--error)] mb-4">{state.message}</p>
            <button
              onClick={loadData}
              className="px-6 py-2 rounded-xl bg-[var(--accent-coral)] text-white font-medium hover:opacity-90 transition-opacity"
            >
              Retry
            </button>
          </div>
        )}

        {state.status === "empty" && (
          <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--bg-tertiary)] p-12 text-center">
            <p className="text-[var(--text-muted)]">
              No analytics data available yet. Create posts to see your metrics.
            </p>
          </div>
        )}

        {state.status === "loaded" && <Dashboard data={state.data} />}
      </div>
    </div>
  );
}

function Dashboard({ data }: { data: AnalyticsData }) {
  const { summary, engagementOverTime, followerGrowth, tipEarnings, topPosts, attestation } = data;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <SummaryCard label="Total Tips" value={`${summary.totalTipsXlm} XLM`} />
        <SummaryCard label="Posts" value={String(summary.totalPosts)} />
        <SummaryCard label="Likes" value={String(summary.totalLikes)} />
        <SummaryCard label="Followers" value={String(summary.followerCount)} />
        <SummaryCard label="Unique Tippers" value={String(summary.uniqueTippers)} />
      </div>

      {/* Attestation badge */}
      {attestation && (
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] bg-[var(--bg-secondary)] px-4 py-2 rounded-xl border border-[var(--bg-tertiary)]">
          <span>✅ Verified by oracle</span>
          <span className="text-[var(--bg-tertiary)]">|</span>
          <span>
            Ledgers {attestation.report.windowStart}–{attestation.report.windowEnd}
          </span>
          <span className="text-[var(--bg-tertiary)]">|</span>
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${attestation.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent-teal)] hover:underline"
          >
            On-chain ↗
          </a>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Engagement over time */}
        <ChartCard title="Engagement Over Time" subtitle="Likes per day">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={engagementOverTime}>
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
                dataKey="likes"
                stroke="#FF6B5B"
                strokeWidth={2}
                dot={false}
                name="Likes"
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Follower growth */}
        <ChartCard title="Follower Growth" subtitle="Cumulative over time">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={followerGrowth}>
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
                dataKey="followers"
                stroke="#4ECDC4"
                strokeWidth={2}
                dot={false}
                name="Followers"
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Tip earnings */}
        <ChartCard title="Tip Earnings" subtitle="Tips per day (stroops)">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={tipEarnings}>
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
              <Bar dataKey="earnings" fill="#7c3aed" radius={[4, 4, 0, 0]} name="Tips" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Top posts */}
        <ChartCard title="Top Performing Posts" subtitle="Ranked by likes + tips">
          {topPosts.length === 0 ? (
            <p className="text-[var(--text-muted)] text-sm p-4">No posts yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--bg-tertiary)]">
                    <th className="text-left py-2 px-3 text-[var(--text-muted)] font-medium">#</th>
                    <th className="text-left py-2 px-3 text-[var(--text-muted)] font-medium">
                      Post
                    </th>
                    <th className="text-right py-2 px-3 text-[var(--text-muted)] font-medium">
                      Likes
                    </th>
                    <th className="text-right py-2 px-3 text-[var(--text-muted)] font-medium">
                      Tips
                    </th>
                    <th className="text-right py-2 px-3 text-[var(--text-muted)] font-medium">
                      Score
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topPosts.map((post, i) => (
                    <tr
                      key={post.id}
                      className="border-b border-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] transition-colors"
                    >
                      <td className="py-2 px-3 text-[var(--text-muted)]">{i + 1}</td>
                      <td className="py-2 px-3 text-[var(--text-primary)] font-mono">
                        <a
                          href={`/posts/${post.id}`}
                          className="hover:text-[var(--accent-teal)] transition-colors"
                        >
                          #{post.id}
                        </a>
                      </td>
                      <td className="py-2 px-3 text-right text-[var(--text-primary)]">
                        {post.likes}
                      </td>
                      <td className="py-2 px-3 text-right text-[var(--text-primary)]">
                        {post.tips}
                      </td>
                      <td className="py-2 px-3 text-right font-semibold text-[var(--accent-coral)]">
                        {post.score}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
      </div>

      {/* Top tippers */}
      <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--bg-tertiary)] p-6">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">Top Tippers</h3>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          {summary.uniqueTippers > 0
            ? `${summary.uniqueTippers} unique tippers in the selected period`
            : "No tippers yet"}
        </p>
        <div className="bg-[var(--bg-tertiary)] rounded-xl p-6 text-center">
          <p className="text-[var(--text-muted)] text-sm">
            Individual tipper details are available through the on-chain explorer. View your
            attestation transaction for verified tip data.
          </p>
          {attestation && (
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${attestation.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-3 px-4 py-2 text-sm font-medium rounded-xl border border-[var(--bg-tertiary)] text-[var(--accent-teal)] hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              View on Stellar Expert ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--bg-tertiary)] p-4">
      <p className="text-xs text-[var(--text-muted)] mb-1">{label}</p>
      <p className="text-xl font-bold text-[var(--text-primary)] truncate">{value}</p>
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
      <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">{title}</h3>
      <p className="text-sm text-[var(--text-muted)] mb-4">{subtitle}</p>
      {children}
    </div>
  );
}
