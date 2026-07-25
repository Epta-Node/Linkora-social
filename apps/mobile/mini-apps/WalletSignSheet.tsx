"use client";

export type WalletSignSheetProps = {
  xdr: string;
  onApprove: () => void;
  onReject: () => void;
};

export function WalletSignSheet({ xdr, onApprove, onReject }: WalletSignSheetProps) {
  return (
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-label="Sign transaction">
      <div style={styles.sheet}>
        <h2 style={styles.title}>Sign Transaction</h2>
        <p style={styles.description}>
          A mini app is requesting your signature for the following transaction:
        </p>

        <pre style={styles.xdr} aria-label="Transaction XDR">
          {xdr}
        </pre>

        <div style={styles.actions}>
          <button onClick={onReject} style={styles.rejectButton}>
            Reject
          </button>
          <button onClick={onApprove} style={styles.approveButton}>
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "flex-end",
    zIndex: 1000,
  },
  sheet: {
    width: "100%",
    background: "var(--color-bg)",
    borderRadius: "16px 16px 0 0",
    padding: "var(--spacing-lg)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-md)",
  },
  title: {
    margin: 0,
    fontSize: "1.1rem",
    fontWeight: 600,
  },
  description: {
    margin: 0,
    fontSize: "0.9rem",
    color: "var(--color-text-secondary)",
  },
  xdr: {
    background: "var(--color-border)",
    borderRadius: "8px",
    padding: "var(--spacing-md)",
    fontSize: "0.75rem",
    fontFamily: "monospace",
    overflowX: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    maxHeight: "160px",
    overflowY: "auto",
  },
  actions: {
    display: "flex",
    gap: "var(--spacing-md)",
  },
  rejectButton: {
    flex: 1,
    padding: "var(--spacing-md)",
    borderRadius: "8px",
    border: "1px solid var(--color-border)",
    background: "transparent",
    fontSize: "1rem",
    cursor: "pointer",
  },
  approveButton: {
    flex: 1,
    padding: "var(--spacing-md)",
    borderRadius: "8px",
    background: "var(--color-primary)",
    color: "white",
    fontWeight: 600,
    fontSize: "1rem",
    cursor: "pointer",
  },
};
