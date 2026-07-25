"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useProfile, type IndexerPost } from "@/hooks/useProfile";
import { useWallet } from "@/hooks/useWallet";
import { OptimisticStore, useOptimisticFollow } from "@/lib/optimisticStore";
import {
  useLinkoraEvent,
  useWatchAddress,
  type FollowEventData,
  type TipEventData,
} from "@/lib/LinkoraEventSubscriber";
import { FollowDrawer } from "@/components/profile/FollowDrawer";
import { CreatorTokenPanel } from "@/components/profile/CreatorTokenPanel";
import {
  TransactionBuilder,
  BASE_FEE,
  Contract,
  Address,
  rpc as StellarRpc,
} from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/freighter-api";
import { LinkoraClient } from "linkora-sdk";

const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID || "CDUMMY";
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://soroban-testnet.stellar.org";
const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE || "Test SDF Network ; September 2015";

/* ────────────────────────────────────────────────────────────────────────── */
/*  Helpers                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/** Deterministic blockie URL (Effigy service, returns Ethereum-style identicons). */
const blockieUrl = (address: string) => `https://effigy.im/a/${address}.svg`;

/** Truncate an address to first 5 and last 4 characters. */
const truncate = (addr: string) =>
  addr.length > 10 ? `${addr.slice(0, 5)}…${addr.slice(-4)}` : addr;

/** Relative time label from a ledger number (≈5 s / ledger). */
const ledgerToRelative = (ledger: number): string => {
  // We can't know the *exact* wall-clock time without the network, so we
  // just show the ledger number for now.
  return `Ledger #${ledger}`;
};

