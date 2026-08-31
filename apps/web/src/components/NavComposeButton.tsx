"use client";

import { useWallet } from "./WalletProvider";

export function NavComposeButton() {
  const { isConnected } = useWallet();

  if (!isConnected) return null;

  return (
    <button
      onClick={() => window.dispatchEvent(new Event("open-compose"))}
      style={{
        background: "var(--color-primary, #0ea5e9)",
        color: "white",
        border: "none",
        borderRadius: "20px",
        padding: "6px 16px",
        fontSize: "0.85rem",
        fontWeight: 600,
        cursor: "pointer",
        transition: "background 0.2s",
        display: "flex",
        alignItems: "center",
        gap: "4px",
      }}
      aria-label="Compose post"
    >
      <span style={{ fontSize: "1.1rem" }}>+</span> Compose
    </button>
  );
}
