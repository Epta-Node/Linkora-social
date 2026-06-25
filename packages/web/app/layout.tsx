import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./styles/globals.css";
import { WalletProvider } from "./components/WalletProvider";
import { Navbar } from "./components/Navbar";
import { NotificationProvider } from "./context/NotificationContext";
import { ComposeModal } from "./components/ComposeModal";

export const metadata: Metadata = {
  title: "Linkora Web",
  description: "Web frontend scaffold for Linkora Social",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NotificationProvider>
          <WalletProvider>
            <Navbar />
            {children}
            <ComposeModal />
          </WalletProvider>
        </NotificationProvider>
      </body>
    </html>
  );
}
