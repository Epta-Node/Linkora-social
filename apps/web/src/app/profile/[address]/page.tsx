"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useProfile, type IndexerPost } from "@/hooks/useProfile";
import { useWallet } from "@/hooks/useWallet";
import { OptimisticStore, useOptimisticFollow } from "@/lib/OptimisticStore";
import {
  useLinkoraEvent,
  useWatchAddress,
  type FollowEventData,
  type TipEventData,
} from "@/lib/LinkoraEventSubscriber";
import { FollowDrawer } from "@/components/profile/FollowDrawer";
import { CreatorTokenPanel } from "@/components/profile/CreatorTokenPanel";
import { LinkoraClient } from "../../../../../../packages/sdk/src/client";

/* ────────────────────────────────────────────────────────────────────────── */
/*  Helpers                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

/** Deterministic blockie URL (Effigy service, returns Ethereum-style identicons). */
const blockieUrl = (address: string) =>
  `https://effigy.im/a/${address}.svg`;

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
  const { state, refetch, fetchMorePosts } = useProfile(
    address,
    currentUserAddress
  );

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerType, setDrawerType] = useState<"followers" | "following">(
    "followers"
  );
  const [copyFeedback, setCopyFeedback] = useState(false);

  /* ── Optimistic follow state ────────────────────────────────────────── */

  const followState = useOptimisticFollow(
    currentUserAddress,
    address,
    {
      isFollowing:
        state.status === "success" ? state.data.isFollowing : false,
      followersCount:
        state.status === "success" ? state.data.followersCount : 0,
      followingCount:
        state.status === "success" ? state.data.followingCount : 0,
    }
  );

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
    if (!currentUserAddress) return;

    const key = `${currentUserAddress}:${address}`;
    const newIsFollowing = !followState.isFollowing;

    // Optimistic UI
    OptimisticStore.setFollowState(key, {
      isFollowing: newIsFollowing,
      followersCount:
        followState.followersCount + (newIsFollowing ? 1 : -1),
      followingCount: followState.followingCount,
    });

    try {
      const client = new LinkoraClient({
        contractId: process.env.NEXT_PUBLIC_CONTRACT_ID || "CDUMMY",
        rpcUrl:
          process.env.NEXT_PUBLIC_RPC_URL ||
          "https://soroban-testnet.stellar.org",
      });

      // These methods return transaction XDR envelopes.
      // In production, this XDR would be signed via Freighter and submitted.
      const _txXdr = newIsFollowing
        ? client.follow(currentUserAddress, address)
        : client.unfollow(currentUserAddress, address);

      // TODO: sign & submit via Freighter — same pattern as mobile's FollowButton.
      // For now we treat the optimistic update as the final state.
    } catch (error) {
      console.error("Follow/unfollow failed:", error);
      // Rollback
      OptimisticStore.setFollowState(key, {
        isFollowing: !newIsFollowing,
        followersCount: followState.followersCount,
        followingCount: followState.followingCount,
      });
    }
  }, [currentUserAddress, address, followState]);

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

  const { profile, posts, postsHasMore, creatorTokenBalance, totalTipsReceived } =
    state.data;
  const isSelf = currentUserAddress === address;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        {/* ── Profile header ───────────────────────────────────────────── */}
        <section
          id="profile-header"
          aria-label="Profile header"
          className="flex flex-col md:flex-row items-start md:items-center gap-6 bg-[var(--bg-secondary)] p-6 rounded-2xl border border-[var(--bg-tertiary)]"
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

            {profile.bio && (
              <p
                id="profile-bio"
                className="mt-3 text-[var(--text-primary)] leading-relaxed"
              >
                {profile.bio}
              </p>
            )}

            {/* Follower / following counts */}
            <div className="flex gap-6 mt-4">
              <button
                onClick={() => openDrawer("followers")}
                className="hover:text-[var(--accent-teal)] transition-colors"
                aria-label={`View ${followState.followersCount} followers`}
                id="followers-btn"
              >
                <span className="font-bold" id="followers-count">
                  {followState.followersCount}
                </span>{" "}
                <span className="text-[var(--text-muted)]">Followers</span>
              </button>

              <button
                onClick={() => openDrawer("following")}
                className="hover:text-[var(--accent-teal)] transition-colors"
                aria-label={`View ${followState.followingCount} following`}
                id="following-btn"
              >
                <span className="font-bold" id="following-count">
                  {followState.followingCount}
                </span>{" "}
                <span className="text-[var(--text-muted)]">Following</span>
              </button>
            </div>
          </div>

          {/* Follow / Unfollow */}
          <div className="mt-4 md:mt-0 shrink-0" aria-live="polite">
            {!isSelf && currentUserAddress && (
              <button
                onClick={handleFollowToggle}
                id="follow-btn"
                className={`px-6 py-2 rounded-full font-bold transition-all ${
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
            )}
          </div>
        </section>

        {/* ── Content grid ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-8">
          {/* Posts feed */}
          <section
            className="md:col-span-2"
            aria-label="User posts"
            id="posts-section"
          >
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
        <img
          src={blockieUrl(post.author)}
          alt=""
          className="w-8 h-8 rounded-full"
        />
        <span className="font-mono text-sm text-[var(--text-muted)]">
          {truncate(post.author)}
        </span>
        <span className="text-xs text-[var(--text-muted)] ml-auto">
          {ledgerToRelative(post.created_ledger)}
        </span>
      </div>

      <div className="flex items-center gap-4 text-sm text-[var(--text-muted)] mt-3 pt-3 border-t border-[var(--bg-tertiary)]">
        <span aria-label={`${post.like_count} likes`}>
          ❤️ {post.like_count}
        </span>
        <span aria-label={`${post.tip_total} tips`}>
          💰 {Number(post.tip_total).toLocaleString()}
        </span>
      </div>
    </article>
  );
}
