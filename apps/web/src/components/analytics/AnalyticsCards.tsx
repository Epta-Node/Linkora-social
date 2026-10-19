"use client";

import type { ReactNode } from "react";

/**
 * Card shells shared by the analytics dashboard and its loading skeleton
 * (#1635). Both render through the same components with the same titles, so
 * the skeleton occupies exactly the space the loaded dashboard will.
 */

export const SUMMARY_LABELS = [
  "Total Tips",
  "Posts",
  "Likes",
  "Followers",
  "Unique Tippers",
] as const;

export const CHARTS = {
  engagement: { title: "Engagement Over Time", subtitle: "Likes per day" },
  followers: { title: "Follower Growth", subtitle: "Cumulative over time" },
  tips: { title: "Tip Earnings", subtitle: "Tips per day (stroops)" },
  topPosts: { title: "Top Performing Posts", subtitle: "Ranked by likes + tips" },
} as const;

/** Height of every chart; skeletons reserve exactly this space (#1635). */
export const CHART_HEIGHT = 300;
const TOP_POSTS_SKELETON_ROWS = 5;

function SkeletonBar({ className }: { className: string }) {
  return (
    <span aria-hidden="true" className={`block rounded bg-[var(--bg-tertiary)] ${className}`} />
  );
}

/**
 * Placeholder for the dashboard while analytics load (#1635). It reuses the
 * real card shells with their real titles, and each placeholder occupies the
 * same box as the content it replaces (value line height, 300px chart area,
 * table rows), so nothing moves when the data arrives.
 */
export function DashboardSkeleton() {
  return (
    <div
      className="space-y-6 animate-pulse"
      role="status"
      aria-busy="true"
      aria-label="Loading analytics"
      data-testid="analytics-skeleton"
    >
      <span className="sr-only">Loading analytics…</span>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4" data-testid="skeleton-summary">
        {SUMMARY_LABELS.map((label) => (
          <SummaryCard key={label} label={label} value={<SkeletonBar className="h-7 w-2/3" />} />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {(["engagement", "followers", "tips"] as const).map((key) => (
          <ChartCard key={key} {...CHARTS[key]}>
            <div data-testid={`skeleton-chart-${key}`} style={{ height: CHART_HEIGHT }}>
              <SkeletonBar className="h-full w-full" />
            </div>
          </ChartCard>
        ))}

        <ChartCard {...CHARTS.topPosts}>
          <div data-testid="skeleton-top-posts" className="space-y-0">
            <div className="flex items-center gap-3 border-b border-[var(--bg-tertiary)] py-2 px-3">
              <SkeletonBar className="h-5 w-full" />
            </div>
            {Array.from({ length: TOP_POSTS_SKELETON_ROWS }, (_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 border-b border-[var(--bg-tertiary)] py-2 px-3"
              >
                <SkeletonBar className="h-5 w-6" />
                <SkeletonBar className="h-5 flex-1" />
                <SkeletonBar className="h-5 w-10" />
                <SkeletonBar className="h-5 w-10" />
                <SkeletonBar className="h-5 w-12" />
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      <div
        className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--bg-tertiary)] p-6"
        data-testid="skeleton-top-tippers"
      >
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">Top Tippers</h3>
        <SkeletonBar className="h-5 w-56 mb-4" />
        <div className="bg-[var(--bg-tertiary)] rounded-xl p-6">
          <SkeletonBar className="h-10 w-full bg-[var(--bg-secondary)]" />
        </div>
      </div>
    </div>
  );
}

export function SummaryCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--bg-tertiary)] p-4">
      <p className="text-xs text-[var(--text-muted)] mb-1">{label}</p>
      <div className="text-xl font-bold text-[var(--text-primary)] truncate">{value}</div>
    </div>
  );
}

export function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--bg-tertiary)] p-6">
      <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">{title}</h3>
      <p className="text-sm text-[var(--text-muted)] mb-4">{subtitle}</p>
      {children}
    </div>
  );
}
