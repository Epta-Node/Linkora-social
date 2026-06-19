import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import "./styles/globals.css";
import { WalletProvider } from "./components/WalletProvider";
import { ConnectWallet } from "./components/ConnectWallet";
import { NotificationProvider } from "./context/NotificationContext";

export const metadata: Metadata = {
  title: "Linkora Web",
  description: "Web frontend scaffold for Linkora Social",
};

const navStyles: CSSProperties = {
  borderBottom: "1px solid #e5e7eb",
  background: "#ffffff",
};

const navContainer: CSSProperties = {
  maxWidth: 1120,
  margin: "0 auto",
  padding: "14px 24px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 24,
};

const logo: CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  color: "#111827",
  textDecoration: "none",
};

const navLinks: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
};

const navLink: CSSProperties = {
  color: "#374151",
  fontSize: 14,
  textDecoration: "none",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NotificationProvider>
          <WalletProvider>
            <nav style={navStyles}>
              <div style={navContainer}>
                <a href="/" style={logo}>
                  Linkora
                </a>
                <div style={navLinks}>
                  <a href="/feed" style={navLink}>
                    Feed
                  </a>
                  <a href="/explore" style={navLink}>
                    Explore
                  </a>
                  <a href="/pools" style={navLink}>
                    Pools
                  </a>
                  <ConnectWallet />
                </div>
              </div>
            </nav>
            {children}
          </WalletProvider>
        </NotificationProvider>
      </body>
    </html>
  );
}
