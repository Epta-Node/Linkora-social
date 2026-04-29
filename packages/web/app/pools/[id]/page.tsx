"use client";

import { useState, type CSSProperties } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { usePool, useTokenMeta, formatTokenAmount, truncateAddress } from "../../hooks/usePools";
import { useWallet } from "../../components/WalletProvider";
import { AdminList } from "../../components/pools/AdminList";
import { ThresholdBadge } from "../../components/pools/ThresholdBadge";
import { DepositTab } from "../../components/pools/DepositTab";
import { WithdrawTab } from "../../components/pools/WithdrawTab";
import { PoolEmptyState } from "../../components/pools/PoolEmptyState";

// ── Config ────────────────────────────────────────────────────────────────────
// TODO: import from packages/web/src/config.ts once env is wired
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ID ?? "PLACEHOLDER_CONTRACT_ID";

type Tab = "deposit" | "withdraw";

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PoolDetailPage() {
  const params = useParams();
  const poolId = typeof params.id === "string" ? params.id : null;
  const { publicKey, isConnected } = useWallet();
  const { pool, state, error, refresh } = usePool(poolId);
  const tokenMeta = useTokenMeta(pool?.token ?? null);
  const [activeTab, setActiveTab] = useState<Tab>("deposit");

  const decimals = tokenMeta?.decimals ?? 7;
  const symbol = tokenMeta?.symbol ?? "TOKEN";
  const isEmpty = pool ? pool.balance === BigInt(0) : false;
  const isAdmin = pool && publicKey
    ? pool.admins.some((a) => a === publicKey)
    : false;

  // ── Loading ───────────────────────────────────────────────────────────────

  if (state === "loading") {
    return (
      <main style={styles.main}>
        <PoolDetailSkeleton />
      </main>
    );
  }

  // ── Error / Not found ─────────────────────────────────────────────────────

  if (state === "error" || (state === "success" && !pool)) {
    return (
      <main style={styles.main}>
        <div style={styles.container}>
          <Link href="/pools" style={styles.back}>← Back to pools</Link>
          <PoolEmptyState variant="not-found" poolId={poolId ?? ""} />
        </div>
      </main>
    );
  }

  if (!pool) return null;

  return (
    <main style={styles.main}>
      <div style={styles.container}>
        {/* Breadcrumb */}
        <nav style={styles.breadcrumb} aria-label="Breadcrumb">
          <Link href="/pools" style={styles.breadcrumbLink}>Pools</Link>
          <span style={styles.breadcrumbSep} aria-hidden="true">/</span>
          <span style={styles.breadcrumbCurrent}>{pool.pool_id}</span>
        </nav>

        {/* Page header */}
        <header style={styles.pageHeader}>
          <div style={styles.pageHeaderLeft}>
            <div style={styles.poolIconLarge} aria-hidden="true">🏦</div>
            <div>
              <h1 style={styles.poolTitle}>{pool.pool_id}</h1>
              <div style={styles.poolMeta}>
                <StatusBadge isEmpty={isEmpty} />
                <ThresholdBadge
                  threshold={pool.threshold}
                  total={pool.admins.length}
                  variant="compact"
                />
                {isAdmin && (
                  <span style={styles.adminBadge}>Admin</span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={() => refresh()}
            style={styles.refreshBtn}
            aria-label="Refresh pool data"
          >
            ↻ Refresh
          </button>
        </header>

        {/* Dashboard layout: left stats + right tabs */}
        <div style={styles.dashboard} data-layout="pool-dashboard">
          {/* ── Left column ── */}
          <aside style={styles.leftCol}>
            {/* Stats card */}
            <div style={styles.statsCard}>
              <h2 style={styles.cardTitle}>Pool Stats</h2>

              <div style={styles.statRow}>
                <span style={styles.statLabel}>Balance</span>
                <span style={{ ...styles.statValue, ...(isEmpty ? styles.statValueEmpty : {}) }}>
                  {isEmpty ? "—" : `${formatTokenAmount(pool.balance, decimals)} ${symbol}`}
                </span>
              </div>

              {isEmpty && (
                <div style={styles.emptyBalanceNote}>
                  <PoolEmptyState variant="zero-balance" />
                </div>
              )}

              <div style={styles.statRow}>
                <span style={styles.statLabel}>Token</span>
                <div style={styles.tokenInfo}>
                  {tokenMeta && (
                    <span style={styles.tokenSymbolBadge}>{tokenMeta.symbol}</span>
                  )}
                  <span style={styles.tokenAddr} title={pool.token}>
                    {truncateAddress(pool.token)}
                  </span>
                  <a
                    href={`https://stellar.expert/explorer/testnet/contract/${pool.token}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={styles.expertLink}
                    aria-label="View token on Stellar Expert"
                  >
                    ↗
                  </a>
                </div>
              </div>

              {tokenMeta && (
                <div style={styles.statRow}>
                  <span style={styles.statLabel}>Token name</span>
                  <span style={styles.statValue}>{tokenMeta.name}</span>
                </div>
              )}

              <div style={styles.statRow}>
                <span style={styles.statLabel}>Pool ID</span>
                <code style={styles.poolIdCode}>{pool.pool_id}</code>
              </div>
            </div>

            {/* Admin list */}
            <div style={styles.adminCard}>
              <AdminList
                admins={pool.admins}
                threshold={pool.threshold}
                currentUser={publicKey}
              />
            </div>
          </aside>

          {/* ── Right column ── */}
          <section style={styles.rightCol} aria-label="Pool actions">
            {!isConnected ? (
              <div style={styles.walletGate}>
                <span style={styles.walletIcon} aria-hidden="true">🔒</span>
                <p style={styles.walletTitle}>Connect wallet to interact</p>
                <p style={styles.walletBody}>
                  Connect Freighter to deposit or withdraw from this pool.
                </p>
              </div>
            ) : (
              <>
                {/* Tab bar */}
                <div style={styles.tabBar} role="tablist" aria-label="Pool actions">
                  <button
                    role="tab"
                    aria-selected={activeTab === "deposit"}
                    aria-controls="tab-panel-deposit"
                    id="tab-deposit"
                    onClick={() => setActiveTab("deposit")}
                    style={{
                      ...styles.tab,
                      ...(activeTab === "deposit" ? styles.tabActive : {}),
                    }}
                  >
                    ↓ Deposit
                  </button>
                  <button
                    role="tab"
                    aria-selected={activeTab === "withdraw"}
                    aria-controls="tab-panel-withdraw"
                    id="tab-withdraw"
                    onClick={() => setActiveTab("withdraw")}
                    style={{
                      ...styles.tab,
                      ...(activeTab === "withdraw" ? styles.tabActive : {}),
                      ...(activeTab === "withdraw" ? styles.tabActiveWithdraw : {}),
                    }}
                  >
                    ↑ Withdraw
                    {!isAdmin && (
                      <span style={styles.tabLock} aria-label="Admin only" title="Admin only">
                        🔒
                      </span>
                    )}
                  </button>
                </div>

                {/* Tab panels */}
                <div
                  id="tab-panel-deposit"
                  role="tabpanel"
                  aria-labelledby="tab-deposit"
                  hidden={activeTab !== "deposit"}
                  style={styles.tabPanel}
                >
                  {activeTab === "deposit" && publicKey && (
                    <DepositTab
                      pool={pool}
                      tokenMeta={tokenMeta}
                      currentUser={publicKey}
                      contractAddress={CONTRACT_ADDRESS}
                      onSuccess={refresh}
                    />
                  )}
                </div>

                <div
                  id="tab-panel-withdraw"
                  role="tabpanel"
                  aria-labelledby="tab-withdraw"
                  hidden={activeTab !== "withdraw"}
                  style={styles.tabPanel}
                >
                  {activeTab === "withdraw" && publicKey && (
                    <WithdrawTab
                      pool={pool}
                      tokenMeta={tokenMeta}
                      currentUser={publicKey}
                      onSuccess={refresh}
                    />
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ isEmpty }: { isEmpty: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.3rem",
        padding: "0.2rem 0.6rem",
        borderRadius: "9999px",
        fontSize: "0.75rem",
        fontWeight: 600,
        background: isEmpty ? "var(--color-surface-2)" : "#D1FAE5",
        color: isEmpty ? "var(--color-text-secondary)" : "#065F46",
      }}
    >
      <span
        style={{
          width: "6px",
          height: "6px",
          borderRadius: "50%",
          background: isEmpty ? "var(--color-text-disabled)" : "var(--color-success)",
          display: "inline-block",
        }}
        aria-hidden="true"
      />
      {isEmpty ? "Empty" : "Active"}
    </span>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function PoolDetailSkeleton() {
  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "var(--space-8) var(--space-4)" }}>
      <div style={{ width: "120px", height: "14px", borderRadius: "9999px", background: "var(--color-surface-2)", marginBottom: "var(--space-6)" }} />
      <div style={{ display: "flex", gap: "var(--space-4)", marginBottom: "var(--space-8)", alignItems: "center" }}>
        <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: "var(--color-surface-2)" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <div style={{ width: "160px", height: "24px", borderRadius: "9999px", background: "var(--color-surface-2)" }} />
          <div style={{ width: "100px", height: "16px", borderRadius: "9999px", background: "var(--color-surface-2)" }} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr", gap: "var(--space-6)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ height: "80px", borderRadius: "var(--radius-xl)", background: "var(--color-surface-2)" }} />
          ))}
        </div>
        <div style={{ height: "400px", borderRadius: "var(--radius-xl)", background: "var(--color-surface-2)" }} />
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, CSSProperties> = {
  main: {
    minHeight: "100vh",
    background: "var(--color-surface-1)",
  },
  container: {
    maxWidth: "1100px",
    margin: "0 auto",
    padding: "var(--space-8) var(--space-4)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-6)",
  },
  back: {
    fontSize: "var(--text-sm)",
    color: "var(--color-text-secondary)",
    textDecoration: "none",
    fontWeight: 500,
  },
  breadcrumb: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    fontSize: "var(--text-sm)",
  },
  breadcrumbLink: {
    color: "var(--color-primary)",
    textDecoration: "none",
    fontWeight: 500,
  },
  breadcrumbSep: {
    color: "var(--color-text-disabled)",
  },
  breadcrumbCurrent: {
    color: "var(--color-text-secondary)",
    fontWeight: 500,
  },
  pageHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "var(--space-4)",
    flexWrap: "wrap" as const,
  },
  pageHeaderLeft: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-4)",
  },
  poolIconLarge: {
    fontSize: "2.5rem",
    flexShrink: 0,
  },
  poolTitle: {
    margin: "0 0 var(--space-2)",
    fontSize: "var(--text-3xl)",
    fontWeight: 700,
    color: "var(--color-text-primary)",
  },
  poolMeta: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    flexWrap: "wrap" as const,
  },
  adminBadge: {
    padding: "0.2rem 0.6rem",
    background: "var(--color-primary-light)",
    color: "var(--color-primary)",
    borderRadius: "9999px",
    fontSize: "0.75rem",
    fontWeight: 700,
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
    flexShrink: 0,
  },
  // Dashboard layout
  dashboard: {
    display: "grid",
    gridTemplateColumns: "340px 1fr",
    gap: "var(--space-6)",
    alignItems: "start",
    // Mobile: stacks via media query (handled via responsive CSS below)
  },
  leftCol: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
  },
  rightCol: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-xl)",
    overflow: "hidden",
  },
  // Stats card
  statsCard: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-xl)",
    padding: "var(--space-6)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
  },
  cardTitle: {
    margin: 0,
    fontSize: "var(--text-base)",
    fontWeight: 700,
    color: "var(--color-text-primary)",
  },
  statRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "var(--space-2)",
    paddingBottom: "var(--space-3)",
    borderBottom: "1px solid var(--color-border)",
  },
  statLabel: {
    fontSize: "var(--text-sm)",
    color: "var(--color-text-secondary)",
    flexShrink: 0,
  },
  statValue: {
    fontSize: "var(--text-sm)",
    fontWeight: 600,
    color: "var(--color-text-primary)",
    textAlign: "right" as const,
    fontFamily: "var(--font-mono)",
  },
  statValueEmpty: {
    color: "var(--color-text-disabled)",
    fontFamily: "inherit",
    fontWeight: 400,
  },
  emptyBalanceNote: {
    padding: "var(--space-2) 0",
  },
  tokenInfo: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    minWidth: 0,
  },
  tokenSymbolBadge: {
    padding: "0.1rem 0.4rem",
    background: "var(--color-secondary-light)",
    color: "var(--color-secondary-hover)",
    borderRadius: "var(--radius-sm)",
    fontSize: "0.7rem",
    fontWeight: 700,
    flexShrink: 0,
  },
  tokenAddr: {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-sm)",
    color: "var(--color-text-secondary)",
  },
  expertLink: {
    color: "var(--color-primary)",
    fontSize: "0.8rem",
    textDecoration: "none",
    flexShrink: 0,
  },
  poolIdCode: {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-sm)",
    background: "var(--color-surface-2)",
    padding: "0.1rem 0.4rem",
    borderRadius: "var(--radius-sm)",
    color: "var(--color-text-primary)",
  },
  // Admin card
  adminCard: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-xl)",
    padding: "var(--space-6)",
  },
  // Tab bar
  tabBar: {
    display: "flex",
    borderBottom: "1px solid var(--color-border)",
  },
  tab: {
    flex: 1,
    padding: "var(--space-4)",
    background: "none",
    border: "none",
    borderBottom: "2px solid transparent",
    cursor: "pointer",
    fontSize: "var(--text-base)",
    fontWeight: 600,
    color: "var(--color-text-secondary)",
    transition: "color 0.2s, border-color 0.2s",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--space-2)",
    minHeight: "52px",
  },
  tabActive: {
    color: "var(--color-primary)",
    borderBottomColor: "var(--color-primary)",
    background: "var(--color-primary-light)",
  },
  tabActiveWithdraw: {
    color: "var(--color-accent-hover)",
    borderBottomColor: "var(--color-accent)",
    background: "var(--color-warning-light)",
  },
  tabLock: {
    fontSize: "0.75rem",
  },
  tabPanel: {
    padding: "var(--space-6)",
  },
  // Wallet gate
  walletGate: {
    padding: "var(--space-12) var(--space-6)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "var(--space-3)",
    textAlign: "center",
  },
  walletIcon: {
    fontSize: "2.5rem",
  },
  walletTitle: {
    margin: 0,
    fontSize: "var(--text-lg)",
    fontWeight: 700,
    color: "var(--color-text-primary)",
  },
  walletBody: {
    margin: 0,
    fontSize: "var(--text-sm)",
    color: "var(--color-text-secondary)",
    maxWidth: "280px",
    lineHeight: "var(--leading-relaxed)",
  },
};
