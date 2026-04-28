"use client";

import { useWallet, formatAddress } from "./WalletProvider";

export function ConnectWallet() {
  const { isConnected, isConnecting, error, connect, disconnect, publicKey } = useWallet();

  if (isConnected && publicKey) {
    return (
      <div style={styles.container}>
        <div style={styles.addressBadge}>
          <span style={styles.address}>{formatAddress(publicKey)}</span>
        </div>
        <button onClick={disconnect} style={styles.disconnectButton}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <button
        onClick={connect}
        disabled={isConnecting}
        style={styles.connectButton}
      >
        {isConnecting ? "Connecting..." : "Connect Wallet"}
      </button>
      {error && <p style={styles.error}>{error}</p>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-md)",
  },
  connectButton: {
    padding: "var(--spacing-sm) var(--spacing-lg)",
    background: "var(--color-primary)",
    color: "white",
    borderRadius: "8px",
    fontWeight: 600,
    transition: "background 0.2s",
    minHeight: "var(--min-touch-target)",
  },
  disconnectButton: {
    padding: "var(--spacing-sm) var(--spacing-md)",
    background: "var(--color-bg-secondary)",
    color: "var(--color-text)",
    border: "1px solid var(--color-border)",
    borderRadius: "8px",
    fontWeight: 500,
    transition: "all 0.2s",
    minHeight: "var(--min-touch-target)",
  },
  addressBadge: {
    padding: "var(--spacing-sm) var(--spacing-md)",
    background: "var(--color-bg-secondary)",
    borderRadius: "8px",
    fontSize: "0.9rem",
    fontFamily: "monospace",
  },
  address: {
    fontWeight: 500,
  },
  error: {
    color: "var(--color-like)",
    fontSize: "0.85rem",
    marginTop: "var(--spacing-xs)",
  },
};