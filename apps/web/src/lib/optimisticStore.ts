"use client";

import { useSyncExternalStore } from "react";

/* ────────────────────────────────────────────────────────────────────────── */
/*  Types                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

export type FollowState = {
  isFollowing: boolean;
  followersCount: number;
  followingCount: number;
};

export type LikeState = {
  isLiked: boolean;
  likeCount: number;
};

export type TipState = {
  tipTotal: number;
};

/* ────────────────────────────────────────────────────────────────────────── */
/*  Store internals                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

// Key format: `${followerAddress}:${followeeAddress}`
const followStateMap = new Map<string, FollowState>();
// Key format: `${userAddress}:${postId}`
const likeStateMap = new Map<string, LikeState>();
// Key format: postId string
const tipStateMap = new Map<string, TipState>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Public API                                                               */
/* ────────────────────────────────────────────────────────────────────────── */

const pendingMap = new Map<string, boolean>();
const legacyFollowingMap = new Map<string, boolean>();

export const OptimisticStore = {
  setFollowState(key: string, state: FollowState) {
    followStateMap.set(key, state);
    notify();
  },

  getFollowState(key: string): FollowState | undefined {
    return followStateMap.get(key);
  },

  clearFollowState(key: string) {
    followStateMap.delete(key);
    notify();
  },

  setLikeState(key: string, state: LikeState) {
    likeStateMap.set(key, state);
    notify();
  },

  getLikeState(key: string): LikeState | undefined {
    return likeStateMap.get(key);
  },

  setTipState(key: string, state: TipState) {
    tipStateMap.set(key, state);
    notify();
  },

  getTipState(key: string): TipState | undefined {
    return tipStateMap.get(key);
  },

  // Legacy API for FollowList.tsx
  subscribe,
  isFollowing(targetAddress: string): boolean {
    return legacyFollowingMap.get(targetAddress) ?? false;
  },
  setFollowing(targetAddress: string, isFollowing: boolean) {
    legacyFollowingMap.set(targetAddress, isFollowing);
    notify();
  },
  isPending(targetAddress: string): boolean {
    return pendingMap.get(targetAddress) ?? false;
  },
  setPending(targetAddress: string, pending: boolean | { isPending: boolean }) {
    pendingMap.set(targetAddress, typeof pending === "boolean" ? pending : pending.isPending);
    notify();
  },
};

/* ────────────────────────────────────────────────────────────────────────── */
/*  Hooks                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Returns the optimistic follow state if one exists, otherwise falls back
 * to `initialState` (the "truth" from the server/contract).
 */
export function useOptimisticFollow(
  follower: string | null,
  followee: string,
  initialState: FollowState
): FollowState {
  const key = `${follower}:${followee}`;

  const optimistic = useSyncExternalStore(
    subscribe,
    () => (follower ? OptimisticStore.getFollowState(key) : undefined),
    () => undefined
  );

  return optimistic ?? initialState;
}

/**
 * Returns the optimistic like state if one exists, otherwise falls back
 * to `initialState`.
 */
export function useOptimisticLike(
  user: string | null,
  postId: string | bigint,
  initialState: LikeState
): LikeState {
  const key = `${user}:${postId}`;

  const optimistic = useSyncExternalStore(
    subscribe,
    () => (user ? OptimisticStore.getLikeState(key) : undefined),
    () => undefined
  );

  return optimistic ?? initialState;
}

/**
 * Returns the optimistic tip state if one exists, otherwise falls back
 * to `initialState`.
 */
export function useOptimisticTip(
  postId: string | bigint,
  initialState: TipState
): TipState {
  const key = String(postId);

  const optimistic = useSyncExternalStore(
    subscribe,
    () => OptimisticStore.getTipState(key),
    () => undefined
  );

  return optimistic ?? initialState;
}
