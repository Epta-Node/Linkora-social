import React from "react";

/* ────────────────────────────────────────────────────────────────────────── */
/*  Types                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

interface CreatorTokenPanelProps {
  tokenAddress: string | null;
  /** The viewer's token balance (formatted string). */
  balance: string | null;
  /** Total tips received across all posts. */
  totalTipsReceived: number;
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Component                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

export function CreatorTokenPanel({
  tokenAddress,
  balance,
  totalTipsReceived,
}: CreatorTokenPanelProps) {
  if (!tokenAddress) {
    return (
      <section
        id="creator-token-panel"
        aria-label="Creator Token"
        className="bg-[var(--bg-secondary)] p-6 rounded-xl border border-[var(--bg-tertiary)] text-center"
      >
        <p className="text-[var(--text-muted)]">No Creator Token active.</p>
      </section>
    );
  }

  return (
    <section
      id="creator-token-panel"
      aria-label="Creator Token details"
      className="bg-[var(--bg-secondary)] p-6 rounded-xl border border-[var(--bg-tertiary)] flex flex-col gap-4"
    >
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">Creator Token</h3>

      <dl className="grid grid-cols-2 gap-4">
        {/* Token Address */}
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-[var(--text-muted)]">Token Address</dt>
          <dd className="font-mono text-sm text-[var(--accent-teal)]">
            {tokenAddress.slice(0, 4)}…{tokenAddress.slice(-4)}
          </dd>
        </div>

        {/* User balance */}
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-[var(--text-muted)]">Your Balance</dt>
          <dd className="font-medium text-[var(--text-primary)]">{balance ?? "0"}</dd>
        </div>

        {/* Tips */}
        <div className="flex flex-col gap-1 col-span-2">
          <dt className="text-sm text-[var(--text-muted)]">Total Tips Received</dt>
          <dd className="font-medium text-xl text-[var(--success)]">
            {totalTipsReceived.toLocaleString()}
          </dd>
        </div>
      </dl>
    </section>
  );
}
