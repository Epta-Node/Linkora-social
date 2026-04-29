"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useAllPools, useTokenMeta } from "../hooks/usePools";
import { PoolCard, PoolCardSkeleton } from "../components/pools/PoolCard";
import { PoolEmptyState } from "../components/pools/PoolEmptyState";
import type { PoolData, TokenMeta } from "../hooks/usePools";

// ── Token meta wrapper per card ───────────────────────────────────────────────

function PoolCardWithMeta({ pool }: { pool: PoolData }) {
  const tokenMeta = useTokenMeta(pool.token);
  return <PoolCard pool={pool} tokenMeta={tokenMeta} />;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PoolsPage() {
  const { pools, state, error, refresh } = useAllPools();

  return (
    <main style={styles.main}>
      {/* Page header */}
      <header style={styles.header}>
        <div style={styles.headerText}>
          <h1 style={styles.title}>Community Pools</h1>
          <p style={styles.subtitle}>
            M-of-N multisig treasury pools governed by admin sets
          </p>
        </div>
        <div style={styles.headerActions}>
          <button
            onClick={refresh}
            disabled={state === "loading"}
            style={styles.refreshBtn}
            aria-label="Refresh pool list"
          >
            {state === "loading" ? "⏳" : "↻"} Refresh
          </button>
          <Link href="/pools/new" style={styles.createBtn}>
            + Create Pool
          </Link>
        </div>
      </header>

      {/* Error state */}
      {state === "error" && (
        <div style={styles.errorBanner} role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>{error ?? "Failed to load pools"}</span>
          <button onClick={refresh} style={styles.retryBtn}>
            Retry
          </button>
        </div>
      )}

      {/* Loading skeletons */}
      {state === "loading" && (
        <div style={styles.grid} aria-busy="true" aria-label="Loading pools">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <PoolCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {state === "success" && pools.length === 0 && (
        <PoolEmptyState variant="no-pools" />
      )}

      {/* Pool grid */}
      {state === "success" && pools.length > 0 && (
        <>
          <p style={styles.count} aria-live="polite">
            {pools.length} pool{pools.length !== 1 ? "s" : ""} found
          </p>
          <div style={styles.grid}>
            {pools.map((pool) => (
              <PoolCardWithMeta key={pool.pool_id} pool={pool} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  main: {
    minHeight: "100vh",
    background: "var(--color-surface-1)",
    padding: "var(--space-8) var(--space-4)",
  },
  header: {
    maxWidth: "1100px",
    margin: "0 auto var(--space-8)",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "var(--space-4)",
    flexWrap: "wrap" as const,
  },
  headerText: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-1)",
  },
  title: {
    margin: 0,
    fontSize: "var(--text-3xl)",
    fontWeight: 700,
    color: "var(--color-text-primary)",
  },
  subtitle: {
    margin: 0,
    fontSize: "var(--text-base)",
    color: "var(--color-text-secondary)",
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-3)",
    flexShrink: 0,
  },
  refreshBtn: {
    padding: "var(--space-2) var(--space-4)",
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-lg)",
    fontSize: "var(--text-sm)",
    fontWeight: 500,
    color: "var(--color-text-secondary)",
    cursor: "pointer",
    minHeight: "44px",
    transition: "border-color 0.2s",
  },
  createBtn: {
    padding: "var(--space-2) var(--space-5)",
    background: "var(--color-primary)",
    color: "white",
    borderRadius: "var(--radius-lg)",
    fontWeight: 700,
    fontSize: "var(--text-sm)",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    minHeight: "44px",
    transition: "background 0.2s",
  },
  errorBanner: {
    maxWidth: "1100px",
    margin: "0 auto var(--space-6)",
    display: "flex",
    alignItems: "center",
    gap: "var(--space-3)",
    padding: "var(--space-4)",
    background: "var(--color-error-light)",
    border: "1px solid var(--color-error)",
    borderRadius: "var(--radius-lg)",
    color: "#991b1b",
    fontSize: "var(--text-sm)",
  },
  retryBtn: {
    marginLeft: "auto",
    padding: "var(--space-1) var(--space-3)",
    border: "1px solid currentColor",
    borderRadius: "var(--radius-md)",
    background: "none",
    color: "inherit",
    fontWeight: 600,
    fontSize: "var(--text-sm)",
    cursor: "pointer",
    minHeight: "auto",
    minWidth: "auto",
  },
  count: {
    maxWidth: "1100px",
    margin: "0 auto var(--space-4)",
    fontSize: "var(--text-sm)",
    color: "var(--color-text-secondary)",
  },
  grid: {
    maxWidth: "1100px",
    margin: "0 auto",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
    gap: "var(--space-4)",
  },
};
