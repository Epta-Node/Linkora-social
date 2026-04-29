"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import type { PoolData, TokenMeta } from "../../hooks/usePools";
import { truncateAddress, formatTokenAmount } from "../../hooks/usePools";
import { ThresholdBadge } from "./ThresholdBadge";

interface PoolCardProps {
  pool: PoolData;
  tokenMeta: TokenMeta | null;
}

export function PoolCard({ pool, tokenMeta }: PoolCardProps) {
  const isEmpty = pool.balance === BigInt(0);
  const decimals = tokenMeta?.decimals ?? 7;
  const symbol = tokenMeta?.symbol ?? "TOKEN";
  const formattedBalance = formatTokenAmount(pool.balance, decimals);

  return (
    <Link href={`/pools/${pool.pool_id}`} style={styles.link} aria-label={`View pool ${pool.pool_id}`}>
      <article style={styles.card}>
        {/* Header row */}
        <div style={styles.header}>
          <div style={styles.idBlock}>
            <span style={styles.poolIcon} aria-hidden="true">🏦</span>
            <h3 style={styles.poolId}>{pool.pool_id}</h3>
          </div>
          <StatusBadge isEmpty={isEmpty} />
        </div>

        {/* Token address */}
        <div style={styles.tokenRow}>
          <span style={styles.tokenLabel}>Token</span>
          <span style={styles.tokenAddr} title={pool.token}>
            {symbol !== "TOKEN" ? (
              <>
                <span style={styles.tokenSymbol}>{symbol}</span>
                <span style={styles.tokenAddrMono}>{truncateAddress(pool.token)}</span>
              </>
            ) : (
              <span style={styles.tokenAddrMono}>{truncateAddress(pool.token)}</span>
            )}
          </span>
        </div>

        {/* Balance */}
        <div style={styles.balanceRow}>
          <span style={styles.balanceLabel}>Balance</span>
          <span style={{ ...styles.balanceValue, ...(isEmpty ? styles.balanceEmpty : {}) }}>
            {isEmpty ? "—" : `${formattedBalance} ${symbol}`}
          </span>
        </div>

        {/* Governance */}
        <div style={styles.govRow}>
          <ThresholdBadge threshold={pool.threshold} total={pool.admins.length} variant="compact" />
          <span style={styles.adminCount}>{pool.admins.length} admins</span>
        </div>

        {/* CTA */}
        <div style={styles.cta} aria-hidden="true">
          View details →
        </div>
      </article>
    </Link>
  );
}

function StatusBadge({ isEmpty }: { isEmpty: boolean }) {
  return (
    <span
      style={{
        ...styles.badge,
        ...(isEmpty ? styles.badgeEmpty : styles.badgeActive),
      }}
      aria-label={isEmpty ? "Pool status: Empty" : "Pool status: Active"}
    >
      <span
        style={{
          ...styles.badgeDot,
          background: isEmpty ? "var(--color-text-disabled)" : "var(--color-success)",
        }}
        aria-hidden="true"
      />
      {isEmpty ? "Empty" : "Active"}
    </span>
  );
}

export function PoolCardSkeleton() {
  return (
    <div style={styles.skeleton} aria-hidden="true">
      <div style={styles.skeletonHeader}>
        <div style={{ ...styles.skeletonLine, width: "40%" }} />
        <div style={{ ...styles.skeletonChip, width: "60px" }} />
      </div>
      <div style={{ ...styles.skeletonLine, width: "70%" }} />
      <div style={{ ...styles.skeletonLine, width: "55%" }} />
      <div style={{ ...styles.skeletonChip, width: "90px" }} />
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  link: {
    textDecoration: "none",
    color: "inherit",
    display: "block",
  },
  card: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-xl)",
    padding: "var(--space-6)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
    transition: "border-color 0.2s, box-shadow 0.2s, transform 0.15s",
    cursor: "pointer",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--space-2)",
  },
  idBlock: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    minWidth: 0,
  },
  poolIcon: {
    fontSize: "1.25rem",
    flexShrink: 0,
  },
  poolId: {
    margin: 0,
    fontSize: "var(--text-lg)",
    fontWeight: "var(--font-semibold)" as unknown as number,
    color: "var(--color-text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    padding: "0.2rem 0.6rem",
    borderRadius: "9999px",
    fontSize: "0.75rem",
    fontWeight: 600,
    flexShrink: 0,
  },
  badgeActive: {
    background: "#D1FAE5",
    color: "#065F46",
  },
  badgeEmpty: {
    background: "var(--color-surface-2)",
    color: "var(--color-text-secondary)",
  },
  badgeDot: {
    width: "6px",
    height: "6px",
    borderRadius: "50%",
    flexShrink: 0,
  },
  tokenRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--space-2)",
  },
  tokenLabel: {
    fontSize: "var(--text-sm)",
    color: "var(--color-text-secondary)",
    flexShrink: 0,
  },
  tokenAddr: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    minWidth: 0,
  },
  tokenSymbol: {
    fontSize: "var(--text-sm)",
    fontWeight: 600,
    color: "var(--color-secondary)",
    background: "var(--color-secondary-light)",
    padding: "0.1rem 0.4rem",
    borderRadius: "var(--radius-sm)",
    flexShrink: 0,
  },
  tokenAddrMono: {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-sm)",
    color: "var(--color-text-secondary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  balanceRow: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: "var(--space-2)",
  },
  balanceLabel: {
    fontSize: "var(--text-sm)",
    color: "var(--color-text-secondary)",
  },
  balanceValue: {
    fontSize: "var(--text-lg)",
    fontWeight: 700,
    color: "var(--color-text-primary)",
    fontFamily: "var(--font-mono)",
  },
  balanceEmpty: {
    color: "var(--color-text-disabled)",
    fontWeight: 400,
  },
  govRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--space-2)",
  },
  adminCount: {
    fontSize: "var(--text-sm)",
    color: "var(--color-text-secondary)",
  },
  cta: {
    fontSize: "var(--text-sm)",
    color: "var(--color-primary)",
    fontWeight: 600,
    marginTop: "var(--space-1)",
  },
  // Skeleton
  skeleton: {
    background: "var(--color-surface-1)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-xl)",
    padding: "var(--space-6)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
  },
  skeletonHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  skeletonLine: {
    height: "14px",
    borderRadius: "9999px",
    background: "linear-gradient(90deg, var(--color-surface-1) 0%, var(--color-surface-2) 50%, var(--color-surface-1) 100%)",
    backgroundSize: "200% 100%",
    animation: "shimmer 1.5s infinite",
  },
  skeletonChip: {
    height: "24px",
    borderRadius: "9999px",
    background: "linear-gradient(90deg, var(--color-surface-1) 0%, var(--color-surface-2) 50%, var(--color-surface-1) 100%)",
    backgroundSize: "200% 100%",
    animation: "shimmer 1.5s infinite",
  },
};
