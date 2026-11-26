"use client";

import { useState, useMemo, type CSSProperties } from "react";
import Link from "next/link";
import { useAllPools, useTokenMeta } from "@/hooks/usePools";
import { useWallet } from "@/hooks/useWallet";
import { PoolCard, PoolCardSkeleton } from "@/components/pools/PoolCard";
import { PoolEmptyState } from "@/components/pools/PoolEmptyState";
import type { PoolData } from "@/hooks/usePools";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PoolFilter = "all" | "open" | "token-gated" | "my-pools";
export type PoolSort = "newest" | "members" | "balance";

// ── Token meta wrapper per card ───────────────────────────────────────────────

function PoolCardWithMeta({ pool }: { pool: PoolData }) {
  const tokenMeta = useTokenMeta(pool.token);
  return <PoolCard pool={pool} tokenMeta={tokenMeta} />;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PoolsPage() {
  const { pools, state, error, isStale, refresh } = useAllPools();
  const { address, connected } = useWallet();

  const [filter, setFilter] = useState<PoolFilter>("all");
  const [sort, setSort] = useState<PoolSort>("newest");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredAndSortedPools = useMemo(() => {
    let result = [...pools];

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (p) =>
          p.pool_id.toLowerCase().includes(q) ||
          p.token.toLowerCase().includes(q) ||
          p.admins.some((a) => a.toLowerCase().includes(q))
      );
    }

    // Category / status filter
    if (filter === "open") {
      result = result.filter((p) => p.balance > BigInt(0));
    } else if (filter === "token-gated") {
      result = result.filter((p) => p.threshold > 1);
    } else if (filter === "my-pools") {
      if (connected && address) {
        result = result.filter((p) => p.admins.includes(address));
      } else {
        result = [];
      }
    }

    // Sorting
    if (sort === "members") {
      result.sort((a, b) => b.admins.length - a.admins.length);
    } else if (sort === "balance") {
      result.sort((a, b) => (b.balance > a.balance ? 1 : b.balance < a.balance ? -1 : 0));
    }

    return result;
  }, [pools, filter, sort, searchQuery, connected, address]);

  const clearFilters = () => {
    setFilter("all");
    setSort("newest");
    setSearchQuery("");
  };

  return (
    <main style={styles.main}>
      {/* Page header */}
      <header style={styles.header}>
        <div style={styles.headerText}>
          <h1 style={styles.title}>Community Pools</h1>
          <p style={styles.subtitle}>M-of-N multisig treasury pools governed by admin sets</p>
        </div>
        <div style={styles.headerActions}>
          <button
            type="button"
            onClick={refresh}
            disabled={state === "loading"}
            style={styles.refreshBtn}
            aria-label="Refresh pool list"
          >
            {state === "loading" ? "⏳ Refreshing..." : "↻ Refresh"}
          </button>
          <Link href="/pools/new" style={styles.createBtn} aria-label="Create new pool">
            + Create Pool
          </Link>
        </div>
      </header>

      {/* Error state */}
      {state === "error" && (
        <div style={styles.errorBanner} role="alert">
          <span aria-hidden="true">⚠️</span>
          <span>{error ?? "Failed to load pools"}</span>
          <button onClick={refresh} style={styles.retryBtn} aria-label="Retry loading pools">
            Retry
          </button>
        </div>
      )}

      {/* Stale data indicator */}
      {isStale && pools.length > 0 && (
        <div style={styles.staleWarning} role="status">
          <span aria-hidden="true">⚠️</span>
          <span>Showing cached data. Unable to reach indexer.</span>
          <button onClick={refresh} style={styles.retryBtn} aria-label="Retry loading fresh data">
            Retry
          </button>
        </div>
      )}

      {/* Controls Bar: Filter, Search, Sort */}
      {pools.length > 0 && (
        <section style={styles.controlsBar} aria-label="Pool discovery filters">
          {/* Filter chips */}
          <div style={styles.filterGroup} role="group" aria-label="Filter pools">
            {(
              [
                { id: "all", label: "All" },
                { id: "open", label: "Open" },
                { id: "token-gated", label: "Token-gated" },
                { id: "my-pools", label: "My pools" },
              ] as const
            ).map((tab) => {
              const active = filter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  style={{
                    ...styles.filterChip,
                    ...(active ? styles.filterChipActive : {}),
                  }}
                  onClick={() => setFilter(tab.id)}
                  aria-pressed={active}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div style={styles.searchAndSort}>
            {/* Search input */}
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search pools or admins..."
              style={styles.searchInput}
              aria-label="Search pools"
            />

            {/* Sort dropdown */}
            <div style={styles.sortContainer}>
              <label htmlFor="pool-sort-select" style={styles.sortLabel}>
                Sort:
              </label>
              <select
                id="pool-sort-select"
                value={sort}
                onChange={(e) => setSort(e.target.value as PoolSort)}
                style={styles.sortSelect}
                aria-label="Sort pools"
              >
                <option value="newest">Newest</option>
                <option value="members">Most members</option>
                <option value="balance">Highest balance</option>
              </select>
            </div>
          </div>
        </section>
      )}

      {/* Loading skeletons */}
      {state === "loading" && pools.length === 0 && (
        <div style={styles.grid} aria-busy="true" aria-label="Loading pools">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <PoolCardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Initial empty state (no pools at all) */}
      {state === "success" && pools.length === 0 && <PoolEmptyState variant="no-pools" />}

      {/* Filtered empty state */}
      {pools.length > 0 && filteredAndSortedPools.length === 0 && (
        <div style={styles.filteredEmptyState} role="status">
          <p style={styles.filteredEmptyText}>
            {filter === "my-pools" && !connected
              ? "Connect your wallet to view pools you administer."
              : "No pools match the selected filters."}
          </p>
          <button type="button" onClick={clearFilters} style={styles.clearFiltersBtn}>
            Clear filters
          </button>
        </div>
      )}

      {/* Pool grid */}
      {filteredAndSortedPools.length > 0 && (
        <>
          <p style={styles.count} aria-live="polite" role="status">
            {filteredAndSortedPools.length} pool{filteredAndSortedPools.length !== 1 ? "s" : ""}{" "}
            found
            {isStale && " (cached)"}
          </p>
          <div style={styles.grid}>
            {filteredAndSortedPools.map((pool) => (
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
    padding: "var(--space-6) var(--space-4) var(--space-8)",
  },
  header: {
    maxWidth: "1100px",
    margin: "0 auto var(--space-6)",
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
    flexWrap: "wrap" as const,
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
  controlsBar: {
    maxWidth: "1100px",
    margin: "0 auto var(--space-6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--space-4)",
    flexWrap: "wrap" as const,
  },
  filterGroup: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    flexWrap: "wrap" as const,
  },
  filterChip: {
    padding: "var(--space-1) var(--space-3)",
    borderRadius: "var(--radius-full)",
    border: "1px solid var(--color-border)",
    background: "var(--color-bg)",
    color: "var(--color-text-secondary)",
    fontSize: "var(--text-sm)",
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.15s ease",
    minHeight: "36px",
  },
  filterChipActive: {
    background: "var(--color-primary)",
    border: "1px solid var(--color-primary)",
    color: "white",
    fontWeight: 600,
  },
  searchAndSort: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-3)",
    flexWrap: "wrap" as const,
  },
  searchInput: {
    padding: "var(--space-2) var(--space-3)",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--color-border)",
    background: "var(--color-bg)",
    color: "var(--color-text-primary)",
    fontSize: "var(--text-sm)",
    minWidth: "220px",
    height: "36px",
  },
  sortContainer: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
  },
  sortLabel: {
    fontSize: "var(--text-sm)",
    color: "var(--color-text-secondary)",
    fontWeight: 500,
  },
  sortSelect: {
    padding: "var(--space-1) var(--space-3)",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--color-border)",
    background: "var(--color-bg)",
    color: "var(--color-text-primary)",
    fontSize: "var(--text-sm)",
    height: "36px",
    cursor: "pointer",
  },
  filteredEmptyState: {
    maxWidth: "1100px",
    margin: "var(--space-12) auto",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "var(--space-4)",
  },
  filteredEmptyText: {
    fontSize: "var(--text-base)",
    color: "var(--color-text-secondary)",
    margin: 0,
  },
  clearFiltersBtn: {
    padding: "var(--space-2) var(--space-4)",
    background: "var(--color-surface-2)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
    color: "var(--color-primary)",
    fontSize: "var(--text-sm)",
    fontWeight: 600,
    cursor: "pointer",
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
  staleWarning: {
    maxWidth: "1100px",
    margin: "0 auto var(--space-6)",
    display: "flex",
    alignItems: "center",
    gap: "var(--space-3)",
    padding: "var(--space-4)",
    background: "#fef3c7",
    border: "1px solid #f59e0b",
    borderRadius: "var(--radius-lg)",
    color: "#92400e",
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
