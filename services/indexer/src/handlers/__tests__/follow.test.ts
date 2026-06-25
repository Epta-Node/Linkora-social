/**
 * Unit tests for the follow/unfollow event handlers.
 *
 * Issue #351 — acceptance criteria:
 *  - Happy path tested (Follow and Unfollow)
 *  - Idempotency tested
 *  - Database calls mocked with jest.mock
 */

import { handleFollow, handleUnfollow, FollowEvent, UnfollowEvent } from "../follow";
import { Database } from "../../db";

jest.mock("../../db");

function makeMockDb(): jest.Mocked<Database> {
  return {
    upsertProfile: jest.fn(),
    insertFollow: jest.fn().mockResolvedValue(undefined),
    deleteFollow: jest.fn().mockResolvedValue(undefined),
    insertPost: jest.fn(),
    markPostDeleted: jest.fn(),
    incrementPostLikeCount: jest.fn(),
    addPostTipTotal: jest.fn(),
    getPost: jest.fn(),
    upsertLike: jest.fn(),
    insertTip: jest.fn(),
    upsertPool: jest.fn(),
    adjustPoolBalance: jest.fn(),
    insertPool: jest.fn(),
    getPool: jest.fn(),
    addPoolAdmin: jest.fn(),
    removePoolAdmin: jest.fn(),
    getProfile: jest.fn(),
    listPosts: jest.fn(),
    getFollowers: jest.fn(),
    getFollowing: jest.fn(),
  } as jest.Mocked<Database>;
}

// ── handleFollow ──────────────────────────────────────────────────────────────

describe("handleFollow", () => {
  let db: jest.Mocked<Database>;

  beforeEach(() => {
    db = makeMockDb();
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it("calls db.insertFollow with correct fields", async () => {
    const event: FollowEvent = {
      follower: "GABC123",
      followee: "GXYZ789",
      ledger: 100,
    };

    await handleFollow(db, event);

    expect(db.insertFollow).toHaveBeenCalledTimes(1);
    expect(db.insertFollow).toHaveBeenCalledWith({
      follower: "GABC123",
      followee: "GXYZ789",
      ledger: 100,
    });
  });

  it("resolves without error for a valid event", async () => {
    const event: FollowEvent = {
      follower: "GABC123",
      followee: "GXYZ789",
      ledger: 200,
    };

    await expect(handleFollow(db, event)).resolves.toBeUndefined();
  });

  // ── Idempotency ─────────────────────────────────────────────────────────────

  it("is idempotent — replaying the same follow event calls insertFollow again", async () => {
    const event: FollowEvent = {
      follower: "GABC123",
      followee: "GXYZ789",
      ledger: 100,
    };

    await handleFollow(db, event);
    await handleFollow(db, event);

    // Handler delegates idempotency to the db layer (upsert on composite key).
    expect(db.insertFollow).toHaveBeenCalledTimes(2);
  });

  // ── Validation ──────────────────────────────────────────────────────────────

  it("throws when follower field is missing", async () => {
    const event = {
      follower: "",
      followee: "GXYZ789",
      ledger: 100,
    } as FollowEvent;

    await expect(handleFollow(db, event)).rejects.toThrow(
      "Follow event missing required field: follower"
    );
    expect(db.insertFollow).not.toHaveBeenCalled();
  });

  it("throws when followee field is missing", async () => {
    const event = {
      follower: "GABC123",
      followee: "",
      ledger: 100,
    } as FollowEvent;

    await expect(handleFollow(db, event)).rejects.toThrow(
      "Follow event missing required field: followee"
    );
    expect(db.insertFollow).not.toHaveBeenCalled();
  });

  // ── Database error propagation ──────────────────────────────────────────────

  it("propagates database errors", async () => {
    db.insertFollow.mockRejectedValueOnce(new Error("DB write failed"));

    const event: FollowEvent = {
      follower: "GABC123",
      followee: "GXYZ789",
      ledger: 100,
    };

    await expect(handleFollow(db, event)).rejects.toThrow("DB write failed");
  });

  it("dispatches a follow notification when a notification service is provided", async () => {
    const notificationService = {
      dispatchEventNotification: jest.fn().mockResolvedValue(true),
    };
    const event: FollowEvent = {
      follower: "GABC123",
      followee: "GXYZ789",
      ledger: 100,
    };

    await handleFollow(db, event, { notificationService: notificationService as never });

    expect(notificationService.dispatchEventNotification).toHaveBeenCalledWith({
      type: "FOLLOW",
      recipient: "GXYZ789",
      payload: {
        followerAddress: "GABC123",
        deepLink: "linkora://profile/GABC123",
      },
    });
  });
});

// ── handleUnfollow ────────────────────────────────────────────────────────────

describe("handleUnfollow", () => {
  let db: jest.Mocked<Database>;

  beforeEach(() => {
    db = makeMockDb();
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it("calls db.deleteFollow with correct follower and followee", async () => {
    const event: UnfollowEvent = {
      follower: "GABC123",
      followee: "GXYZ789",
      ledger: 150,
    };

    await handleUnfollow(db, event);

    expect(db.deleteFollow).toHaveBeenCalledTimes(1);
    expect(db.deleteFollow).toHaveBeenCalledWith("GABC123", "GXYZ789");
  });

  it("resolves without error for a valid event", async () => {
    const event: UnfollowEvent = {
      follower: "GABC123",
      followee: "GXYZ789",
      ledger: 150,
    };

    await expect(handleUnfollow(db, event)).resolves.toBeUndefined();
  });

  // ── Idempotency ─────────────────────────────────────────────────────────────

  it("is idempotent — replaying the same unfollow event calls deleteFollow again", async () => {
    const event: UnfollowEvent = {
      follower: "GABC123",
      followee: "GXYZ789",
      ledger: 150,
    };

    await handleUnfollow(db, event);
    await handleUnfollow(db, event);

    // Deleting a non-existent edge is a no-op at the db layer.
    expect(db.deleteFollow).toHaveBeenCalledTimes(2);
  });

  // ── Validation ──────────────────────────────────────────────────────────────

  it("throws when follower field is missing", async () => {
    const event = {
      follower: "",
      followee: "GXYZ789",
      ledger: 150,
    } as UnfollowEvent;

    await expect(handleUnfollow(db, event)).rejects.toThrow(
      "Unfollow event missing required field: follower"
    );
    expect(db.deleteFollow).not.toHaveBeenCalled();
  });

  it("throws when followee field is missing", async () => {
    const event = {
      follower: "GABC123",
      followee: "",
      ledger: 150,
    } as UnfollowEvent;

    await expect(handleUnfollow(db, event)).rejects.toThrow(
      "Unfollow event missing required field: followee"
    );
    expect(db.deleteFollow).not.toHaveBeenCalled();
  });

  // ── Database error propagation ──────────────────────────────────────────────

  it("propagates database errors", async () => {
    db.deleteFollow.mockRejectedValueOnce(new Error("DB delete failed"));

    const event: UnfollowEvent = {
      follower: "GABC123",
      followee: "GXYZ789",
      ledger: 150,
    };

    await expect(handleUnfollow(db, event)).rejects.toThrow("DB delete failed");
  });
});