/* ────────────────────────────────────────────────────────────────────────── */
/*  Page component                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

export default function ProfilePage() {
  const params = useParams();
  const address = params?.address as string;
  const { address: currentUserAddress } = useWallet();
  const { state, refetch, fetchMorePosts } = useProfile(address, currentUserAddress);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerType, setDrawerType] = useState<"followers" | "following">("followers");
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  /* ── Optimistic follow state ────────────────────────────────────────── */

  const followState = useOptimisticFollow(currentUserAddress, address, {
    isFollowing: state.status === "success" ? state.data.isFollowing : false,
    followersCount: state.status === "success" ? state.data.followersCount : 0,
    followingCount: state.status === "success" ? state.data.followingCount : 0,
  });

  /* ── Live event subscriptions ───────────────────────────────────────── */

  useWatchAddress(address);

  useLinkoraEvent<FollowEventData>("FollowEvent", (event) => {
    if (event.followee === address) {
      refetch();
    }
  });

  useLinkoraEvent<FollowEventData>("UnfollowEvent", (event) => {
    if (event.followee === address) {
      refetch();
    }
  });

  useLinkoraEvent<TipEventData>("TipEvent", () => {
    refetch();
  });

  /* ── Follow / unfollow ──────────────────────────────────────────────── */

  const handleFollowToggle = useCallback(async () => {
    if (!currentUserAddress || followLoading) return;

    const key = `${currentUserAddress}:${address}`;
    const newIsFollowing = !followState.isFollowing;

    // Optimistic UI update
    OptimisticStore.setFollowState(key, {
      isFollowing: newIsFollowing,
      followersCount: followState.followersCount + (newIsFollowing ? 1 : -1),
      followingCount: followState.followingCount,
    });

    setFollowLoading(true);

    try {
      const server = new StellarRpc.Server(RPC_URL);
      const account = await server.getAccount(currentUserAddress);

      const contract = new Contract(CONTRACT_ID);
      const op = contract.call(
        newIsFollowing ? "follow" : "unfollow",
        Address.fromString(currentUserAddress).toScVal(),
        Address.fromString(address).toScVal()
      );

      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(op)
        .setTimeout(30)
        .build();

      const simulated = await server.simulateTransaction(tx);
      if (StellarRpc.Api.isSimulationError(simulated)) {
        throw new Error(`Simulation failed: ${simulated.error}`);
      }

      const finalTx = StellarRpc.assembleTransaction(tx, simulated).build();
      const xdrString = finalTx.toXDR();

      const signedXdr = await signTransaction(xdrString, {
        networkPassphrase: NETWORK_PASSPHRASE,
      });

      const signedTx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
      const sendResponse = await server.sendTransaction(signedTx);

      if (sendResponse.status === "ERROR") {
        throw new Error("Transaction failed to submit");
      }

      let status: string = sendResponse.status;
      const startTime = Date.now();
      while (status === "PENDING" && Date.now() - startTime < 30000) {
        await new Promise((r) => setTimeout(r, 1000));
        const txResponse = await server.getTransaction(sendResponse.hash);
        status = txResponse.status as string;
      }
    } catch (error) {
      console.error("Follow/unfollow failed:", error);
      // Rollback optimistic update
      OptimisticStore.setFollowState(key, {
        isFollowing: !newIsFollowing,
        followersCount: followState.followersCount,
        followingCount: followState.followingCount,
      });
    } finally {
      setFollowLoading(false);
    }
  }, [currentUserAddress, address, followState, followLoading]);

  /* ── Check if blocked ──────────────────────────────────────────────── */

  useEffect(() => {
    if (!currentUserAddress || currentUserAddress === address) {
      setIsBlocked(false);
      return;
    }
    const client = new LinkoraClient({
      contractId: process.env.NEXT_PUBLIC_CONTRACT_ID || "CDUMMY",
      rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || "https://soroban-testnet.stellar.org",
    });
    client
      .isBlocked(currentUserAddress, address)
      .then(setIsBlocked)
      .catch(() => setIsBlocked(false));
  }, [currentUserAddress, address]);

  /* ── Block / Unblock ──────────────────────────────────────────────── */

  const handleBlockToggle = useCallback(async () => {
    if (!currentUserAddress) return;
    setBlocking(true);
    try {
      const client = new LinkoraClient({
        contractId: process.env.NEXT_PUBLIC_CONTRACT_ID || "CDUMMY",
        rpcUrl: process.env.NEXT_PUBLIC_RPC_URL || "https://soroban-testnet.stellar.org",
      });
      const _txXdr = isBlocked
        ? client.unblockUser(currentUserAddress, address)
        : client.blockUser(currentUserAddress, address);
      setIsBlocked((prev) => !prev);
      setMenuOpen(false);
    } catch (error) {
      console.error("Block/unblock failed:", error);
    } finally {
      setBlocking(false);
    }
  }, [currentUserAddress, address, isBlocked]);

  /* ── Close overflow menu on outside click ─────────────────────────── */

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  /* ── Copy address ───────────────────────────────────────────────────── */

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(address);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 1500);
  }, [address]);

  /* ── Drawer helpers ─────────────────────────────────────────────────── */

  const openDrawer = useCallback((type: "followers" | "following") => {
    setDrawerType(type);
    setDrawerOpen(true);
  }, []);

  /* ── Infinite scroll sentinel ───────────────────────────────────────── */

  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status !== "success" || !state.data.postsHasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          fetchMorePosts();
        }
      },
      { rootMargin: "200px" }
    );

    const el = sentinelRef.current;
    if (el) observer.observe(el);
    return () => {
      if (el) observer.unobserve(el);
    };
  }, [state, fetchMorePosts]);

  /* ────────────────────────────────────────────────────────────────────── */
  /*  Renders                                                               */
  /* ────────────────────────────────────────────────────────────────────── */

  if (state.status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg-primary)]">
        <div className="animate-pulse flex space-x-4 w-80">
          <div className="rounded-full bg-[var(--bg-tertiary)] h-14 w-14 shrink-0" />
          <div className="flex-1 space-y-3 py-1">
            <div className="h-4 bg-[var(--bg-tertiary)] rounded w-3/4" />
            <div className="h-4 bg-[var(--bg-tertiary)] rounded w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div
        className="flex h-screen items-center justify-center bg-[var(--bg-primary)] text-[var(--error)]"
        role="alert"
      >
        Failed to load profile: {state.error.message}
      </div>
    );
  }

  if (state.status === "not-found") {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg-primary)] text-[var(--text-muted)]">
        Profile not found
      </div>
    );
  }

  const { profile, posts, postsHasMore, creatorTokenBalance, totalTipsReceived } = state.data;
  const isSelf = currentUserAddress === address;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        {/* ── Profile header ───────────────────────────────────────────── */}
        <section
          id="profile-header"
          aria-label="Profile header"
          className="flex flex-col md:flex-row items-start md:items-center gap-4 md:gap-6 bg-[var(--bg-secondary)] p-4 md:p-6 rounded-2xl border border-[var(--bg-tertiary)]"
        >
          {/* Avatar */}
          <img
            src={blockieUrl(address)}
            alt={`${profile.username}'s avatar`}
            className="w-24 h-24 rounded-full border-4 border-[var(--bg-primary)]"
            id="profile-avatar"
          />

          {/* Name / address / bio */}
          <div className="flex-1 min-w-0">
            <h1 id="profile-username" className="text-3xl font-bold truncate">
              {profile.username}
            </h1>

            <p className="text-[var(--text-muted)] font-mono text-sm mt-1 flex items-center gap-2">
              <span id="profile-address">{truncate(address)}</span>
              <button
                onClick={handleCopy}
                aria-label="Copy address to clipboard"
                className="hover:text-[var(--accent-teal)] transition-colors"
                id="copy-address-btn"
              >
                {copyFeedback ? "✓ Copied" : "📋 Copy"}
              </button>
            </p>

            {/* Follower / following counts */}
            <div className="flex gap-6 mt-4">
              <Link
                href={`/profile/${address}/followers`}
                className="hover:text-[var(--accent-teal)] transition-colors"
                aria-label={`View ${followState.followersCount} followers`}
                id="followers-btn"
              >
                <span className="font-bold" id="followers-count">
                  {followState.followersCount}
                </span>{" "}
                <span className="text-[var(--text-muted)]">Followers</span>
              </Link>

              <Link
                href={`/profile/${address}/following`}
                className="hover:text-[var(--accent-teal)] transition-colors"
                aria-label={`View ${followState.followingCount} following`}
                id="following-btn"
              >
                <span className="font-bold" id="following-count">
                  {followState.followingCount}
                </span>{" "}
                <span className="text-[var(--text-muted)]">Following</span>
              </Link>
            </div>
          </div>

          {/* Follow / Unfollow + Overflow menu */}
          <div
            className="mt-4 md:mt-0 w-full md:w-auto shrink-0 flex flex-wrap items-center gap-2"
            aria-live="polite"
          >
            {!isSelf && currentUserAddress && (
              <>
                <button
                  onClick={handleFollowToggle}
                  id="follow-btn"
                  className={`w-full sm:w-auto px-6 py-2 rounded-full font-bold transition-all ${
                    followState.isFollowing
                      ? "bg-transparent border border-[var(--text-muted)] text-[var(--text-primary)] hover:bg-[var(--error)] hover:border-[var(--error)] hover:text-white"
                      : "bg-[var(--accent-coral)] text-white hover:opacity-90"
                  }`}
                  aria-label={
                    followState.isFollowing
                      ? `Unfollow ${profile.username}`
                      : `Follow ${profile.username}`
                  }
                >
                  {followState.isFollowing ? "Following" : "Follow"}
                </button>

                {/* Overflow menu trigger */}
                <div ref={menuRef} className="relative">
                  <button
                    onClick={() => setMenuOpen((prev) => !prev)}
                    className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-[var(--bg-tertiary)] transition-colors text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                    aria-label="More actions"
                    aria-expanded={menuOpen}
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"
                      />
                    </svg>
                  </button>

                  {/* Dropdown menu */}
                  {menuOpen && (
                    <div className="absolute right-0 top-full mt-2 z-50 min-w-[180px] rounded-xl border border-[var(--border)] bg-[var(--muted)] p-1.5 shadow-2xl">
                      <button
                        onClick={handleBlockToggle}
                        disabled={blocking}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50"
                      >
                        {blocking ? (
                          <span className="animate-pulse">Processing...</span>
                        ) : isBlocked ? (
                          <>
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={1.5}
                              stroke="currentColor"
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                              />
                            </svg>
                            Unblock @{profile.username}
                          </>
                        ) : (
                          <>
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={1.5}
                              stroke="currentColor"
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                              />
                            </svg>
                            Block @{profile.username}
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </section>

        {/* ── Content grid ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 mt-6 md:mt-8">
          {/* Posts feed */}
          <section className="md:col-span-2" aria-label="User posts" id="posts-section">
            <div className="border-b border-[var(--bg-tertiary)] mb-4">
              <h2 className="text-xl font-semibold pb-2 border-b-2 border-[var(--accent-coral)] inline-block">
                Posts
              </h2>
            </div>

            {posts.length === 0 ? (
              <div className="bg-[var(--bg-secondary)] p-4 rounded-xl border border-[var(--bg-tertiary)] text-center text-[var(--text-muted)] py-12">
                No posts yet.
              </div>
            ) : (
              <div className="space-y-4">
                {posts.map((post) => (
                  <PostCard key={post.id} post={post} />
                ))}

                {/* Infinite-scroll sentinel */}
                {postsHasMore && (
                  <div
                    ref={sentinelRef}
                    className="text-center text-sm text-[var(--text-muted)] py-4"
                    aria-hidden="true"
                  >
                    Loading more…
                  </div>
                )}
              </div>
            )}
          </section>

          {/* Sidebar */}
          <aside className="space-y-6" aria-label="Profile sidebar">
            <CreatorTokenPanel
              tokenAddress={profile.creator_token || null}
              balance={creatorTokenBalance}
              totalTipsReceived={totalTipsReceived}
            />
          </aside>
        </div>
      </div>

      {/* Follow drawer */}
      <FollowDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        type={drawerType}
        address={address}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Post card sub-component                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

function PostCard({ post }: { post: IndexerPost }) {
  return (
    <article
      className="bg-[var(--bg-secondary)] p-4 rounded-xl border border-[var(--bg-tertiary)]"
      aria-label={`Post ${post.id}`}
    >
      <div className="flex items-center gap-3 mb-3">
        <img src={blockieUrl(post.author)} alt="" className="w-8 h-8 rounded-full" />
        <span className="font-mono text-sm text-[var(--text-muted)]">{truncate(post.author)}</span>
        <span className="text-xs text-[var(--text-muted)] ml-auto">
          {ledgerToRelative(post.created_ledger)}
        </span>
      </div>

      <div className="flex items-center gap-4 text-sm text-[var(--text-muted)] mt-3 pt-3 border-t border-[var(--bg-tertiary)]">
        <span aria-label={`${post.like_count} likes`}>❤️ {post.like_count}</span>
        <span aria-label={`${post.tip_total} tips`}>
          💰 {Number(post.tip_total).toLocaleString()}
        </span>
      </div>
    </article>
  );
}
