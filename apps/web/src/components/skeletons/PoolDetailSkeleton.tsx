import type { CSSProperties } from "react";
import { Skeleton, cx } from "./Skeleton";

export interface PoolDetailSkeletonProps {
  className?: string;
}

/**
 * Loading placeholder for `/pools/[id]` (#1852).
 *
 * Mirrors the real page section by section — breadcrumb, header, the stats
 * card (balance row), the admin card (threshold + admin list) and the
 * deposit/withdraw tab panel — using the same shells, paddings and grid so the
 * layout does not jump when data arrives.
 *
 * Each section is its own block with a staggered `animation-delay`, so the
 * balance, admins, threshold and tabs shimmer independently rather than as one
 * slab. Motion still comes from the `--skeleton-*` tokens and pauses under
 * `prefers-reduced-motion`.
 */
export function PoolDetailSkeleton({ className }: PoolDetailSkeletonProps) {
  return (
    <div
      data-testid="pool-detail-skeleton"
      role="status"
      aria-busy="true"
      aria-label="Loading pool details"
      className={cx(className)}
      style={styles.container}
    >
      {/* Breadcrumb */}
      <div style={styles.breadcrumb} aria-hidden="true">
        <Skeleton width="2.75rem" height="0.875rem" radius="var(--radius-full)" />
        <Skeleton width="0.5rem" height="0.875rem" radius="var(--radius-full)" />
        <Skeleton width="6rem" height="0.875rem" radius="var(--radius-full)" />
      </div>

      {/* Page header: icon + title/meta, refresh + analytics actions */}
      <div style={styles.pageHeader} aria-hidden="true" data-testid="pool-skeleton-header">
        <div style={styles.pageHeaderLeft}>
          <Skeleton width="3rem" height="3rem" radius="var(--radius-full)" />
          <div style={styles.titleBlock}>
            <Skeleton width="10rem" height="1.875rem" radius="var(--radius-full)" />
            <div style={styles.metaRow}>
              <Skeleton width="4rem" height="1.375rem" radius="var(--radius-full)" />
              <Skeleton width="4.5rem" height="1.375rem" radius="var(--radius-full)" />
            </div>
          </div>
        </div>
        <div style={styles.headerActions}>
          <Skeleton width="6.5rem" height="44px" radius="var(--radius-lg)" />
          <Skeleton width="7.5rem" height="44px" radius="var(--radius-lg)" />
        </div>
      </div>

      <div style={styles.dashboard} data-layout="pool-dashboard" aria-hidden="true">
        <div style={styles.leftCol}>
          {/* Stats card */}
          <div style={styles.card}>
            <Skeleton width="6rem" height="1.25rem" radius="var(--radius-full)" />

            <div style={styles.statRow} data-testid="pool-skeleton-balance">
              <Skeleton width="3.5rem" height="1rem" radius="var(--radius-full)" style={delay(0)} />
              <Skeleton
                width="8.5rem"
                height="1.25rem"
                radius="var(--radius-full)"
                style={delay(0)}
              />
            </div>

            <div style={styles.statRow}>
              <Skeleton width="3rem" height="1rem" radius="var(--radius-full)" />
              <Skeleton width="7rem" height="1rem" radius="var(--radius-full)" />
            </div>

            <div style={{ ...styles.statRow, ...styles.statRowLast }}>
              <Skeleton width="3.5rem" height="1rem" radius="var(--radius-full)" />
              <Skeleton width="6rem" height="1.25rem" radius="var(--radius-sm)" />
            </div>
          </div>

          {/* Admin card: title, governance threshold bar, admin rows */}
          <div style={styles.card}>
            <Skeleton width="4.5rem" height="1.25rem" radius="var(--radius-full)" />

            <div style={styles.threshold} data-testid="pool-skeleton-threshold">
              <div style={styles.thresholdHeader}>
                <Skeleton
                  width="9rem"
                  height="0.875rem"
                  radius="var(--radius-full)"
                  style={delay(1)}
                />
                <Skeleton
                  width="5rem"
                  height="0.875rem"
                  radius="var(--radius-full)"
                  style={delay(1)}
                />
              </div>
              <Skeleton width="100%" height="0.5rem" radius="var(--radius-full)" style={delay(1)} />
            </div>

            <ul style={styles.adminList} data-testid="pool-skeleton-admins">
              {[0, 1, 2].map((i) => (
                <li key={i} style={styles.adminRow} data-testid="pool-skeleton-admin-row">
                  <Skeleton
                    width="2rem"
                    height="2rem"
                    radius="var(--radius-full)"
                    style={delay(2)}
                  />
                  <Skeleton
                    width="9rem"
                    height="0.875rem"
                    radius="var(--radius-full)"
                    style={delay(2)}
                  />
                  <Skeleton
                    width="1.5rem"
                    height="0.875rem"
                    radius="var(--radius-full)"
                    style={{ ...delay(2), marginLeft: "auto" }}
                  />
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Right column: deposit / withdraw tabs + form panel */}
        <div style={styles.rightCol} data-testid="pool-skeleton-tabs">
          <div style={styles.tabBar}>
            {[0, 1].map((i) => (
              <div key={i} style={styles.tab}>
                <Skeleton
                  width="6rem"
                  height="1.125rem"
                  radius="var(--radius-full)"
                  style={delay(3)}
                />
              </div>
            ))}
          </div>
          <div style={styles.tabPanel}>
            <Skeleton width="7rem" height="1rem" radius="var(--radius-full)" style={delay(3)} />
            <Skeleton width="100%" height="2.75rem" radius="var(--radius-lg)" style={delay(3)} />
            <Skeleton width="60%" height="0.875rem" radius="var(--radius-full)" style={delay(3)} />
            <Skeleton width="100%" height="2.75rem" radius="var(--radius-lg)" style={delay(3)} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Staggers each section's shimmer so neighbouring blocks never pulse in
 * lockstep. A negative delay starts the animation mid-cycle immediately
 * instead of holding the block still before its first frame.
 */
function delay(step: number): CSSProperties {
  return { animationDelay: `calc(var(--skeleton-shimmer-duration, 1.5s) * ${step} * -0.25)` };
}

// Shells, paddings and gaps mirror the `styles` map in app/pools/[id]/page.tsx.
const styles: Record<string, CSSProperties> = {
  container: {
    maxWidth: "1100px",
    margin: "0 auto",
    padding: "var(--space-8) var(--space-4)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-6)",
  },
  breadcrumb: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
  },
  pageHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "var(--space-4)",
    flexWrap: "wrap",
  },
  pageHeaderLeft: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-4)",
  },
  titleBlock: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-2)",
  },
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
  },
  headerActions: {
    display: "flex",
    gap: "var(--space-4)",
  },
  dashboard: {
    display: "grid",
    gridTemplateColumns: "340px 1fr",
    gap: "var(--space-6)",
    alignItems: "start",
  },
  leftCol: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
  },
  card: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-xl)",
    padding: "var(--space-6)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
  },
  statRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "var(--space-2)",
    paddingBottom: "var(--space-3)",
    borderBottom: "1px solid var(--color-border)",
  },
  statRowLast: {
    borderBottom: "none",
    paddingBottom: 0,
  },
  threshold: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-2)",
  },
  thresholdHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: "var(--space-2)",
  },
  adminList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-3)",
  },
  adminRow: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-3)",
  },
  rightCol: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-xl)",
    overflow: "hidden",
  },
  tabBar: {
    display: "flex",
    borderBottom: "1px solid var(--color-border)",
  },
  tab: {
    flex: 1,
    minHeight: "52px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "var(--space-4)",
  },
  tabPanel: {
    padding: "var(--space-6)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
  },
};
