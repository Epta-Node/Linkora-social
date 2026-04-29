"use client";

import type { CSSProperties } from "react";

interface ThresholdBadgeProps {
  threshold: number;
  total: number;
  /** compact = inline pill; full = bar with label */
  variant?: "compact" | "full";
}

/**
 * Visually represents M-of-N multisig governance.
 * e.g. "Requires 3 of 5 signatures"
 */
export function ThresholdBadge({
  threshold,
  total,
  variant = "compact",
}: ThresholdBadgeProps) {
  const pct = total > 0 ? (threshold / total) * 100 : 0;

  if (variant === "compact") {
    return (
      <span style={styles.pill} title={`Requires ${threshold} of ${total} admin signatures`}>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <path
            d="M6 1L7.5 4.5H11L8.25 6.75L9.25 10.5L6 8.25L2.75 10.5L3.75 6.75L1 4.5H4.5L6 1Z"
            fill="currentColor"
          />
        </svg>
        {threshold}/{total} sigs
      </span>
    );
  }

  return (
    <div style={styles.fullWrapper} role="group" aria-label={`Governance: requires ${threshold} of ${total} signatures`}>
      <div style={styles.fullHeader}>
        <span style={styles.fullLabel}>Governance Threshold</span>
        <span style={styles.fullValue}>
          Requires <strong>{threshold}</strong> of <strong>{total}</strong> signatures
        </span>
      </div>
      <div style={styles.track} role="progressbar" aria-valuenow={threshold} aria-valuemin={0} aria-valuemax={total}>
        <div style={{ ...styles.fill, width: `${pct}%` }} />
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            style={{
              ...styles.dot,
              left: `${((i + 1) / total) * 100}%`,
              background: i < threshold ? "var(--color-primary)" : "var(--color-border)",
              border: i < threshold
                ? "2px solid var(--color-primary-hover)"
                : "2px solid var(--color-border-strong)",
            }}
            title={i < threshold ? `Signer ${i + 1} (required)` : `Signer ${i + 1} (optional)`}
          />
        ))}
      </div>
      <div style={styles.legend}>
        <span style={styles.legendRequired}>
          <span style={styles.legendDotRequired} />
          Required ({threshold})
        </span>
        <span style={styles.legendOptional}>
          <span style={styles.legendDotOptional} />
          Optional ({total - threshold})
        </span>
      </div>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25rem",
    padding: "0.2rem 0.6rem",
    borderRadius: "9999px",
    fontSize: "0.75rem",
    fontWeight: 600,
    background: "var(--color-primary-light)",
    color: "var(--color-primary)",
    whiteSpace: "nowrap",
    letterSpacing: "0.01em",
  },
  fullWrapper: {
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
  },
  fullHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    flexWrap: "wrap" as const,
    gap: "0.25rem",
  },
  fullLabel: {
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "var(--color-text-secondary)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
  },
  fullValue: {
    fontSize: "0.875rem",
    color: "var(--color-text-primary)",
  },
  track: {
    position: "relative",
    height: "8px",
    background: "var(--color-border)",
    borderRadius: "9999px",
    overflow: "visible",
  },
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    height: "100%",
    background: "var(--color-primary)",
    borderRadius: "9999px",
    transition: "width 0.4s ease",
  },
  dot: {
    position: "absolute",
    top: "50%",
    transform: "translate(-50%, -50%)",
    width: "14px",
    height: "14px",
    borderRadius: "50%",
    transition: "background 0.3s",
  },
  legend: {
    display: "flex",
    gap: "1rem",
    fontSize: "0.75rem",
    color: "var(--color-text-secondary)",
  },
  legendRequired: {
    display: "flex",
    alignItems: "center",
    gap: "0.3rem",
  },
  legendOptional: {
    display: "flex",
    alignItems: "center",
    gap: "0.3rem",
  },
  legendDotRequired: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: "var(--color-primary)",
    display: "inline-block",
  },
  legendDotOptional: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: "var(--color-border-strong)",
    display: "inline-block",
  },
};
