"use client";

import type { CSSProperties } from "react";
import * as Dialog from "@radix-ui/react-dialog";

export interface PoolTxSummary {
  action: "deposit" | "withdraw";
  /** Amount as entered, already validated (e.g. "12.5"). */
  amount: string;
  symbol: string;
  decimals: number;
  /** Token contract address. */
  token: string;
  poolId: string;
  /** Admin signatures required to move funds out of the pool. */
  threshold: number;
  adminCount: number;
  /** Withdrawal recipient. */
  recipient?: string;
  /** Pool balance after the transaction, formatted. */
  resultingBalance?: string;
}

interface PoolTxConfirmDialogProps {
  open: boolean;
  summary: PoolTxSummary;
  /** Called when the user confirms; the wallet prompt follows. */
  onConfirm: () => void;
  /** Called on Cancel, Escape or an outside click. The form keeps its state. */
  onCancel: () => void;
}

function short(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

/** What the multisig threshold means for this transaction. */
export function thresholdImplication(summary: PoolTxSummary): string {
  const { action, threshold, adminCount } = summary;
  const quorum = `${threshold} of ${adminCount} admin signature${adminCount === 1 ? "" : "s"}`;
  if (action === "deposit") {
    return `Once deposited, these funds can only leave the pool with ${quorum}. You cannot withdraw them on your own unless you are an admin and the threshold is 1.`;
  }
  if (threshold <= 1) {
    return `This pool requires ${quorum}, so the withdrawal executes as soon as you sign.`;
  }
  const remaining = threshold - 1;
  return `This pool requires ${quorum}. Your signature counts as one; ${remaining} more admin${remaining === 1 ? "" : "s"} must co-sign before any funds move.`;
}

/**
 * Confirmation step shown before a pool deposit or withdrawal is sent to the
 * wallet (issue #1634). Multisig pool funds are costly to recover, so the
 * user reviews amount, token, pool and threshold before signing.
 */
export function PoolTxConfirmDialog({
  open,
  summary,
  onConfirm,
  onCancel,
}: PoolTxConfirmDialogProps) {
  const verb = summary.action === "deposit" ? "Deposit" : "Withdraw";

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay style={styles.overlay} />
        <Dialog.Content style={styles.content} aria-describedby="pool-tx-confirm-description">
          <Dialog.Title style={styles.title}>Confirm {summary.action}</Dialog.Title>
          <Dialog.Description id="pool-tx-confirm-description" style={styles.description}>
            Review the details below. Your wallet will ask you to sign after you confirm.
          </Dialog.Description>

          <dl style={styles.list} data-testid="pool-tx-summary">
            <div style={styles.row}>
              <dt style={styles.term}>Amount</dt>
              <dd style={{ ...styles.value, ...styles.amount }}>
                {summary.amount} {summary.symbol}
              </dd>
            </div>
            <div style={styles.row}>
              <dt style={styles.term}>Token</dt>
              <dd style={styles.value}>
                {summary.symbol} · {summary.decimals} decimals ·{" "}
                <code style={styles.code} title={summary.token}>
                  {short(summary.token)}
                </code>
              </dd>
            </div>
            <div style={styles.row}>
              <dt style={styles.term}>Pool</dt>
              <dd style={styles.value}>
                <code style={styles.code}>{summary.poolId}</code>
              </dd>
            </div>
            {summary.recipient && (
              <div style={styles.row}>
                <dt style={styles.term}>Recipient</dt>
                <dd style={styles.value}>
                  <code style={styles.code} title={summary.recipient}>
                    {short(summary.recipient)}
                  </code>
                </dd>
              </div>
            )}
            {summary.resultingBalance && (
              <div style={styles.row}>
                <dt style={styles.term}>Pool balance after</dt>
                <dd style={styles.value}>
                  {summary.resultingBalance} {summary.symbol}
                </dd>
              </div>
            )}
            <div style={styles.row}>
              <dt style={styles.term}>Admin threshold</dt>
              <dd style={styles.value}>
                {summary.threshold} of {summary.adminCount}
              </dd>
            </div>
          </dl>

          <p style={styles.notice} role="note">
            {thresholdImplication(summary)}
          </p>

          <div style={styles.actions}>
            <Dialog.Close asChild>
              <button type="button" style={styles.cancel}>
                Cancel
              </button>
            </Dialog.Close>
            <button type="button" onClick={onConfirm} style={styles.confirm} autoFocus>
              {verb} &amp; sign
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 23, 42, 0.6)",
    zIndex: 1000,
  },
  content: {
    position: "fixed",
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "min(92vw, 440px)",
    background: "var(--color-bg)",
    color: "var(--color-text-primary)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-lg)",
    padding: "var(--space-6)",
    zIndex: 1001,
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
  },
  title: {
    margin: 0,
    fontSize: "var(--text-lg)",
    fontWeight: 700,
    textTransform: "capitalize",
  },
  description: {
    margin: 0,
    fontSize: "var(--text-sm)",
    color: "var(--color-text-secondary)",
  },
  list: {
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-2)",
    padding: "var(--space-4)",
    background: "var(--color-surface-1)",
    borderRadius: "var(--radius-md)",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    gap: "var(--space-3)",
    fontSize: "var(--text-sm)",
  },
  term: {
    color: "var(--color-text-secondary)",
  },
  value: {
    margin: 0,
    textAlign: "right",
    fontWeight: 500,
  },
  amount: {
    fontWeight: 700,
    fontFamily: "var(--font-mono)",
  },
  code: {
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
  },
  notice: {
    margin: 0,
    padding: "var(--space-3)",
    borderRadius: "var(--radius-md)",
    border: "1px solid var(--color-warning)",
    fontSize: "var(--text-sm)",
    lineHeight: "var(--leading-relaxed)",
  },
  actions: {
    display: "flex",
    gap: "var(--space-3)",
  },
  cancel: {
    flex: 1,
    minHeight: "44px",
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--color-border)",
    background: "var(--color-surface-1)",
    color: "var(--color-text-primary)",
    fontWeight: 600,
    cursor: "pointer",
  },
  confirm: {
    flex: 1,
    minHeight: "44px",
    borderRadius: "var(--radius-lg)",
    border: "none",
    background: "var(--color-primary)",
    color: "white",
    fontWeight: 700,
    cursor: "pointer",
  },
};
