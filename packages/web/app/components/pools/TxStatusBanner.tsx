"use client";

import type { CSSProperties } from "react";
import type { TxStatus, TxResult } from "../../hooks/usePoolContract";

interface TxStatusBannerProps {
  status: TxStatus;
  result: TxResult | null;
  error: string | null;
  onReset: () => void;
  /** Label for the current action, e.g. "Deposit" or "Withdrawal" */
  actionLabel?: string;
}

const STELLAR_EXPERT_BASE = "https://stellar.expert/explorer/testnet/tx";

export function TxStatusBanner({
  status,
  result,
  error,
  onReset,
  actionLabel = "Transaction",
}: TxStatusBannerProps) {
  if (status === "idle") return null;

  if (status === "approving") {
    return (
      <div style={{ ...styles.banner, ...styles.info }} role="status" aria-live="polite">
        <Spinner />
        <div style={styles.text}>
          <strong>Step 1 of 2 — Approving allowance</strong>
          <span style={styles.sub}>
            Authorizing the contract to spend your tokens. Check Freighter…
          </span>
        </div>
      </div>
    );
  }

  if (status === "awaiting_sig") {
    return (
      <div style={{ ...styles.banner, ...styles.info }} role="status" aria-live="polite">
        <Spinner />
        <div style={styles.text}>
          <strong>Waiting for signature</strong>
          <span style={styles.sub}>Check your Freighter wallet to sign the transaction.</span>
        </div>
      </div>
    );
  }

  if (status === "submitting") {
    return (
      <div style={{ ...styles.banner, ...styles.info }} role="status" aria-live="polite">
        <Spinner />
        <div style={styles.text}>
          <strong>Submitting to Stellar…</strong>
          <span style={styles.sub}>Broadcasting transaction to the network.</span>
        </div>
      </div>
    );
  }

  if (status === "success" && result) {
    return (
      <div style={{ ...styles.banner, ...styles.success }} role="status" aria-live="polite">
        <span style={styles.icon} aria-hidden="true">✅</span>
        <div style={styles.text}>
          <strong>{actionLabel} successful!</strong>
          <span style={styles.sub}>
            Ledger #{result.ledger} ·{" "}
            <a
              href={`${STELLAR_EXPERT_BASE}/${result.hash}`}
              target="_blank"
              rel="noopener noreferrer"
              style={styles.txLink}
            >
              {result.hash.slice(0, 8)}…{result.hash.slice(-6)} ↗
            </a>
          </span>
        </div>
        <button onClick={onReset} style={styles.closeBtn} aria-label="Dismiss">
          ✕
        </button>
      </div>
    );
  }

  if (status === "error" && error) {
    return (
      <div style={{ ...styles.banner, ...styles.errorBanner }} role="alert" aria-live="assertive">
        <span style={styles.icon} aria-hidden="true">⚠️</span>
        <div style={styles.text}>
          <strong>Transaction failed</strong>
          <span style={styles.sub}>{error}</span>
        </div>
        <button onClick={onReset} style={styles.retryBtn} aria-label="Try again">
          Try again
        </button>
      </div>
    );
  }

  return null;
}

function Spinner() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      style={{ animation: "spin 1s linear infinite", flexShrink: 0 }}
    >
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
      <path
        d="M10 2a8 8 0 0 1 8 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

const styles: Record<string, CSSProperties> = {
  banner: {
    display: "flex",
    alignItems: "flex-start",
    gap: "var(--space-3)",
    padding: "var(--space-4)",
    borderRadius: "var(--radius-lg)",
    border: "1px solid",
    fontSize: "var(--text-sm)",
  },
  info: {
    background: "var(--color-info-light)",
    borderColor: "var(--color-info)",
    color: "#1e40af",
  },
  success: {
    background: "var(--color-success-light)",
    borderColor: "var(--color-success)",
    color: "#065f46",
  },
  errorBanner: {
    background: "var(--color-error-light)",
    borderColor: "var(--color-error)",
    color: "#991b1b",
  },
  icon: {
    fontSize: "1.1rem",
    flexShrink: 0,
    marginTop: "1px",
  },
  text: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: "0.2rem",
  },
  sub: {
    opacity: 0.85,
    fontWeight: 400,
  },
  txLink: {
    fontFamily: "var(--font-mono)",
    fontWeight: 600,
    color: "inherit",
    textDecoration: "underline",
  },
  closeBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: "0.9rem",
    opacity: 0.6,
    padding: "0 var(--space-1)",
    minHeight: "auto",
    minWidth: "auto",
    color: "inherit",
    flexShrink: 0,
  },
  retryBtn: {
    background: "none",
    border: "1px solid currentColor",
    borderRadius: "var(--radius-md)",
    cursor: "pointer",
    fontSize: "0.8rem",
    fontWeight: 600,
    padding: "0.2rem 0.6rem",
    color: "inherit",
    flexShrink: 0,
    minHeight: "auto",
    minWidth: "auto",
    whiteSpace: "nowrap" as const,
  },
};
