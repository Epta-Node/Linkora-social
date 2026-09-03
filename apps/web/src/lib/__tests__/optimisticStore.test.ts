/**
 * optimisticStore.test.ts
 *
 * Unit tests for the optimistic feed store's snapshot / rollback behaviour.
 *
 * The store applies optimistic like/follow/tip mutations immediately so the UI
 * feels instant, but if the underlying transaction reports `failed` the
 * optimistic state must be reverted to the pre-mutation snapshot. These tests
 * cover:
 *   1. Success path — committed optimistic state is kept.
 *   2. Failure path — a failed write restores the pre-mutation snapshot and
 *      emits a `rolled-back` event so pending styling can be cleared.
 *   3. Partial rollback ordering — rolling back one post/user does not touch
 *      unrelated snapshots, and sequenced rollbacks restore their own state.
 */

import { OptimisticStore, type RolledBackEvent } from "@/lib/optimisticStore";

function clearStore() {
  // No public reset API — rebuild by clearing every key used across the test
  // suites. The store is module-level, so each test must start from a clean
  // slate regardless of which describe block ran before it.
  for (const key of ["GA:1", "GA:2", "u:1", "u:2", "u:3"]) {
    OptimisticStore.clearLikeState(key);
  }
  OptimisticStore.clearFollowState("alice:bob");
  OptimisticStore.clearFollowState("alice:carol");
  OptimisticStore.clearTipState("p1");
  OptimisticStore.clearTipState("p2");
}

beforeEach(() => {
  clearStore();
});

describe("like rollback", () => {
  const key = "GA:1";

  it("keeps the committed optimistic like on success", () => {
    OptimisticStore.setLikeState(key, { isLiked: false, likeCount: 10 });

    // Begin an optimistic write: snapshot the pre-mutation state.
    const previous = OptimisticStore.getLikeState(key);
    expect(previous).toEqual({ isLiked: false, likeCount: 10 });

    OptimisticStore.snapshotLikeState(key);
    OptimisticStore.setLikeState(key, { isLiked: true, likeCount: 11 });

    // Success path: no rollback is triggered, committed state is retained.
    expect(OptimisticStore.getLikeState(key)).toEqual({ isLiked: true, likeCount: 11 });
  });

  it("restores the pre-mutation snapshot and emits a rolled-back event on failure", () => {
    const rolledBack: RolledBackEvent[] = [];
    const unsubscribe = OptimisticStore.onRolledBack((e) => rolledBack.push(e));

    OptimisticStore.setLikeState(key, { isLiked: false, likeCount: 10 });
    OptimisticStore.snapshotLikeState(key);
    OptimisticStore.setLikeState(key, { isLiked: true, likeCount: 11 });

    // Simulate the transaction reporting `failed`.
    const didRollback = OptimisticStore.rollbackLikeState(key);

    expect(didRollback).toBe(true);
    expect(OptimisticStore.getLikeState(key)).toEqual({ isLiked: false, likeCount: 10 });
    expect(rolledBack).toEqual([{ kind: "like", key }]);

    // Snapshot is consumed, so a second rollback is a no-op.
    expect(OptimisticStore.rollbackLikeState(key)).toBe(false);

    unsubscribe();
  });

  it("removes the optimistic entry when there was no prior snapshot state", () => {
    const rolledBack: RolledBackEvent[] = [];
    const unsubscribe = OptimisticStore.onRolledBack((e) => rolledBack.push(e));

    // No optimistic state exists yet for this key; the transaction fails.
    OptimisticStore.snapshotLikeState(key);
    OptimisticStore.setLikeState(key, { isLiked: true, likeCount: 1 });

    OptimisticStore.rollbackLikeState(key);

    // Undefined prior state means the optimistic entry is dropped so the hook
    // falls back to server truth.
    expect(OptimisticStore.getLikeState(key)).toBeUndefined();
    expect(rolledBack).toEqual([{ kind: "like", key }]);

    unsubscribe();
  });
});

describe("follow rollback", () => {
  it("restores the pre-mutation follow snapshot and emits a rolled-back event", () => {
    const key = "alice:bob";
    const rolledBack: RolledBackEvent[] = [];
    const unsubscribe = OptimisticStore.onRolledBack((e) => rolledBack.push(e));

    OptimisticStore.setFollowState(key, {
      isFollowing: false,
      followersCount: 3,
      followingCount: 5,
    });
    OptimisticStore.snapshotFollowState(key);
    OptimisticStore.setFollowState(key, {
      isFollowing: true,
      followersCount: 4,
      followingCount: 5,
    });

    OptimisticStore.rollbackFollowState(key);

    expect(OptimisticStore.getFollowState(key)).toEqual({
      isFollowing: false,
      followersCount: 3,
      followingCount: 5,
    });
    expect(rolledBack).toEqual([{ kind: "follow", key }]);

    unsubscribe();
  });

  it("keeps the committed follow on success", () => {
    const key = "alice:carol";
    OptimisticStore.setFollowState(key, {
      isFollowing: false,
      followersCount: 1,
      followingCount: 0,
    });
    OptimisticStore.snapshotFollowState(key);
    OptimisticStore.setFollowState(key, {
      isFollowing: true,
      followersCount: 2,
      followingCount: 0,
    });

    // Success: no rollback.
    expect(OptimisticStore.getFollowState(key)).toEqual({
      isFollowing: true,
      followersCount: 2,
      followingCount: 0,
    });
  });
});

