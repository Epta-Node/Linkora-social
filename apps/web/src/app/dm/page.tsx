"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/hooks/useWallet";

interface Conversation {
  address: string;
  username: string;
}

function getBlockieSvg(address: string) {
  let hash = 0;
  for (let i = 0; i < address.length; i++) {
    hash = address.charCodeAt(i) + ((hash << 5) - hash);
  }
  const c1 = (hash & 0x00ffffff).toString(16).padStart(6, "0");
  const c2 = ((hash >> 8) & 0x00ffffff).toString(16).padStart(6, "0");
  return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" width="40" height="40"><rect width="8" height="8" fill="%23${c1}"/><rect x="1" y="1" width="6" height="6" fill="%23${c2}" opacity="0.6"/></svg>`;
}

function formatAddress(addr: string) {
  return addr.length < 12 ? addr : `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function MessagesPage() {
  const { address, connected, connect } = useWallet();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!connected || !address) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/follows/${address}/following?limit=50`);
        if (!res.ok) throw new Error("Failed to load conversations");
        const data = await res.json();
        if (!cancelled) setConversations(data.following ?? []);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load conversations");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, connected]);

  return (
    <div className="mx-auto max-w-xl px-4 py-6 md:py-8 pb-24 md:pb-8">
      <h1 className="mb-6 text-2xl font-bold text-[var(--color-text-primary)]">Messages</h1>

      {!connected || !address ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--muted)] p-6 text-center shadow-lg">
          <p className="mb-4 text-[var(--text-muted)]">
            Connect your wallet to see your conversations.
          </p>
          <button
            onClick={connect}
            className="rounded-xl bg-violet-600 px-6 py-2.5 font-semibold text-white transition-all hover:bg-violet-500"
          >
            Connect Wallet
          </button>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 p-6" aria-live="polite">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--color-info)]" />
          <p className="text-sm text-[var(--text-muted)]">Loading conversations...</p>
        </div>
      ) : error ? (
        <div
          className="rounded-xl border border-red-800 bg-red-950/40 p-3 text-sm text-red-200"
          role="alert"
        >
          {error}
        </div>
      ) : conversations.length === 0 ? (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--muted)]/50 p-12 text-center">
          <p className="mb-1 text-lg font-bold text-[var(--color-text-primary)]">
            No conversations yet
          </p>
          <p className="text-sm text-[var(--text-muted)]">
            Follow people to start a direct message with them.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2" role="list">
          {conversations.map((user) => (
            <li key={user.address}>
              <Link
                href={`/dm/${user.address}`}
                className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--muted)] p-3 transition-colors hover:border-[var(--color-info)]/40"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getBlockieSvg(user.address)}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded-full border border-[var(--border)]"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-[var(--color-text-primary)]">
                    @{user.username}
                  </p>
                  <p className="truncate font-mono text-xs text-[var(--text-muted)]">
                    {formatAddress(user.address)}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
