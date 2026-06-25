"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

/* ────────────────────────────────────────────────────────────────────────── */
/*  Types                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

interface FollowDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  type: "followers" | "following";
  address: string;
}

interface UserRow {
  address: string;
}

const PAGE_SIZE = 20;
const indexerUrl = process.env.NEXT_PUBLIC_INDEXER_URL || "http://localhost:3001";

/* ────────────────────────────────────────────────────────────────────────── */
/*  Component                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

export function FollowDrawer({ isOpen, onClose, type, address }: FollowDrawerProps) {
  const [users, setUsers] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const offsetRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  /* ── Fetch a page ─────────────────────────────────────────────────── */

  const fetchPage = useCallback(
    async (offset: number, append: boolean) => {
      setLoading(true);
      try {
        const res = await fetch(
          `${indexerUrl}/api/follows/${address}/${type}?limit=${PAGE_SIZE}&offset=${offset}`
        );
        if (!res.ok) return;
        const data = await res.json();
        const list: string[] = data[type] ?? [];
        setTotal(data.total ?? 0);
        setHasMore(data.has_more ?? false);
        setUsers((prev) => (append ? [...prev, ...list] : list));
        offsetRef.current = offset + list.length;
      } catch {
        /* swallow — indexer may be offline */
      } finally {
        setLoading(false);
      }
    },
    [address, type]
  );

  /* Reset and fetch first page when drawer opens or type changes */
  useEffect(() => {
    if (!isOpen) return;
    offsetRef.current = 0;
    setUsers([]);
    fetchPage(0, false);
  }, [isOpen, type, fetchPage]);

  /* ── Infinite scroll inside the drawer ────────────────────────────── */

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || loading || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
      fetchPage(offsetRef.current, true);
    }
  }, [loading, hasMore, fetchPage]);

  /* ── Escape key ───────────────────────────────────────────────────── */

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" id="follow-drawer">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        className="relative w-full max-w-sm bg-[var(--bg-secondary)] h-full shadow-xl flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label={`${type === "followers" ? "Followers" : "Following"} list`}
        style={{
          animation: "slideInRight 0.25s ease-out",
        }}
      >
        {/* Header */}
        <div className="p-4 border-b border-[var(--bg-tertiary)] flex justify-between items-center">
          <h2 className="text-lg font-semibold text-[var(--text-primary)] capitalize">
            {type} <span className="text-sm text-[var(--text-muted)] font-normal">({total})</span>
          </h2>
          <button
            onClick={onClose}
            aria-label="Close drawer"
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors text-xl leading-none"
          >
            ✕
          </button>
        </div>

        {/* Scrollable list */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 space-y-3"
        >
          {users.map((addr) => (
            <a
              key={addr}
              href={`/profile/${addr}`}
              className="flex items-center gap-3 p-3 rounded-xl hover:bg-[var(--bg-tertiary)] transition-colors"
              aria-label={`View profile of ${addr}`}
            >
              {/* Mini blockie */}
              <img
                src={`https://effigy.im/a/${addr}.svg`}
                alt=""
                className="w-10 h-10 rounded-full"
              />
              <span className="font-mono text-sm text-[var(--text-primary)] truncate">
                {addr.slice(0, 6)}…{addr.slice(-4)}
              </span>
            </a>
          ))}

          {loading && (
            <div className="text-center text-sm text-[var(--text-muted)] py-4">Loading…</div>
          )}

          {!loading && users.length === 0 && (
            <div className="text-center text-sm text-[var(--text-muted)] py-12">No {type} yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}
