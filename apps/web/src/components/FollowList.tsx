"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { LinkoraClient } from "linkora-sdk";
import { OptimisticStore } from "@/lib/optimisticStore";
import { AnimatedList } from "@/components/AnimatedList";

export interface FollowUser {
  address: string;
  username: string;
}

interface FollowListProps {
  address: string;
  type: "followers" | "following";
}

const PAGE_SIZE = 50;

function getBlockieSvg(address: string) {
  let hash = 0;
  for (let i = 0; i < address.length; i++) {
    hash = address.charCodeAt(i) + ((hash << 5) - hash);
  }
  const c1 = (hash & 0x00ffffff).toString(16).padStart(6, "0");
  const c2 = ((hash >> 8) & 0x00ffffff).toString(16).padStart(6, "0");
  return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" width="40" height="40"><rect width="8" height="8" fill="%23${c1}"/><rect x="1" y="1" width="6" height="6" fill="%23${c2}" opacity="0.6"/><rect x="2" y="2" width="4" height="4" fill="%23${c1}" opacity="0.8"/></svg>`;
}

function formatAddress(addr: string) {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function FollowList({ address, type }: FollowListProps) {
  const [users, setUsers] = useState<FollowUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [blockedList, setBlockedList] = useState<string[]>([]);
  const [currentUser, setCurrentUser] = useState<string | null>(null);

  const [, setTick] = useState(0);

  const loadingRef = useRef(false);
  const client = useRef<LinkoraClient | null>(null);

  useEffect(() => {
    client.current = new LinkoraClient({
      contractId:
        process.env.NEXT_PUBLIC_CONTRACT_ID ||
        "CBQHLSNMBF4HS3UX2PV72T75V2SXE7M2EZZTQ6YC5DSXIGGY4NPSAFAF",
      rpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL || "https://soroban-testnet.stellar.org",
    });

    if (typeof window !== "undefined") {
      const storedUser =
        localStorage.getItem("linkora_wallet_address") ||
        localStorage.getItem("linkora_wallet_public_key");
      setCurrentUser(storedUser);

      const storedBlocked = localStorage.getItem("linkora_blocked_accounts");
      if (storedBlocked) {
        try {
          setBlockedList(JSON.parse(storedBlocked));
        } catch {}
      }
    }

    const unsubscribe = OptimisticStore.subscribe(() => {
      setTick((t) => t + 1);
    });
    return unsubscribe;
  }, []);

  const load = useCallback(
    async (pageNumber: number) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setError(null);
      const offset = pageNumber * PAGE_SIZE;

      try {
        const res = await fetch(
          `/api/follows/${address}/${type}?limit=${PAGE_SIZE}&offset=${offset}`
        );
        if (!res.ok) {
          throw new Error("Failed to load list");
        }
        const data = await res.json();
        const listField = type === "followers" ? data.followers : data.following;
        const nextUsers = Array.isArray(listField) ? listField : [];

        setUsers(nextUsers);
        setPage(pageNumber);
        setTotal(Number(data.total ?? offset + nextUsers.length));
        setHasMore(data.has_more ?? nextUsers.length >= PAGE_SIZE);
      } catch (err) {
        setError("Failed to load users. Please try again later.");
        setHasMore(false);
      } finally {
        setLoading(false);
        loadingRef.current = false;
      }
    },
    [address, type]
  );

  useEffect(() => {
    load(0);
  }, [load]);

  const goToPreviousPage = useCallback(() => {
    if (!loading && page > 0) {
      load(page - 1);
    }
  }, [load, loading, page]);

  const goToNextPage = useCallback(() => {
    if (!loading && hasMore) {
      load(page + 1);
    }
  }, [hasMore, load, loading, page]);

  const handleToggleFollow = async (targetUser: FollowUser) => {
    if (!currentUser) {
      // Surface the error inline — no window.alert
      setError("Please connect your wallet to follow users.");
      return;
    }

    const targetAddress = targetUser.address;
    const isFollowing = OptimisticStore.isFollowing(targetAddress);

    OptimisticStore.setFollowing(targetAddress, !isFollowing);
    OptimisticStore.setPending(targetAddress, { isPending: true });

    try {
      const isMockAddress = targetAddress.includes("XXXX") || currentUser.includes("XXXX");
      if (client.current && !isMockAddress) {
        if (isFollowing) {
          await client.current.unfollow(currentUser, targetAddress);
        } else {
          await client.current.follow(currentUser, targetAddress);
        }
      }
      await new Promise((r) => setTimeout(r, 600));
    } catch (err) {
      OptimisticStore.setFollowing(targetAddress, isFollowing);
      // Surface the error inline — no window.alert
      setError(err instanceof Error ? err.message : "Action failed. Please try again.");
    } finally {
      OptimisticStore.setPending(targetAddress, { isPending: false });
    }
  };

  const visibleUsers = users.filter((u) => {
    const isBlocked = blockedList.includes(u.address);
    if (isBlocked) return false;

    if (searchQuery) {
      return u.username.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return true;
  });
  const showPagination = total > PAGE_SIZE || page > 0 || hasMore;

  return (
    <div className="container mx-auto px-4 py-6 md:py-8 max-w-xl">
      <header className="flex flex-col gap-2 mb-6">
        <Link
          href={`/profile/${address}`}
          className="text-sm font-semibold mb-2 inline-block self-start text-[var(--accent)] hover:opacity-80"
        >
          &larr; Back to Profile
        </Link>
        <h1 className="text-2xl font-bold text-[var(--foreground)]">
          {type === "followers" ? "Followers" : "Following"}
        </h1>
      </header>

      <div className="mb-6">
        <input
          type="text"
          placeholder="Filter by username..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-4 py-2.5 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent)] border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] placeholder:text-[var(--text-muted)]"
          aria-label="Filter users by username"
        />
      </div>

      {visibleUsers.length === 0 && !loading && (
        <div className="text-center p-8 rounded-2xl border border-[var(--border)] bg-[var(--muted)]">
          <p className="text-[var(--text-muted)]">No accounts found.</p>
        </div>
      )}

      {/* role="alert" ensures screen readers announce errors as they appear */}
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-[var(--color-error)] bg-[var(--color-error-light)] p-3 text-sm text-[var(--color-error)]"
        >
          {error}
        </div>
      )}

      <AnimatedList
        as="ul"
        role="list"
        aria-label={type === "followers" ? "Followers list" : "Following list"}
        items={visibleUsers}
        getKey={(user) => user.address}
        className="flex flex-col gap-3"
        renderItem={(user, state) => {
          const isFollowing = OptimisticStore.isFollowing(user.address);
          const isPending = OptimisticStore.isPending(user.address);
          const isMe = currentUser?.toLowerCase() === user.address.toLowerCase();

          return (
            // The <li> is a layout container, not an interactive element.
            // Navigation is handled by the inner <Link>; no tabIndex or
            // keyboard handler belongs here.
            <li
              key={user.address}
              role="listitem"
              className={`animated-list-item flex items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 shadow-sm transition-colors hover:border-[var(--accent)] ${
                state === "entering"
                  ? "animated-list-item--entering"
                  : state === "exiting"
                    ? "animated-list-item--exiting"
                    : ""
              }`}
            >
              <div className="flex w-full items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getBlockieSvg(user.address)}
                  alt={`${user.username}'s avatar`}
                  className="h-10 w-10 flex-shrink-0 rounded-full border border-[var(--border)]"
                />
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/profile/${user.address}`}
                    className="block truncate font-semibold text-[var(--foreground)] hover:text-[var(--accent)]"
                  >
                    @{user.username}
                  </Link>
                  <span className="block truncate font-mono text-xs text-[var(--text-muted)]">
                    {formatAddress(user.address)}
                  </span>
                </div>

                {!isMe && currentUser && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleFollow(user);
                    }}
                    disabled={isPending}
                    className={`flex h-[36px] w-full flex-shrink-0 items-center justify-center rounded-lg px-4 py-1.5 text-sm font-semibold transition-all sm:w-auto ${
                      isFollowing
                        ? "border border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)] hover:opacity-80"
                        : "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                    } ${isPending ? "cursor-not-allowed opacity-55" : "cursor-pointer"}`}
                    aria-label={
                      isFollowing ? `Unfollow ${user.username}` : `Follow ${user.username}`
                    }
                  >
                    {isPending ? "Updating..." : isFollowing ? "Following" : "Follow"}
                  </button>
                )}
              </div>
            </li>
          );
        }}
      />

      {loading && (
        <div className="flex items-center justify-center gap-2 p-6" aria-live="polite">
          <div className="w-5 h-5 border-2 border-[var(--border)] border-t-[var(--accent)] rounded-full animate-spin" />
          <p className="text-sm text-[var(--text-muted)]">Loading users...</p>
        </div>
      )}

      {showPagination && (
        <nav
          className="mt-6 flex items-center justify-between gap-3"
          aria-label={`${type === "followers" ? "Followers" : "Following"} pagination`}
        >
          <button
            type="button"
            onClick={goToPreviousPage}
            disabled={loading || page === 0}
            className="min-w-[88px] rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Prev
          </button>
          <span className="text-sm font-semibold text-[var(--foreground)]" aria-live="polite">
            Page {page + 1}
          </span>
          <button
            type="button"
            onClick={goToNextPage}
            disabled={loading || !hasMore}
            className="min-w-[88px] rounded-lg border border-[var(--border)] bg-[var(--background)] px-4 py-2 text-sm font-semibold text-[var(--foreground)] hover:bg-[var(--muted)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
