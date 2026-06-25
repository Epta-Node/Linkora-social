/**
 * AnalyticsCard — displays the latest oracle-attested creator analytics.
 *
 * Fetches the attestation from the oracle service API and renders
 * tip total, post count, follower delta, and unique tipper count
 * with a "verified by oracle" badge.
 */

import { useState, useEffect } from "react";
import type { AnalyticsAttestation } from "linkora-sdk";

interface AnalyticsCardProps {
  creatorAddress: string;
  oracleApiUrl?: string;
}

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "loaded"; data: AnalyticsAttestation };

function formatStroops(value: string): string {
  const n = BigInt(value);
  if (n === 0n) return "0";
  // 7 decimal places (Stellar stroops = 1e-7 XLM)
  const whole = n / 10_000_000n;
  const frac = n % 10_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(7, "0").replace(/0+$/, "")}`;
}

export function AnalyticsCard({ creatorAddress, oracleApiUrl }: AnalyticsCardProps) {
  const baseUrl = oracleApiUrl ?? process.env["NEXT_PUBLIC_ORACLE_API_URL"] ?? "";
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!baseUrl || !creatorAddress) {
      setState({ status: "empty" });
      return;
    }
    let cancelled = false;
    fetch(`${baseUrl}/attestations/${creatorAddress}`)
      .then((res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`oracle API error: ${res.status}`);
        return res.json() as Promise<AnalyticsAttestation>;
      })
      .then((data) => {
        if (cancelled) return;
        if (!data) { setState({ status: "empty" }); return; }
        setState({ status: "loaded", data });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ status: "error", message: err.message });
      });
    return () => { cancelled = true; };
  }, [baseUrl, creatorAddress]);

  if (state.status === "loading") {
    return <div style={styles.skeleton} aria-busy="true" aria-label="Loading analytics" />;
  }

  if (state.status === "empty" || state.status === "error") return null;

  const { report, txHash, submittedAt } = state.data;
  const explorerUrl = `https://stellar.expert/explorer/testnet/tx/${txHash}`;

  return (
    <section style={styles.card} aria-label="Creator analytics">
      <div style={styles.header}>
        <span style={styles.badge} role="img" aria-label="Verified by oracle">
          ✅ Verified by oracle
        </span>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={styles.link}
          aria-label="View on-chain attestation"
        >
          On-chain ↗
        </a>
      </div>

      <div style={styles.grid}>
        <Stat label="Total Tips" value={`${formatStroops(report.totalTips)} XLM`} />
        <Stat label="Posts" value={report.postCount} />
        <Stat label="Follower Δ" value={Number(report.followerDelta) >= 0 ? `+${report.followerDelta}` : report.followerDelta} />
        <Stat label="Unique Tippers" value={report.uniqueTippers} />
      </div>

      <p style={styles.window}>
        Ledgers {report.windowStart}–{report.windowEnd} &middot;{" "}
        {new Date(submittedAt).toLocaleDateString()}
      </p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={styles.stat}>
      <strong style={styles.statValue}>{value}</strong>
      <span style={styles.statLabel}>{label}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  skeleton: {
    height: "96px",
    borderRadius: "12px",
    background: "var(--color-bg-secondary)",
    marginBottom: "var(--spacing-md)",
    animation: "skeleton-shimmer 1.4s ease-in-out infinite",
  },
  card: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
    padding: "var(--spacing-md) var(--spacing-lg)",
    marginBottom: "var(--spacing-lg)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "var(--spacing-sm)",
  },
  badge: {
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "var(--color-text-secondary)",
  },
  link: {
    fontSize: "0.75rem",
    color: "var(--color-primary)",
    textDecoration: "none",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "var(--spacing-md)",
    marginBottom: "var(--spacing-sm)",
  },
  stat: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  statValue: {
    fontSize: "1rem",
    fontWeight: 700,
    color: "var(--color-text)",
  },
  statLabel: {
    fontSize: "0.72rem",
    color: "var(--color-text-secondary)",
  },
  window: {
    fontSize: "0.72rem",
    color: "var(--color-text-secondary)",
    margin: 0,
  },
};
