import type { Metadata } from "next";
import "./globals.css";
import { WalletProvider } from "@/components/WalletProvider";
import { NavBar } from "@/components/NavBar";
import { NotificationProvider } from "@/components/NotificationContext";

export const metadata: Metadata = {
  title: "Linkora",
  description: "Decentralised social on Stellar",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NotificationProvider>
          <WalletProvider>
            <NavBar />
            <main>{children}</main>
          </WalletProvider>
        </NotificationProvider>
      </body>
    </html>
  );
}
