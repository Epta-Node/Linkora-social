"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWallet } from "@/hooks/useWallet";
import SearchBar from "@/components/SearchBar";
import { BottomNav } from "@/components/mobile/BottomNav";
import { useNotificationsContext } from "@/contexts/NotificationsContext";
import { CreatePostModal } from "@/components/modals/CreatePostModal";
import { WalletModal } from "@/components/modals/WalletModal";
import { useKeyboardShortcutsContext } from "@/contexts/KeyboardShortcutsContext";
import {
  getStoredThemePreference,
  storeThemePreference,
  type ThemePreference,
} from "@/components/ThemeBootstrap";

import { Logo } from "@/components/branding/Logo";

/** Truncates a Stellar address to G…XXXX format */
function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function NavBar() {
  const router = useRouter();
  const { address, connected, network, connect, disconnect } = useWallet();
  const { unreadCount } = useNotificationsContext();
  const { registerComposeHandler, unregisterComposeHandler, registerSearchRef } =
    useKeyboardShortcutsContext();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [showFreighterBanner, setShowFreighterBanner] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>("light");

  // Ref forwarded to SearchBar so the '/' shortcut can focus the input
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Register/unregister compose handler for the 'n' shortcut
  useEffect(() => {
    registerComposeHandler(() => setIsModalOpen(true));
    registerSearchRef(searchInputRef as React.RefObject<HTMLInputElement | null>);
    return () => {
      unregisterComposeHandler();
    };
  }, [registerComposeHandler, unregisterComposeHandler, registerSearchRef]);

  // Initialize theme from storage
  useEffect(() => {
    setTheme(getStoredThemePreference());
  }, []);

  const toggleTheme = useCallback(() => {
    const newTheme: ThemePreference = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    storeThemePreference(newTheme);
  }, [theme]);

  const handleConnect = useCallback(async () => {
    try {
      await connect();
    } catch {
      setShowFreighterBanner(true);
    }
  }, [connect]);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur-sm">
      {/* Freighter not-installed banner */}
      {showFreighterBanner && (
        <div
          className="flex items-center justify-between gap-4 bg-amber-950/60 border-b border-amber-700/50 px-4 py-2.5 text-sm"
          role="alert"
        >
          <div className="flex items-center gap-2">
            <span className="text-amber-400 font-bold">Freighter not detected.</span>
            <span className="text-amber-200/80">
              Install the{" "}
              <a
                href="https://freighter.app"
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-semibold text-amber-300 hover:text-amber-200"
              >
                Freighter browser extension
              </a>{" "}
              to connect your wallet.
            </span>
          </div>
          <button
            onClick={() => setShowFreighterBanner(false)}
            className="shrink-0 text-amber-400/70 hover:text-amber-300 transition-colors"
            aria-label="Dismiss banner"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
      <nav className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:py-3">
        {/* Brand */}
        <Logo variant="full" size="md" />

        <SearchBar
          onSearch={(query) => router.push(`/search?q=${encodeURIComponent(query)}`)}
          placeholder="Search posts and profiles"
          className="w-full max-w-xl sm:flex-1"
          inputRef={searchInputRef}
        />

        {/* Right side */}
        <div className="flex items-center gap-2 sm:gap-3">
          {connected && (
            <div className="hidden md:flex items-center gap-3">
              <button
                onClick={toggleTheme}
                className="rounded-lg p-1.5 text-[var(--text-muted)] hover:text-violet-400 transition-colors"
                aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
                title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
              >
                {theme === "light" ? (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="h-5 w-5"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
                    />
                  </svg>
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    className="h-5 w-5"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
                    />
                  </svg>
                )}
              </button>
              <Link
                href="/analytics"
                className="rounded-lg p-1.5 text-[var(--text-muted)] hover:text-violet-400 transition-colors"
                aria-label="Analytics"
                data-testid="analytics-link"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
                  />
                </svg>
              </Link>
              <Link
                href="/governance"
                className="rounded-lg p-1.5 text-[var(--text-muted)] hover:text-violet-400 transition-colors"
                aria-label="Governance"
                data-testid="governance-link"
                data-tour="governance"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0 0 12 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75Z"
                  />
                </svg>
              </Link>
              <Link
                href="/notifications"
                aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
                className="relative rounded-lg p-1.5 text-[var(--text-muted)] hover:text-violet-400 transition-colors"
                data-testid="notifications-bell"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
                  />
                </svg>
                {unreadCount > 0 && (
                  <span
                    className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 text-[10px] font-bold text-white"
                    aria-hidden="true"
                    data-testid="unread-badge"
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Link>
            </div>
          )}
          {connected && address ? (
            <>
              {/* Compose button */}
              <button
                onClick={() => setIsModalOpen(true)}
                className="hidden md:inline-block rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-violet-500 transition-colors"
                aria-label="Compose new post"
              >
                Compose
              </button>

              {/* Network badge */}
              {network && (
                <span className="hidden sm:inline-flex items-center rounded-full bg-violet-900/40 px-2.5 py-0.5 text-xs font-medium text-violet-300 border border-violet-700/50">
                  {network}
                </span>
              )}

              {/* Address chip — opens WalletModal */}
              <button
                onClick={() => setIsWalletModalOpen(true)}
                className="font-mono text-xs sm:text-sm text-[var(--foreground)] bg-[var(--muted)] border border-[var(--border)] rounded-lg px-2 sm:px-3 py-1.5 select-all cursor-pointer hover:border-violet-500/50 transition-colors"
                title={address}
                aria-label={`Connected address: ${address}. Click to view wallet details.`}
                data-testid="wallet-address"
              >
                {truncateAddress(address)}
              </button>
            </>
          ) : (
            <button
              onClick={handleConnect}
              className="rounded-lg bg-violet-600 px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-semibold text-white hover:bg-violet-500 transition-colors"
              aria-label="Connect Freighter wallet"
              data-testid="connect-wallet"
            >
              Connect
            </button>
          )}
        </div>
      </nav>

      {/* Compose Modal */}
      <CreatePostModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        author={address ?? undefined}
      />

      {/* Wallet Modal */}
      <WalletModal
        isOpen={isWalletModalOpen}
        onClose={() => setIsWalletModalOpen(false)}
        address={address}
        network={network}
        onDisconnect={disconnect}
      />

      <BottomNav onCompose={() => setIsModalOpen(true)} />
    </header>
  );
}
