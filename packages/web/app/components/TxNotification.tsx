"use client";

import React, { useEffect, useState } from "react";
import type { Notification } from "../context/NotificationContext";
import { normalizeError } from "../lib/normalizeError";

interface TxNotificationProps {
  notification: Notification;
  onClose: () => void;
}

export function TxNotification({ notification, onClose }: TxNotificationProps) {
  const isPending = notification.status === "pending";
  const isSuccess = notification.status === "success";
  const isError = notification.status === "error";

  const [pendingStage, setPendingStage] = useState<'waiting' | 'submitting'>('waiting');

  useEffect(() => {
    let t: number | undefined;
    if (isPending) {
      // show "Waiting for signature..." first, then "Submitting..." if still pending
      t = window.setTimeout(() => setPendingStage('submitting'), 2500);
    }
    return () => {
      if (t) clearTimeout(t);
      setPendingStage('waiting');
    };
  }, [isPending]);

  const getStellarExpertLink = (hash: string) => {
    return `https://stellar.expert/explorer/testnet/tx/${hash}`;
  };

  const role = isError ? 'alert' : 'status';

  return (
    <div
      role={role}
      aria-live={isError ? 'assertive' : 'polite'}
      style={{
        background: "var(--color-bg)",
        border: `1px solid ${
          isError ? "var(--color-like)" : isSuccess ? "var(--color-success)" : "var(--color-primary)"
        }`,
        borderRadius: "8px",
        padding: "16px",
        width: "300px",
        boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {isPending && <span style={styles.spinner} aria-hidden="true" />}
          {isSuccess && <span aria-hidden="true" style={{ color: "var(--color-success)" }}>✅</span>}
          {isError && <span aria-hidden="true" style={{ color: "var(--color-like)" }}>❌</span>}

          <strong style={{ fontSize: "1rem" }}>
            {isPending ? (pendingStage === 'waiting' ? 'Waiting for signature...' : 'Submitting...') : isSuccess ? 'Transaction confirmed' : 'Transaction failed'}
          </strong>
        </div>
        <button
          onClick={onClose}
          aria-label="Close notification"
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            fontSize: "1.2rem",
            color: "var(--color-text-secondary)",
          }}
        >
          ×
        </button>
      </div>

      <p style={{ margin: 0, fontSize: "0.9rem", color: "var(--color-text-secondary)" }}>
        {isError ? normalizeError(notification.message) : notification.message}
      </p>

      {isSuccess && notification.txHash && (
        <a
          href={getStellarExpertLink(notification.txHash)}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: "0.85rem",
            color: "var(--color-primary)",
            textDecoration: "none",
          }}
        >
          View on Stellar Expert ↗
        </a>
      )}

      {isError && (
        <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--color-text-secondary)" }}>
          Please review the error and try again.
        </p>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  spinner: {
    display: "inline-block",
    width: "16px",
    height: "16px",
    border: "2px solid var(--color-border)",
    borderTopColor: "var(--color-primary)",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
  }
};