describe("tip rollback", () => {
  it("restores the pre-mutation tip total and emits a rolled-back event", () => {
    const key = "p1";
    const rolledBack: RolledBackEvent[] = [];
    const unsubscribe = OptimisticStore.onRolledBack((e) => rolledBack.push(e));

    OptimisticStore.setTipState(key, { tipTotal: 100 });
    OptimisticStore.snapshotTipState(key);
    OptimisticStore.setTipState(key, { tipTotal: 150 });

    OptimisticStore.rollbackTipState(key);

    expect(OptimisticStore.getTipState(key)).toEqual({ tipTotal: 100 });
    expect(rolledBack).toEqual([{ kind: "tip", key }]);

    unsubscribe();
  });
});

describe("partial rollback ordering", () => {
  it("rolls back the exact post/user without disturbing unrelated snapshots", () => {
    const keyA = "u:1";
    const keyB = "u:2";
    const events: RolledBackEvent[] = [];
    const unsubscribe = OptimisticStore.onRolledBack((e) => events.push(e));

    // Two posts with independent optimistic writes.
    OptimisticStore.setLikeState(keyA, { isLiked: false, likeCount: 1 });
    OptimisticStore.setLikeState(keyB, { isLiked: false, likeCount: 2 });

    OptimisticStore.snapshotLikeState(keyA);
    OptimisticStore.snapshotLikeState(keyB);

    OptimisticStore.setLikeState(keyA, { isLiked: true, likeCount: 2 });
    OptimisticStore.setLikeState(keyB, { isLiked: true, likeCount: 3 });

    // Post A fails — only A is rolled back; B keeps its optimistic state.
    OptimisticStore.rollbackLikeState(keyA);

    expect(OptimisticStore.getLikeState(keyA)).toEqual({ isLiked: false, likeCount: 1 });
    expect(OptimisticStore.getLikeState(keyB)).toEqual({ isLiked: true, likeCount: 3 });
    expect(events).toEqual([{ kind: "like", key: keyA }]);

    // Post B also fails later — independently rolled back to its own snapshot.
    OptimisticStore.rollbackLikeState(keyB);
    expect(OptimisticStore.getLikeState(keyB)).toEqual({ isLiked: false, likeCount: 2 });
    expect(events).toEqual([
      { kind: "like", key: keyA },
      { kind: "like", key: keyB },
    ]);

    unsubscribe();
  });
});

describe("rollback snapshots are deep clones", () => {
  it("does not share references so mutating live state cannot corrupt memory of the snapshot", () => {
    const key = "GA:2";
    const previous: { isLiked: boolean; likeCount: number } = { isLiked: false, likeCount: 5 };

    OptimisticStore.setLikeState(key, previous);
    OptimisticStore.snapshotLikeState(key);

    // Mutate the original object after snapshotting — the snapshot must not be
    // affected because it is a deep clone.
    previous.likeCount = 999;

    OptimisticStore.setLikeState(key, { isLiked: true, likeCount: 6 });
    OptimisticStore.rollbackLikeState(key);

    expect(OptimisticStore.getLikeState(key)).toEqual({ isLiked: false, likeCount: 5 });
  });
});

describe("onRolledBack", () => {
  it("stops delivering events after unsubscribing", () => {
    const key = "u:3";
    const events: RolledBackEvent[] = [];
    const unsubscribe = OptimisticStore.onRolledBack((e) => events.push(e));

    OptimisticStore.setLikeState(key, { isLiked: false, likeCount: 0 });
    OptimisticStore.snapshotLikeState(key);
    OptimisticStore.setLikeState(key, { isLiked: true, likeCount: 1 });
    OptimisticStore.rollbackLikeState(key);
    expect(events).toHaveLength(1);

    unsubscribe();

    OptimisticStore.setLikeState(key, { isLiked: false, likeCount: 0 });
    OptimisticStore.snapshotLikeState(key);
    OptimisticStore.setLikeState(key, { isLiked: true, likeCount: 1 });
    OptimisticStore.rollbackLikeState(key);
    expect(events).toHaveLength(1);
  });
});
