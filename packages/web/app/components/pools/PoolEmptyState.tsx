"use client";

import type { CSSProperties } from "react";
import Link from "next/link";

interface PoolEmptyStateProps {
  variant?: "no-pools" | "zero-balance" | "not-found";
  poolId?: string;
}

export function PoolEmptyState({ variant = "no-pools", poolId }: PoolEmptyStateProps) {
  return (
    <div style={styles.wrapper} role="status" aria-live="polite">
      <div style={styles.illustration} aria-hidden="true">
        <EmptyIllustration variant={variant} />
      </div>
      <div style={styles.content}>
        {variant === "no-pools" && (
          <>
            <h3 style={styles.title}>No pools available</h3>
            <p style={styles.body}>
              There are no active community pools right now. Create one to get started.
            </p>
            <Link href="/pools/new" style={styles.cta}>
              Create a pool
            </Link>
          </>
        )}
        {variant === "zero-balance" && (
          <>
            <h3 style={styles.title}>Pool is empty</h3>
            <p style={styles.body}>
              This pool has no funds yet. Be the first to deposit.
            </p>
          </>
        )}
        {variant === "not-found" && (
          <>
            <h3 style={styles.title}>Pool not found</h3>
            <p style={styles.body}>
              No pool with ID <code style={styles.code}>{poolId}</code> exists.
              Check the ID and try again.
            </p>
            <Link href="/pools" style={styles.cta}>
              Browse pools
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

function EmptyIllustration({ variant }: { variant: string }) {
  if (variant === "not-found") {
    return (
      <svg width="120" height="120" viewBox="0 0 120 120" fill="none" aria-hidden="true">
        <circle cx="60" cy="60" r="56" fill="var(--color-surface-1)" stroke="var(--color-border)" strokeWidth="2" />
        <rect x="34" y="44" width="52" height="36" rx="6" fill="var(--color-surface-2)" stroke="var(--color-border)" strokeWidth="1.5" />
        <path d="M46 60h28M46 68h18" stroke="var(--color-border-strong)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="60" cy="52" r="4" fill="var(--color-error)" opacity="0.7" />
        <path d="M58 50l4 4M62 50l-4 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M44 88l8-8M76 88l-8-8" stroke="var(--color-border)" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  if (variant === "zero-balance") {
    return (
      <svg width="120" height="120" viewBox="0 0 120 120" fill="none" aria-hidden="true">
        <circle cx="60" cy="60" r="56" fill="var(--color-surface-1)" stroke="var(--color-border)" strokeWidth="2" />
        <rect x="30" y="50" width="60" height="30" rx="8" fill="var(--color-surface-2)" stroke="var(--color-border)" strokeWidth="1.5" />
        <path d="M30 62h60" stroke="var(--color-border)" strokeWidth="1.5" />
        <circle cx="60" cy="56" r="3" fill="var(--color-border-strong)" />
        <path d="M50 72h20" stroke="var(--color-border)" strokeWidth="2" strokeLinecap="round" />
        <path d="M60 38v8M56 42l4-4 4 4" stroke="var(--color-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  // no-pools
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <circle cx="60" cy="60" r="56" fill="var(--color-surface-1)" stroke="var(--color-border)" strokeWidth="2" />
      {/* Bank building */}
      <rect x="36" y="58" width="48" height="24" rx="2" fill="var(--color-surface-2)" stroke="var(--color-border)" strokeWidth="1.5" />
      <path d="M32 58h56" stroke="var(--color-border-strong)" strokeWidth="2" strokeLinecap="round" />
      <path d="M60 38l28 20H32L60 38Z" fill="var(--color-primary-light)" stroke="var(--color-primary)" strokeWidth="1.5" strokeLinejoin="round" />
      {/* Columns */}
      <rect x="42" y="58" width="4" height="24" fill="var(--color-border)" />
      <rect x="54" y="58" width="4" height="24" fill="var(--color-border)" />
      <rect x="66" y="58" width="4" height="24" fill="var(--color-border)" />
      <rect x="78" y="58" width="4" height="24" fill="var(--color-border)" />
      {/* Base */}
      <rect x="30" y="82" width="60" height="4" rx="2" fill="var(--color-border-strong)" />
      {/* Plus sign */}
      <circle cx="88" cy="36" r="12" fill="var(--color-primary)" />
      <path d="M88 30v12M82 36h12" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

const styles: Record<string, CSSProperties> = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "var(--space-6)",
    padding: "var(--space-12) var(--space-4)",
    textAlign: "center",
  },
  illustration: {
    opacity: 0.9,
  },
  content: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "var(--space-3)",
    maxWidth: "360px",
  },
  title: {
    margin: 0,
    fontSize: "var(--text-xl)",
    fontWeight: "var(--font-semibold)" as unknown as number,
    color: "var(--color-text-primary)",
  },
  body: {
    margin: 0,
    fontSize: "var(--text-base)",
    color: "var(--color-text-secondary)",
    lineHeight: "var(--leading-relaxed)",
  },
  cta: {
    marginTop: "var(--space-2)",
    padding: "var(--space-3) var(--space-6)",
    background: "var(--color-primary)",
    color: "white",
    borderRadius: "var(--radius-full)",
    fontWeight: 600,
    fontSize: "var(--text-sm)",
    textDecoration: "none",
    display: "inline-block",
  },
  code: {
    fontFamily: "var(--font-mono)",
    background: "var(--color-surface-2)",
    padding: "0.1rem 0.4rem",
    borderRadius: "var(--radius-sm)",
    fontSize: "0.9em",
  },
};
