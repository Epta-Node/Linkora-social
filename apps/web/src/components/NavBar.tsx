"use client";

import { useRouter } from "next/navigation";
import { useWallet } from "@/hooks/useWallet";
import SearchBar from "@/components/SearchBar";

/** Truncates a Stellar address to G…XXXX format */
function truncateAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function NavBar() {
  const router = useRouter();
  const { address, connected, network, connect, disconnect } = useWallet();

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
