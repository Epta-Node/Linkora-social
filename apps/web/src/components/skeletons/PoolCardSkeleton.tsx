import type { CSSProperties } from "react";
import { Skeleton, cx } from "./Skeleton";

export interface PoolCardSkeletonProps {
  className?: string;
}

/**
 * Mirrors `<PoolCard />`: same shell (background, border, radius, padding and
 * column gap) and the same five rows — header, token, balance, governance and
 * call-to-action — so the grid keeps its dimensions while pools load.
 */
export function PoolCardSkeleton({ className }: PoolCardSkeletonProps) {
  return (
    <div
      data-testid="pool-card-skeleton"
      aria-hidden="true"
      className={cx(className)}
      style={styles.card}
    >
      {/* Header: pool id + status badge */}
      <div style={styles.row}>
        <Skeleton width="45%" height="1.375rem" radius="var(--radius-full)" />
        <Skeleton width="60px" height="1.5rem" radius="var(--radius-full)" />
      </div>

      {/* Token: label + address */}
      <div style={styles.row}>
        <Skeleton width="3rem" height="1.25rem" radius="var(--radius-full)" />
        <Skeleton width="7rem" height="1.25rem" radius="var(--radius-full)" />
      </div>

      {/* Balance: label + amount */}
      <div style={styles.row}>
        <Skeleton width="3.5rem" height="1.25rem" radius="var(--radius-full)" />
        <Skeleton width="7.5rem" height="1.375rem" radius="var(--radius-full)" />
      </div>

      {/* Governance: threshold badge + admin count */}
      <div style={styles.row}>
        <Skeleton width="5.5rem" height="1.5rem" radius="var(--radius-full)" />
        <Skeleton width="4.5rem" height="1.25rem" radius="var(--radius-full)" />
      </div>

      {/* CTA */}
      <Skeleton width="6.5rem" height="1.25rem" radius="var(--radius-full)" />
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
    padding: "var(--space-6)",
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-xl)",
  },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--space-2)",
  },
};
