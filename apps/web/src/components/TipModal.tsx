"use client";

import React, { useState, useEffect } from "react";
import { useTip } from "@/hooks/useTip";

interface TipModalProps {
  postId: number;
  authorName: string;
  onClose: () => void;
}

const SUPPORTED_TOKENS = [
  {
    symbol: "XLM",
    name: "Stellar Lumens",
    address: "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZXG5CHCGZXG5CHCGZXG5",
    decimals: 7,
    icon: "🪙",
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    address: "GDQOE23CFSUMSVQK4Y5JHPPYK73VYCNHZHA7ENKCV37P6SUEO6XQBKPP",
    decimals: 7,
    icon: "💵",
  },
];

export function TipModal({ postId, authorName, onClose }: TipModalProps) {
  const [amount, setAmount] = useState("");
  const [tokenIndex, setTokenIndex] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const { status, result, error, tip, reset } = useTip();

  const selectedToken = SUPPORTED_TOKENS[tokenIndex];

  // Protocol fee logic (1.0% = 100 BPS)
  const PROTOCOL_FEE_BPS = 100;
  const protocolFeePercent = PROTOCOL_FEE_BPS / 100;
  const amountNum = parseFloat(amount) || 0;
  const feeAmount = amountNum * (protocolFeePercent / 100);
  const authorAmount = Math.max(0, amountNum - feeAmount);

  useEffect(() => {
    // Lock body scrolling when modal is open
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      setErrorMsg("Please enter a valid positive amount.");
      return;
    }
    setErrorMsg("");

    // Execute transaction via custom hook
    await tip(
      "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", // Mock user wallet address
      BigInt(postId),
      selectedToken.address,
      amount,
      selectedToken.decimals,
      "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD7Q" // Mock contract address
    );
  };

  const handleClose = () => {
    reset();
    onClose();
  };

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
                You have tipped <strong>@{authorName}</strong> {amount} {selectedToken.symbol}.
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
          ) : (
            <form onSubmit={handleConfirm} style={styles.form}>
              <div style={styles.recipientBadge}>
                Tipping <strong style={styles.recipientName}>@{authorName}</strong> for Post #
                {postId}
              </div>

              {/* Token Selection */}
              <div style={styles.fieldGroup}>
                <label style={styles.fieldLabel}>Select Token</label>
                <div style={styles.tokenGrid}>
                  {SUPPORTED_TOKENS.map((token, idx) => (
                    <button
                      key={token.symbol}
                      type="button"
                      onClick={() => setTokenIndex(idx)}
                      style={{
                        ...styles.tokenTab,
                        ...(tokenIndex === idx ? styles.activeTokenTab : {}),
                      }}
                    >
                      <span style={styles.tokenIcon}>{token.icon}</span>
                      <span style={styles.tokenSymbol}>{token.symbol}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount Input */}
              <div style={styles.fieldGroup}>
                <label htmlFor="tip-amount" style={styles.fieldLabel}>
                  Amount
                </label>
                <div style={styles.inputWrapper}>
                  <input
                    id="tip-amount"
                    type="number"
                    min="0.00001"
                    step="any"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    disabled={status !== "idle" && status !== "error"}
                    style={styles.textInput}
                    required
                  />
                  <span style={styles.tokenSuffix}>{selectedToken.symbol}</span>
                </div>
                {errorMsg && <p style={styles.errorMessage}>{errorMsg}</p>}
                {error && <p style={styles.errorMessage}>{error}</p>}
              </div>

              {/* Fee Breakdown Breakdown */}
              <div style={styles.breakdown}>
                <div style={styles.breakdownRow}>
                  <span>Protocol Fee ({protocolFeePercent.toFixed(1)}%)</span>
                  <span>
                    {feeAmount.toFixed(4)} {selectedToken.symbol}
                  </span>
                </div>
                <div style={{ ...styles.breakdownRow, ...styles.authorPayoutRow }}>
                  <span>Creator Payout</span>
                  <span style={styles.payoutValue}>
                    {authorAmount.toFixed(4)} {selectedToken.symbol}
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
                  <button type="submit" style={styles.primaryButton}>
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
  tokenGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
  },
  tokenTab: {
    background: "#0f172a",
    border: "1px solid rgba(255, 255, 255, 0.05)",
    borderRadius: "12px",
    padding: "12px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    cursor: "pointer",
    minHeight: "44px",
    transition: "all 0.2s",
  },
  activeTokenTab: {
    background: "rgba(124, 58, 237, 0.2)",
    borderColor: "#7c3aed",
    boxShadow: "0 0 12px rgba(124, 58, 237, 0.25)",
  },
  tokenIcon: {
    fontSize: "1.2rem",
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
