"use client";

import React, { useState, useEffect, useMemo, useId } from "react";
import { stellarAssetContractId } from "linkora-sdk";
import { useTip } from "@/hooks/useTip";
import { useTokenBalances, type TokenWithPrice } from "@/hooks/useTokenBalances";
import { useWalletContext } from "@/components/WalletProvider";
import { config } from "@/config";
import {
  CLASSIC_ASSET_DECIMALS,
  toBaseUnits,
  trimAmount as trimBalance,
  validateTipAmount,
} from "@/lib/tipValidation";

interface TipModalProps {
  postId: number;
  authorName: string;
  onClose: () => void;
}

/** A wallet balance the contract's `tip` can be called with. */
export interface TipToken {
  /** Stable key: `XLM` or `CODE:ISSUER`. */
  key: string;
  symbol: string;
  issuer: string | null;
  /** Stellar Asset Contract address passed to `tip`. */
  contractId: string;
  balance: string;
  decimals: number;
}

/** Maps Horizon balances to tippable tokens, skipping assets without a SAC. */
export function toTipTokens(tokens: TokenWithPrice[], networkPassphrase: string): TipToken[] {
  return tokens.flatMap((t) => {
    const contractId = stellarAssetContractId(t, networkPassphrase);
    if (!contractId) return [];
    const symbol = t.asset_type === "native" ? "XLM" : (t.asset_code ?? "");
    return [
      {
        key: t.asset_type === "native" ? "XLM" : `${t.asset_code}:${t.asset_issuer}`,
        symbol,
        issuer: t.asset_type === "native" ? null : (t.asset_issuer ?? null),
        contractId,
        balance: t.balance,
        decimals: CLASSIC_ASSET_DECIMALS,
      },
    ];
  });
}

function shortIssuer(issuer: string): string {
  return `${issuer.slice(0, 4)}…${issuer.slice(-4)}`;
}

