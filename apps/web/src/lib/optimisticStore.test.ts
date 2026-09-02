import { OptimisticStore } from "./optimisticStore";

/**
 * Unit tests for OptimisticStore.reconcileFeed — issue #1203.
 *
 * The reconcileFeed method prunes optimistic like/tip state that is stale
 * after a feed refetch (e.g. when the active filter changes).
 */
describe("OptimisticStore.reconcileFeed (#1203)", () => {
  afterEach(() => {
    // Clean up any leftover state between tests.
    // We call reconcileFeed with no posts to clear like entries, and
    // manually clear remaining entries via the public API.
    OptimisticStore.reconcileFeed("__cleanup__", []);
  });

  it("prunes an optimistic like entry when the post is filtered out of the visible set", () => {
    const user = "GUSER1";
    const key = `${user}:42`;

    OptimisticStore.setLikeState(key, { isLiked: true, likeCount: 5 });
    expect(OptimisticStore.getLikeState(key)).toEqual({ isLiked: true, likeCount: 5 });

    // Refetch returns posts that do NOT include post 42
    OptimisticStore.reconcileFeed(user, [{ id: 10 }, { id: 20 }]);

    expect(OptimisticStore.getLikeState(key)).toBeUndefined();
  });

  it("drops the optimistic like entry for a server-confirmed post (server wins via initialState fallback)", () => {
    const user = "GUSER2";
    const key = `${user}:7`;

    OptimisticStore.setLikeState(key, { isLiked: true, likeCount: 10 });
    expect(OptimisticStore.getLikeState(key)).toBeDefined();

    // Refetch returns post 7 with server-confirmed data —
    // the optimistic entry is deleted so the component falls back to
    // initialState which reflects the server truth.
    OptimisticStore.reconcileFeed(user, [{ id: 7 }, { id: 8 }]);

    expect(OptimisticStore.getLikeState(key)).toBeUndefined();
  });

  it("prunes optimistic tip state for a post absent from the visible set", () => {
    OptimisticStore.setTipState("99", { tipTotal: 500 });
    expect(OptimisticStore.getTipState("99")).toEqual({ tipTotal: 500 });

    OptimisticStore.reconcileFeed("GUSER3", [{ id: 1 }]);

    expect(OptimisticStore.getTipState("99")).toBeUndefined();
  });

  it("prunes optimistic tip state for a post present in the visible set (server wins)", () => {
    OptimisticStore.setTipState("5", { tipTotal: 100 });
    expect(OptimisticStore.getTipState("5")).toBeDefined();

    OptimisticStore.reconcileFeed("GUSER4", [{ id: 5 }]);

    expect(OptimisticStore.getTipState("5")).toBeUndefined();
  });

  it("does NOT prune optimistic like entries belonging to a different user", () => {
    const otherUser = "GOTHER";
    const currentUser = "GCURRENT";
    const otherKey = `${otherUser}:42`;

    OptimisticStore.setLikeState(otherKey, { isLiked: true, likeCount: 3 });

    // Reconcile as currentUser — otherUser's entry should survive
    OptimisticStore.reconcileFeed(currentUser, [{ id: 42 }]);

    expect(OptimisticStore.getLikeState(otherKey)).toEqual({ isLiked: true, likeCount: 3 });

    // Cleanup
    OptimisticStore.reconcileFeed(otherUser, []);
  });

  it("notifies subscribers when entries are pruned", () => {
    const listener = jest.fn();
    const unsubscribe = OptimisticStore.subscribe(listener);

    const user = "GNOTIFY";
    OptimisticStore.setLikeState(`${user}:1`, { isLiked: true, likeCount: 1 });

    // Reset the call count after the setLikeState notification
    listener.mockClear();

    OptimisticStore.reconcileFeed(user, []);

    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
