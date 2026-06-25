"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWallet } from "@/hooks/useWallet";
import SearchBar from "@/components/SearchBar";
import { useNotificationsContext } from "@/contexts/NotificationsContext";

/** Truncates a Stellar address to G…XXXX format */
function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function NavBar() {
  const router = useRouter();
  const { address, connected, network, connect, disconnect } = useWallet();
  const { unreadCount } = useNotificationsContext();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[var(--border)] bg-[var(--background)]/80 backdrop-blur-sm">
      <nav className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Brand */}
        <a
          href="/"
          className="text-xl font-extrabold tracking-tight text-violet-500 hover:text-violet-400 transition-colors"
        >
          Linkora
        </a>

        <SearchBar
          onSearch={(query) => router.push(`/search?q=${encodeURIComponent(query)}`)}
          placeholder="Search posts and profiles"
          className="w-full max-w-xl sm:flex-1"
        />

        {/* Right side */}
        <div className="flex items-center gap-3">
          {connected && (
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
          )}
          {connected && address ? (
            <>
              {/* Network badge */}
              {network && (
                <span className="hidden sm:inline-flex items-center rounded-full bg-violet-900/40 px-2.5 py-0.5 text-xs font-medium text-violet-300 border border-violet-700/50">
                  {network}
                </span>
              )}

              {/* Address chip */}
              <span
                className="font-mono text-sm text-[var(--foreground)] bg-[var(--muted)] border border-[var(--border)] rounded-lg px-3 py-1.5 select-all"
                title={address}
                aria-label={`Connected address: ${address}`}
              >
                {truncateAddress(address)}
              </span>

              {/* Disconnect */}
              <button
                onClick={disconnect}
                className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--text-muted)] hover:border-red-500/60 hover:text-red-400 transition-colors"
                aria-label="Disconnect wallet"
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              onClick={connect}
              className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-violet-500 transition-colors"
              aria-label="Connect Freighter wallet"
            >
              Connect Wallet
            </button>
          )}
        </div>
      </nav>
    </header>
  );
}
