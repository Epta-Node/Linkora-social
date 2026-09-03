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
/*  Rollback events                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

export type RolledBackEvent = {
  kind: "follow" | "like" | "tip";
  key: string;
};

export type RolledBackListener = (event: RolledBackEvent) => void;

// Returns a deep clone so snapshots never share references with live state.
// The optimistic state objects are plain JSON-serializable data (numbers and
// booleans), so a structured clone is a safe deep copy and works in every
// environment (Node, jsdom, browsers) without relying on structuredClone.
function deepClone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

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

// Snapshots capture the pre-mutation state so a failed on-chain transaction
// can restore the exact UI the user saw before optimistically applying the
// mutation. They are keyed per state kind + key so rollback is scoped to the
// exact post/user affected.
const followSnapshots = new Map<string, FollowState | undefined>();
const likeSnapshots = new Map<string, LikeState | undefined>();
const tipSnapshots = new Map<string, TipState | undefined>();
const rolledBackListeners = new Set<RolledBackListener>();

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

function emitRolledBack(event: RolledBackEvent) {
  for (const listener of rolledBackListeners) {
    listener(event);
  }
  // Re-render any subscribed components so they observe the restored state.
  notify();
}

function onRolledBack(listener: RolledBackListener) {
  rolledBackListeners.add(listener);
  return () => {
    rolledBackListeners.delete(listener);
  };
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
    followSnapshots.delete(key);
    notify();
  },

  // Capture the pre-mutation follow state so it can be restored on failure.
  snapshotFollowState(key: string) {
    followSnapshots.set(key, deepClone(followStateMap.get(key)));
  },

  // Restore the pre-mutation follow state and clear transient pending styling.
  rollbackFollowState(key: string) {
    if (!followSnapshots.has(key)) {
      followSnapshots.delete(key);
      return false;
    }
    const snapshot = followSnapshots.get(key);
    if (snapshot === undefined) {
      followStateMap.delete(key);
    } else {
      followStateMap.set(key, deepClone(snapshot));
    }
    followSnapshots.delete(key);
    emitRolledBack({ kind: "follow", key });
    return true;
  },

  setLikeState(key: string, state: LikeState) {
    likeStateMap.set(key, state);
    notify();
  },

  getLikeState(key: string): LikeState | undefined {
    return likeStateMap.get(key);
  },

  clearLikeState(key: string) {
    likeStateMap.delete(key);
    likeSnapshots.delete(key);
    notify();
  },

  snapshotLikeState(key: string) {
    likeSnapshots.set(key, deepClone(likeStateMap.get(key)));
  },

  rollbackLikeState(key: string) {
    if (!likeSnapshots.has(key)) {
      likeSnapshots.delete(key);
      return false;
    }
    const snapshot = likeSnapshots.get(key);
    if (snapshot === undefined) {
      likeStateMap.delete(key);
    } else {
      likeStateMap.set(key, deepClone(snapshot));
    }
    likeSnapshots.delete(key);
    emitRolledBack({ kind: "like", key });
    return true;
  },

  setTipState(key: string, state: TipState) {
    tipStateMap.set(key, state);
    notify();
  },

  getTipState(key: string): TipState | undefined {
    return tipStateMap.get(key);
  },

  clearTipState(key: string) {
    tipStateMap.delete(key);
    tipSnapshots.delete(key);
    notify();
  },

  snapshotTipState(key: string) {
    tipSnapshots.set(key, deepClone(tipStateMap.get(key)));
  },

  rollbackTipState(key: string) {
    if (!tipSnapshots.has(key)) {
      tipSnapshots.delete(key);
      return false;
    }
    const snapshot = tipSnapshots.get(key);
    if (snapshot === undefined) {
      tipStateMap.delete(key);
    } else {
      tipStateMap.set(key, deepClone(snapshot));
    }
    tipSnapshots.delete(key);
    emitRolledBack({ kind: "tip", key });
    return true;
  },

  // Subscribe to rollback events so components can clear transient "pending"
  // styling for the affected feed slice. Returns an unsubscribe function.
  onRolledBack,

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
export function useOptimisticTip(postId: string | bigint, initialState: TipState): TipState {
  const key = String(postId);

  const optimistic = useSyncExternalStore(
    subscribe,
    () => OptimisticStore.getTipState(key),
    () => undefined
  );

  return optimistic ?? initialState;
}
