"use client";

import { useState, useCallback, type CSSProperties } from "react";
import type { PoolData, TokenMeta } from "../../hooks/usePools";
import { formatTokenAmount, parseTokenAmount } from "../../hooks/usePools";
import { useDeposit } from "../../hooks/usePoolContract";
import { TxStatusBanner } from "./TxStatusBanner";

interface DepositTabProps {
  pool: PoolData;
  tokenMeta: TokenMeta | null;
  currentUser: string;
  contractAddress: string;
  onSuccess: () => void;
}

const AMOUNT_RE = /^\d*\.?\d*$/;

export function DepositTab({
  pool,
  tokenMeta,
  currentUser,
  contractAddress,
  onSuccess,
}: DepositTabProps) {
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const { status, result, error, deposit, reset } = useDeposit();

  const decimals = tokenMeta?.decimals ?? 7;
  const symbol = tokenMeta?.symbol ?? "TOKEN";
  const isSubmitting = status !== "idle" && status !== "error" && status !== "success";

  const validateAmount = useCallback(
    (val: string): string | null => {
      if (!val || val === "0" || val === "0.") return "Enter an amount";
      if (!AMOUNT_RE.test(val)) return "Invalid number";
      try {
        const parsed = parseTokenAmount(val, decimals);
        if (parsed <= BigInt(0)) return "Amount must be greater than 0";
      } catch {
        return "Invalid amount";
      }
      return null;
    },
    [decimals]
  );

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!AMOUNT_RE.test(val) && val !== "") return;
    setAmount(val);
    if (amountError) setAmountError(validateAmount(val));
  };

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const err = validateAmount(amount);
      if (err) {
        setAmountError(err);
        return;
      }
      setAmountError(null);
      await deposit(currentUser, pool.pool_id, pool.token, amount, decimals, contractAddress);
    },
    [amount, validateAmount, deposit, currentUser, pool, decimals, contractAddress]
  );

  const handleReset = () => {
    reset();
    setAmount("");
    setAmountError(null);
  };

  const handleSuccessDismiss = () => {
    handleReset();
    onSuccess();
  };

  // Compute preview
  const previewAmount =
    amount && !amountError
      ? (() => {
          try {
            const raw = parseTokenAmount(amount, decimals);
            return formatTokenAmount(raw, decimals);
          } catch {
            return null;
          }
        })()
      : null;

  return (
    <div style={styles.wrapper}>
      <TxStatusBanner
        status={status}
        result={result}
        error={error}
        onReset={status === "success" ? handleSuccessDismiss : handleReset}
        actionLabel="Deposit"
      />

      {status === "success" ? null : (
        <form onSubmit={handleSubmit} style={styles.form} noValidate>
          {/* Pool token info */}
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Token</span>
            <span style={styles.infoValue}>
              <span style={styles.symbolBadge}>{symbol}</span>
              <span style={styles.addrMono} title={pool.token}>
                {pool.token.slice(0, 6)}…{pool.token.slice(-4)}
              </span>
            </span>
          </div>

          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Pool balance</span>
            <span style={styles.infoValue}>
              {formatTokenAmount(pool.balance, decimals)} {symbol}
            </span>
          </div>

          {/* Amount input */}
          <div style={styles.fieldGroup}>
            <label htmlFor="deposit-amount" style={styles.label}>
              Amount
            </label>
            <div style={styles.inputWrapper}>
              <input
                id="deposit-amount"
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
                aria-describedby={amountError ? "deposit-amount-error" : undefined}
                aria-invalid={!!amountError}
                autoComplete="off"
              />
              <span style={styles.inputSuffix}>{symbol}</span>
            </div>
            {amountError && (
              <p id="deposit-amount-error" style={styles.fieldError} role="alert">
                {amountError}
              </p>
            )}
          </div>

          {/* Transaction preview */}
          {previewAmount && (
            <div style={styles.preview} aria-label="Transaction preview">
              <p style={styles.previewTitle}>Transaction Preview</p>
              <div style={styles.previewRow}>
                <span style={styles.previewLabel}>Step 1</span>
                <span style={styles.previewValue}>
                  Approve {previewAmount} {symbol} allowance
                </span>
              </div>
              <div style={styles.previewDivider} />
              <div style={styles.previewRow}>
                <span style={styles.previewLabel}>Step 2</span>
                <span style={styles.previewValue}>
                  Deposit {previewAmount} {symbol} → pool <code style={styles.code}>{pool.pool_id}</code>
                </span>
              </div>
              <div style={styles.previewDivider} />
              <div style={styles.previewRow}>
                <span style={styles.previewLabel}>New balance</span>
                <span style={{ ...styles.previewValue, fontWeight: 700, color: "var(--color-success)" }}>
                  {formatTokenAmount(
                    pool.balance + parseTokenAmount(amount, decimals),
                    decimals
                  )}{" "}
                  {symbol}
                </span>
              </div>
              <div style={styles.previewRow}>
                <span style={styles.previewLabel}>Network fee</span>
                <span style={styles.previewValue}>~0.00001 XLM</span>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting || !amount || !!amountError}
            style={{
              ...styles.submitBtn,
              ...(isSubmitting || !amount || !!amountError ? styles.submitBtnDisabled : {}),
            }}
          >
            {isSubmitting ? (
              <>
                <span style={styles.btnSpinner} aria-hidden="true">⏳</span>
                {status === "approving" ? "Approving…" : status === "awaiting_sig" ? "Sign in Freighter…" : "Depositing…"}
              </>
            ) : (
              `Deposit ${amount ? `${amount} ${symbol}` : ""}`
            )}
          </button>
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
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-4)",
  },
  infoRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "var(--space-2)",
    padding: "var(--space-3) var(--space-4)",
    background: "var(--color-surface-1)",
    borderRadius: "var(--radius-md)",
  },
  infoLabel: {
    fontSize: "var(--text-sm)",
    color: "var(--color-text-secondary)",
  },
  infoValue: {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-2)",
    fontSize: "var(--text-sm)",
    fontWeight: 500,
  },
  symbolBadge: {
    padding: "0.1rem 0.4rem",
    background: "var(--color-secondary-light)",
    color: "var(--color-secondary-hover)",
    borderRadius: "var(--radius-sm)",
    fontSize: "0.75rem",
    fontWeight: 700,
  },
  addrMono: {
    fontFamily: "var(--font-mono)",
    fontSize: "var(--text-sm)",
    color: "var(--color-text-secondary)",
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
    fontFamily: "var(--font-mono)",
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
  preview: {
    padding: "var(--space-4)",
    background: "var(--color-surface-1)",
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--color-border)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-2)",
  },
  previewTitle: {
    margin: 0,
    fontSize: "0.75rem",
    fontWeight: 700,
    color: "var(--color-text-secondary)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
    marginBottom: "var(--space-1)",
  },
  previewRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "var(--space-2)",
    fontSize: "var(--text-sm)",
  },
  previewLabel: {
    color: "var(--color-text-secondary)",
    flexShrink: 0,
  },
  previewValue: {
    color: "var(--color-text-primary)",
    fontWeight: 500,
    textAlign: "right" as const,
  },
  previewDivider: {
    height: "1px",
    background: "var(--color-border)",
    margin: "var(--space-1) 0",
  },
  code: {
    fontFamily: "var(--font-mono)",
    background: "var(--color-surface-2)",
    padding: "0.1rem 0.3rem",
    borderRadius: "var(--radius-sm)",
    fontSize: "0.9em",
  },
  submitBtn: {
    padding: "var(--space-4)",
    background: "var(--color-primary)",
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
  btnSpinner: {
    fontSize: "1rem",
  },
};
