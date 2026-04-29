"use client";

import { useState, useCallback, type CSSProperties } from "react";
import type { PoolData, TokenMeta } from "../../hooks/usePools";
import { formatTokenAmount, parseTokenAmount, STELLAR_KEY_RE } from "../../hooks/usePools";
import { useWithdraw } from "../../hooks/usePoolContract";
import { TxStatusBanner } from "./TxStatusBanner";
import { ThresholdBadge } from "./ThresholdBadge";

interface WithdrawTabProps {
  pool: PoolData;
  tokenMeta: TokenMeta | null;
  currentUser: string;
  onSuccess: () => void;
}

const AMOUNT_RE = /^\d*\.?\d*$/;

export function WithdrawTab({ pool, tokenMeta, currentUser, onSuccess }: WithdrawTabProps) {
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState(currentUser);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const { status, result, error, withdraw, reset } = useWithdraw();

  const decimals = tokenMeta?.decimals ?? 7;
  const symbol = tokenMeta?.symbol ?? "TOKEN";
  const isAdmin = pool.admins.some((a) => a === currentUser);
  const isSubmitting = status !== "idle" && status !== "error" && status !== "success";

  // For M-of-N: in a real implementation, signers would be collected off-chain
  // (e.g., via a pending-signatures queue). Here we simulate the current user
  // as the initiating signer.
  const signers = [currentUser];
  const signerCount = signers.length;
  const needsMoreSigners = signerCount < pool.threshold;

  const validateAmount = useCallback(
    (val: string): string | null => {
      if (!val || val === "0") return "Enter an amount";
      if (!AMOUNT_RE.test(val)) return "Invalid number";
      try {
        const parsed = parseTokenAmount(val, decimals);
        if (parsed <= BigInt(0)) return "Amount must be greater than 0";
        if (parsed > pool.balance) return "Insufficient pool balance";
      } catch {
        return "Invalid amount";
      }
      return null;
    },
    [decimals, pool.balance]
  );

  const validateRecipient = (val: string): string | null => {
    if (!val.trim()) return "Recipient address is required";
    if (!STELLAR_KEY_RE.test(val.trim())) return "Invalid Stellar public key (must start with G, 56 chars)";
    return null;
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!AMOUNT_RE.test(val) && val !== "") return;
    setAmount(val);
    if (amountError) setAmountError(validateAmount(val));
  };

  const handleRecipientChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setRecipient(val);
    if (recipientError) setRecipientError(validateRecipient(val));
  };

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const aErr = validateAmount(amount);
      const rErr = validateRecipient(recipient);
      setAmountError(aErr);
      setRecipientError(rErr);
      if (aErr || rErr) return;

      await withdraw(signers, pool.pool_id, amount, decimals, recipient.trim());
    },
    [amount, recipient, validateAmount, withdraw, signers, pool.pool_id, decimals]
  );

  const handleReset = () => {
    reset();
    setAmount("");
    setAmountError(null);
    setRecipientError(null);
  };

  const handleSuccessDismiss = () => {
    handleReset();
    onSuccess();
  };

  if (!isAdmin) {
    return (
      <div style={styles.notAdmin} role="alert">
        <span style={styles.notAdminIcon} aria-hidden="true">🔒</span>
        <div>
          <p style={styles.notAdminTitle}>Admin access required</p>
          <p style={styles.notAdminBody}>
            Only pool admins can initiate withdrawals. This pool requires{" "}
            <strong>{pool.threshold} of {pool.admins.length}</strong> admin signatures.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.wrapper}>
      <TxStatusBanner
        status={status}
        result={result}
        error={error}
        onReset={status === "success" ? handleSuccessDismiss : handleReset}
        actionLabel="Withdrawal"
      />

      {/* Signature status */}
      <div style={styles.sigStatus}>
        <div style={styles.sigHeader}>
          <span style={styles.sigLabel}>Signature Status</span>
          <ThresholdBadge threshold={pool.threshold} total={pool.admins.length} variant="compact" />
        </div>

        {needsMoreSigners ? (
          <div style={styles.pendingSigs} role="status">
            <span style={styles.pendingIcon} aria-hidden="true">⏳</span>
            <div>
              <p style={styles.pendingTitle}>Pending signatures</p>
              <p style={styles.pendingBody}>
                You are signer <strong>1 of {pool.threshold}</strong> required.{" "}
                {pool.threshold - 1} more admin{pool.threshold - 1 !== 1 ? "s" : ""} must co-sign
                before this withdrawal can execute.
              </p>
            </div>
          </div>
        ) : (
          <div style={styles.readySigs} role="status">
            <span style={styles.readyIcon} aria-hidden="true">✅</span>
            <p style={styles.readyText}>
              Threshold met — {signerCount} of {pool.threshold} required signatures collected.
            </p>
          </div>
        )}
      </div>

      {status === "success" ? null : (
        <form onSubmit={handleSubmit} style={styles.form} noValidate>
          {/* Pool balance */}
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Available balance</span>
            <span style={styles.infoValue}>
              {formatTokenAmount(pool.balance, decimals)} {symbol}
            </span>
          </div>

          {/* Amount */}
          <div style={styles.fieldGroup}>
            <label htmlFor="withdraw-amount" style={styles.label}>
              Amount
            </label>
            <div style={styles.inputWrapper}>
              <input
                id="withdraw-amount"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={handleAmountChange}
                placeholder={`0.${"0".repeat(Math.min(decimals, 2))}`}
                disabled={isSubmitting}
                style={{
                  ...styles.input,
                  ...(amountError ? styles.inputError : {}),
                }}
                aria-describedby={amountError ? "withdraw-amount-error" : undefined}
                aria-invalid={!!amountError}
                autoComplete="off"
              />
              <span style={styles.inputSuffix}>{symbol}</span>
            </div>
            {amountError && (
              <p id="withdraw-amount-error" style={styles.fieldError} role="alert">
                {amountError}
              </p>
            )}
          </div>

          {/* Recipient */}
          <div style={styles.fieldGroup}>
            <label htmlFor="withdraw-recipient" style={styles.label}>
              Recipient address
            </label>
            <input
              id="withdraw-recipient"
              type="text"
              value={recipient}
              onChange={handleRecipientChange}
              placeholder="G…"
              disabled={isSubmitting}
              style={{
                ...styles.input,
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-sm)",
                ...(recipientError ? styles.inputError : {}),
              }}
              aria-describedby={recipientError ? "withdraw-recipient-error" : undefined}
              aria-invalid={!!recipientError}
              autoComplete="off"
              spellCheck={false}
            />
            {recipientError && (
              <p id="withdraw-recipient-error" style={styles.fieldError} role="alert">
                {recipientError}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={isSubmitting || !amount || !!amountError || !!recipientError}
            style={{
              ...styles.submitBtn,
              ...(isSubmitting || !amount || !!amountError || !!recipientError
                ? styles.submitBtnDisabled
                : {}),
            }}
          >
            {isSubmitting ? (
              <>
                <span aria-hidden="true">⏳</span>
                {status === "awaiting_sig" ? "Sign in Freighter…" : "Withdrawing…"}
              </>
            ) : needsMoreSigners ? (
              "Initiate Withdrawal Request"
            ) : (
              `Withdraw ${amount ? `${amount} ${symbol}` : ""}`
            )}
          </button>

          {needsMoreSigners && (
            <p style={styles.initiateNote}>
              Submitting will record your signature. The withdrawal executes once{" "}
              {pool.threshold} admins have signed.
            </p>
          )}
        </form>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrapper: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
  },
  notAdmin: {
    display: "flex",
    gap: "var(--space-4)",
    padding: "var(--space-6)",
    background: "var(--color-surface-1)",
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--color-border)",
    alignItems: "flex-start",
  },
  notAdminIcon: {
    fontSize: "1.5rem",
    flexShrink: 0,
  },
  notAdminTitle: {
    margin: "0 0 var(--space-1)",
    fontWeight: 600,
    color: "var(--color-text-primary)",
  },
  notAdminBody: {
    margin: 0,
    fontSize: "var(--text-sm)",
    color: "var(--color-text-secondary)",
    lineHeight: "var(--leading-relaxed)",
  },
  sigStatus: {
    padding: "var(--space-4)",
    background: "var(--color-surface-1)",
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--color-border)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-3)",
  },
  sigHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sigLabel: {
    fontSize: "0.75rem",
    fontWeight: 700,
    color: "var(--color-text-secondary)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
  },
  pendingSigs: {
    display: "flex",
    gap: "var(--space-3)",
    alignItems: "flex-start",
  },
  pendingIcon: {
    fontSize: "1.1rem",
    flexShrink: 0,
  },
  pendingTitle: {
    margin: "0 0 var(--space-1)",
    fontWeight: 600,
    fontSize: "var(--text-sm)",
    color: "var(--color-warning)",
  },
  pendingBody: {
    margin: 0,
    fontSize: "var(--text-sm)",
    color: "var(--color-text-secondary)",
    lineHeight: "var(--leading-relaxed)",
  },
  readySigs: {
    display: "flex",
    gap: "var(--space-2)",
    alignItems: "center",
  },
  readyIcon: {
    fontSize: "1rem",
  },
  readyText: {
    margin: 0,
    fontSize: "var(--text-sm)",
    color: "var(--color-success)",
    fontWeight: 500,
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
  },
  infoRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "var(--space-3) var(--space-4)",
    background: "var(--color-surface-1)",
    borderRadius: "var(--radius-md)",
  },
  infoLabel: {
    fontSize: "var(--text-sm)",
    color: "var(--color-text-secondary)",
  },
  infoValue: {
    fontSize: "var(--text-sm)",
    fontWeight: 600,
    fontFamily: "var(--font-mono)",
    color: "var(--color-text-primary)",
  },
  fieldGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-2)",
  },
  label: {
    fontSize: "var(--text-sm)",
    fontWeight: 600,
    color: "var(--color-text-primary)",
  },
  inputWrapper: {
    position: "relative",
    display: "flex",
    alignItems: "center",
  },
  input: {
    width: "100%",
    padding: "var(--space-3) var(--space-4)",
    paddingRight: "4.5rem",
    border: "1.5px solid var(--color-border)",
    borderRadius: "var(--radius-lg)",
    fontSize: "var(--text-lg)",
    background: "var(--color-bg)",
    color: "var(--color-text-primary)",
    outline: "none",
    transition: "border-color 0.2s",
  },
  inputError: {
    borderColor: "var(--color-error)",
    background: "var(--color-error-light)",
  },
  inputSuffix: {
    position: "absolute",
    right: "var(--space-4)",
    fontSize: "var(--text-sm)",
    fontWeight: 600,
    color: "var(--color-text-secondary)",
    pointerEvents: "none",
  },
  fieldError: {
    margin: 0,
    fontSize: "var(--text-sm)",
    color: "var(--color-error)",
    fontWeight: 500,
  },
  submitBtn: {
    padding: "var(--space-4)",
    background: "var(--color-accent)",
    color: "white",
    borderRadius: "var(--radius-lg)",
    fontWeight: 700,
    fontSize: "var(--text-base)",
    border: "none",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "var(--space-2)",
    transition: "background 0.2s, opacity 0.2s",
    minHeight: "48px",
  },
  submitBtnDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  initiateNote: {
    margin: 0,
    fontSize: "var(--text-sm)",
    color: "var(--color-text-secondary)",
    textAlign: "center" as const,
    lineHeight: "var(--leading-relaxed)",
  },
};