export function TipModal({ postId, authorName, onClose }: TipModalProps) {
  const { address } = useWalletContext();
  const { tokens: balances, isLoading, error: balancesError, refresh } = useTokenBalances(address);
  const [amount, setAmount] = useState("");
  const [touched, setTouched] = useState(false);
  const [tokenKey, setTokenKey] = useState<string | null>(null);
  const { status, result, error, tip, reset } = useTip();
  const amountId = useId();
  const amountErrorId = useId();

  const tokens = useMemo(() => toTipTokens(balances, config.networkPassphrase), [balances]);
  const selectedToken = tokens.find((t) => t.key === tokenKey) ?? null;

  // Default to the first token once balances load (or if the selection disappears).
  useEffect(() => {
    if (tokens.length > 0 && !tokens.some((t) => t.key === tokenKey)) setTokenKey(tokens[0].key);
  }, [tokens, tokenKey]);

  const amountError = validateTipAmount(amount, selectedToken);
  const showAmountError = Boolean(amountError) && (touched || amount !== "");
  const busy = status !== "idle" && status !== "error";
  const canSubmit = !amountError && !busy && Boolean(address);

  // Protocol fee logic (1.0% = 100 BPS), computed in base units.
  const PROTOCOL_FEE_BPS = 100n;
  const protocolFeePercent = Number(PROTOCOL_FEE_BPS) / 100;
  const decimals = selectedToken?.decimals ?? CLASSIC_ASSET_DECIMALS;
  const amountUnits = (!amountError && toBaseUnits(amount, decimals)) || 0n;
  const feeUnits = (amountUnits * PROTOCOL_FEE_BPS) / 10_000n;
  const formatUnits = (units: bigint) => (Number(units) / 10 ** decimals).toFixed(4);

  useEffect(() => {
    // Lock body scrolling when modal is open
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit || !selectedToken || !address) return;
    await tip(
      address,
      BigInt(postId),
      selectedToken.contractId,
      amount.trim(),
      selectedToken.decimals,
      config.contractId
    );
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const symbol = selectedToken?.symbol ?? "";

  return (
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-label="Send a Tip">
      <div style={styles.modalCard}>
        {/* Header */}
        <header style={styles.header}>
          <h2 style={styles.title}>Send Tip</h2>
          <button onClick={handleClose} style={styles.closeBtn} aria-label="Close modal">
            ✕
          </button>
        </header>

        {/* Content Body */}
        <div style={styles.body}>
          {status === "success" && result ? (
            <div style={styles.successContainer}>
              <div style={styles.successBadge}>✓</div>
              <h3 style={styles.successTitle}>Transaction Successful!</h3>
              <p style={styles.successDesc}>
                You have tipped <strong>@{authorName}</strong> {amount} {symbol}.
              </p>
              <div style={styles.txBox}>
                <div style={styles.txRow}>
                  <span style={styles.txLabel}>Transaction Hash</span>
                  <code style={styles.txHash}>{result.hash.slice(0, 16)}...</code>
                </div>
                <div style={styles.txRow}>
                  <span style={styles.txLabel}>Ledger Sequence</span>
                  <span style={styles.txValue}>{result.ledger}</span>
                </div>
              </div>
              <button onClick={handleClose} style={styles.primaryButton}>
                Done
              </button>
            </div>
          ) : !address ? (
            <p style={styles.emptyState} role="status">
              Connect your wallet to send a tip.
            </p>
          ) : (
            <form onSubmit={handleConfirm} style={styles.form} noValidate>
              <div style={styles.recipientBadge}>
                Tipping <strong style={styles.recipientName}>@{authorName}</strong> for Post #
                {postId}
              </div>

              {/* Token Selection */}
              <fieldset style={styles.fieldset} disabled={busy}>
                <legend style={styles.fieldLabel}>Token</legend>
                {isLoading && tokens.length === 0 ? (
                  <p style={styles.hint} role="status">
                    Loading your balances…
                  </p>
                ) : balancesError && tokens.length === 0 ? (
                  <div style={styles.inlineAlert} role="alert">
                    <span>Could not load your balances: {balancesError}</span>
                    <button type="button" onClick={() => void refresh()} style={styles.linkButton}>
                      Retry
                    </button>
                  </div>
                ) : tokens.length === 0 ? (
                  <p style={styles.hint} role="status">
                    No tippable tokens in this wallet. Fund it with XLM or add a trustline to tip.
                  </p>
                ) : (
                  <div role="radiogroup" aria-label="Token" style={styles.tokenList}>
                    {tokens.map((token) => {
                      const checked = token.key === tokenKey;
                      return (
                        <label
                          key={token.key}
                          style={{
                            ...styles.tokenOption,
                            ...(checked ? styles.activeTokenTab : {}),
                          }}
                        >
                          <input
                            type="radio"
                            name="tip-token"
                            value={token.key}
                            checked={checked}
                            onChange={() => setTokenKey(token.key)}
                            style={styles.radio}
                          />
                          <span style={styles.tokenSymbol}>{token.symbol}</span>
                          {token.issuer && (
                            <span style={styles.tokenIssuer} title={token.issuer}>
                              {shortIssuer(token.issuer)}
                            </span>
                          )}
                          <span style={styles.tokenBalance}>
                            {trimBalance(token.balance)} available
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </fieldset>

              {/* Amount Input */}
              <div style={styles.fieldGroup}>
                <label htmlFor={amountId} style={styles.fieldLabel}>
                  Amount
                </label>
                <div style={styles.inputWrapper}>
                  <input
                    id={amountId}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    onBlur={() => setTouched(true)}
                    placeholder="0.00"
                    disabled={busy || !selectedToken}
                    aria-invalid={showAmountError}
                    aria-describedby={showAmountError ? amountErrorId : undefined}
                    style={{
                      ...styles.textInput,
                      ...(showAmountError ? styles.textInputError : {}),
                    }}
                  />
                  <span style={styles.tokenSuffix}>{symbol}</span>
                </div>
                {selectedToken && (
                  <button
                    type="button"
                    onClick={() => {
                      setAmount(trimBalance(selectedToken.balance));
                      setTouched(true);
                    }}
                    disabled={busy}
                    style={styles.linkButton}
                  >
                    Max: {trimBalance(selectedToken.balance)} {selectedToken.symbol}
                  </button>
                )}
                {showAmountError && (
                  <p id={amountErrorId} style={styles.errorMessage} role="alert">
                    {amountError}
                  </p>
                )}
                {error && (
                  <p style={styles.errorMessage} role="alert">
                    {error}
                  </p>
                )}
              </div>

              {/* Fee Breakdown Breakdown */}
              <div style={styles.breakdown}>
                <div style={styles.breakdownRow}>
                  <span>Protocol Fee ({protocolFeePercent.toFixed(1)}%)</span>
                  <span>
                    {formatUnits(feeUnits)} {symbol}
                  </span>
                </div>
                <div style={{ ...styles.breakdownRow, ...styles.authorPayoutRow }}>
                  <span>Creator Payout</span>
                  <span style={styles.payoutValue}>
                    {formatUnits(amountUnits - feeUnits)} {symbol}
                  </span>
                </div>
              </div>

              {/* Status Indications */}
              {status === "approving" && (
                <div style={styles.statusBox}>
                  <span style={styles.spinner} />
                  <span>Approving token spending limit...</span>
                </div>
              )}

              {status === "awaiting_sig" && (
                <div style={styles.statusBox}>
                  <span style={styles.spinner} />
                  <span>Awaiting Freighter signature...</span>
                </div>
              )}

              {status === "submitting" && (
                <div style={styles.statusBox}>
                  <span style={styles.spinner} />
                  <span>Submitting transaction to Stellar...</span>
                </div>
              )}

              {/* Modal Actions */}
              {(status === "idle" || status === "error") && (
                <div style={styles.actions}>
                  <button type="button" onClick={handleClose} style={styles.secondaryButton}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    style={{
                      ...styles.primaryButton,
                      ...(!canSubmit ? styles.disabledButton : {}),
                    }}
                  >
                    Confirm Tip
                  </button>
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 23, 42, 0.75)",
    backdropFilter: "blur(12px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: "20px",
    animation: "fadeIn 0.2s ease-out",
  },
  modalCard: {
    background: "rgba(30, 41, 59, 0.95)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: "20px",
    width: "100%",
    maxWidth: "460px",
    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "20px 24px",
    borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
  },
  title: {
    margin: 0,
    fontSize: "1.25rem",
    fontWeight: 700,
    color: "#f8fafc",
  },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: "#94a3b8",
    fontSize: "1.2rem",
    cursor: "pointer",
    minWidth: "44px",
    minHeight: "44px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    transition: "all 0.2s",
  },
  body: {
    padding: "24px",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  recipientBadge: {
    background: "rgba(124, 58, 237, 0.15)",
    border: "1px solid rgba(124, 58, 237, 0.3)",
    padding: "12px 16px",
    borderRadius: "12px",
    color: "#c084fc",
    fontSize: "0.9rem",
    textAlign: "center",
  },
  recipientName: {
    color: "#e9d5ff",
  },
  fieldGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  fieldLabel: {
    fontSize: "0.85rem",
    fontWeight: 600,
    color: "#94a3b8",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  fieldset: {
    border: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  tokenList: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  tokenOption: {
    background: "#0f172a",
    border: "1px solid rgba(255, 255, 255, 0.05)",
    borderRadius: "12px",
    padding: "10px 12px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    cursor: "pointer",
    minHeight: "44px",
  },
  radio: {
    accentColor: "#7c3aed",
  },
  tokenIssuer: {
    fontFamily: "monospace",
    fontSize: "0.75rem",
    color: "#64748b",
  },
  tokenBalance: {
    marginLeft: "auto",
    fontSize: "0.85rem",
    color: "#94a3b8",
  },
  hint: {
    margin: 0,
    fontSize: "0.85rem",
    color: "#94a3b8",
  },
  emptyState: {
    margin: 0,
    textAlign: "center",
    color: "#94a3b8",
  },
  inlineAlert: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    fontSize: "0.85rem",
    color: "#f87171",
  },
  linkButton: {
    alignSelf: "flex-start",
    background: "transparent",
    border: "none",
    padding: 0,
    color: "#a78bfa",
    fontSize: "0.8rem",
    cursor: "pointer",
    textDecoration: "underline",
  },
  textInputError: {
    borderColor: "#f87171",
  },
  disabledButton: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  activeTokenTab: {
    background: "rgba(124, 58, 237, 0.2)",
    borderColor: "#7c3aed",
    boxShadow: "0 0 12px rgba(124, 58, 237, 0.25)",
  },
  tokenSymbol: {
    fontWeight: 700,
    color: "#f8fafc",
  },
  inputWrapper: {
    position: "relative",
    display: "flex",
    alignItems: "center",
  },
  textInput: {
    width: "100%",
    background: "#0f172a",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: "12px",
    padding: "14px 70px 14px 16px",
    fontSize: "1.1rem",
    color: "#f8fafc",
    outline: "none",
    minHeight: "44px",
    transition: "all 0.2s",
  },
  tokenSuffix: {
    position: "absolute",
    right: "16px",
    fontWeight: 700,
    color: "#94a3b8",
  },
  errorMessage: {
    margin: "4px 0 0",
    color: "#f87171",
    fontSize: "0.85rem",
  },
  breakdown: {
    background: "#0f172a",
    borderRadius: "12px",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  breakdownRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "0.85rem",
    color: "#94a3b8",
  },
  authorPayoutRow: {
    borderTop: "1px solid rgba(255, 255, 255, 0.05)",
    paddingTop: "10px",
    color: "#f8fafc",
    fontWeight: 600,
  },
  payoutValue: {
    color: "#10b981",
  },
  statusBox: {
    background: "rgba(15, 23, 42, 0.5)",
    padding: "16px",
    borderRadius: "12px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    fontSize: "0.9rem",
    color: "#94a3b8",
  },
  spinner: {
    width: "20px",
    height: "20px",
    border: "2px solid rgba(255, 255, 255, 0.1)",
    borderTopColor: "#7c3aed",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
  },
  actions: {
    display: "flex",
    gap: "16px",
    marginTop: "8px",
  },
  secondaryButton: {
    flex: 1,
    background: "#334155",
    color: "#f8fafc",
    border: "none",
    borderRadius: "12px",
    fontWeight: 600,
    fontSize: "0.95rem",
    cursor: "pointer",
    minHeight: "44px",
    transition: "background 0.2s",
  },
  primaryButton: {
    flex: 1,
    background: "#7c3aed",
    color: "#f8fafc",
    border: "none",
    borderRadius: "12px",
    fontWeight: 600,
    fontSize: "0.95rem",
    cursor: "pointer",
    minHeight: "44px",
    transition: "background 0.2s",
  },
  successContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    padding: "12px 0",
  },
  successBadge: {
    width: "60px",
    height: "60px",
    background: "rgba(16, 185, 129, 0.15)",
    border: "2px solid #10b981",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#10b981",
    fontSize: "1.8rem",
    marginBottom: "16px",
  },
  successTitle: {
    margin: "0 0 8px 0",
    fontSize: "1.3rem",
    color: "#f8fafc",
  },
  successDesc: {
    margin: "0 0 24px 0",
    fontSize: "0.95rem",
    color: "#94a3b8",
    lineHeight: 1.5,
  },
  txBox: {
    width: "100%",
    background: "#0f172a",
    borderRadius: "12px",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    marginBottom: "24px",
  },
  txRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: "0.85rem",
  },
  txLabel: {
    color: "#64748b",
  },
  txHash: {
    color: "#38bdf8",
    fontFamily: "monospace",
  },
  txValue: {
    color: "#f8fafc",
    fontWeight: 500,
  },
};
