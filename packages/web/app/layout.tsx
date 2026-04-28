import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./styles/globals.css";
import { WalletProvider } from "./components/WalletProvider";
import { ConnectWallet } from "./components/ConnectWallet";

export const metadata: Metadata = {
  title: "Linkora Web",
  description: "Web frontend scaffold for Linkora Social",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <nav style={navStyles}>
            <div style={navContainer}>
              <a href="/" style={logo}>Linkora</a>
              <div style={navLinks}>
                <a href="/feed" style={navLink}>Feed</a>
                <a href="/explore" style={navLink}>Explore</a>
                <a href="/pools" style={navLink}>Pools</a>
                <ConnectWallet />
              </div>
            </div>
          </nav>
          {children}
        </WalletProvider>
      </body>
    </html>
  );
}

const navStyles: React.CSSProperties = {
  background: "var(--color-bg)",
  borderBottom: "1px solid var(--color-border)",
  padding: "var(--spacing-md) var(--spacing-lg)",
  position: "sticky",
  top: 0,
  zIndex: 100,
};

const navContainer: React.CSSProperties = {
  maxWidth: "1200px",
  margin: "0 auto",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const logo: React.CSSProperties = {
  fontSize: "1.5rem",
  fontWeight: 700,
  color: "var(--color-primary)",
  textDecoration: "none",
};

const navLinks: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--spacing-lg)",
};

const navLink: React.CSSProperties = {
  color: "var(--color-text)",
  textDecoration: "none",
  fontWeight: 500,
};