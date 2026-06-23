"use client";

import React, { useEffect, useState } from "react";
import type { Notification } from "./NotificationContext";
import { normalizeError } from "@/lib/normalizeError";

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
      t = window.setTimeout(() => setPendingStage('submitting'), 2500);
    }
    return () => {
      if (t) clearTimeout(t);
      setPendingStage('waiting');
    };
  }, [isPending]);

  const getStellarExpertLink = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;

  const role = isError ? 'alert' : 'status';

  return (
    <div role={role} aria-live={isError ? 'assertive' : 'polite'}
      style={{
        background: 'var(--bg, #fff)',
        border: `1px solid ${isError ? 'var(--like)' : isSuccess ? 'var(--success)' : 'var(--primary)'}`,
        borderRadius: 8,
        padding: 16,
        width: 320,
        boxShadow: '0 4px 8px rgba(0,0,0,0.06)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {isPending && <span style={styles.spinner} aria-hidden="true" />}
          {isSuccess && <span aria-hidden="true">✅</span>}
          {isError && <span aria-hidden="true">❌</span>}
          <strong style={{ fontSize: '1rem' }}>
            {isPending ? (pendingStage === 'waiting' ? 'Waiting for signature...' : 'Submitting...') : isSuccess ? 'Transaction confirmed' : 'Transaction failed'}
          </strong>
        </div>
        <button onClick={onClose} aria-label="Close notification" style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}>×</button>
      </div>

      <p style={{ margin: 0, fontSize: 14, color: 'var(--muted, #6b7280)' }}>
        {isError ? normalizeError(notification.message) : notification.message}
      </p>

      {isSuccess && notification.txHash && (
        <a href={getStellarExpertLink(notification.txHash)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--link, #4f46e5)' }}>
          View on Stellar Expert ↗
        </a>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  spinner: {
    display: 'inline-block',
    width: 16,
    height: 16,
    border: '2px solid #e5e7eb',
    borderTopColor: '#6366f1',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  }
};
