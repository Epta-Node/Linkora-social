/**
 * Unit tests for the profile event handler.
 *
 * Issue #351 — acceptance criteria:
 *  - Happy path tested
 *  - Idempotency tested
 *  - Database calls mocked with jest.mock
 */

import { handleProfileSet, ProfileSetEvent } from "../profile";
import { Database } from "../../db";

// Mock the entire db module so no real database is needed.
jest.mock("../../db");

function makeMockDb(): jest.Mocked<Database> {
  return {
    upsertProfile: jest.fn().mockResolvedValue(undefined),
    insertFollow: jest.fn(),
    deleteFollow: jest.fn(),
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

describe("handleProfileSet", () => {
  let db: jest.Mocked<Database>;

  beforeEach(() => {
    db = makeMockDb();
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it("calls db.upsertProfile with the correct fields", async () => {
    const event: ProfileSetEvent = {
      user: "GABC123",
      username: "alice",
      creator_token: "GTOKEN456",
      ledger: 1000,
    };

    await handleProfileSet(db, event);

    expect(db.upsertProfile).toHaveBeenCalledTimes(1);
    expect(db.upsertProfile).toHaveBeenCalledWith({
      address: "GABC123",
      username: "alice",
      creator_token: "GTOKEN456",
      updated_ledger: 1000,
    });
  });

  it("resolves without error for a valid event", async () => {
    const event: ProfileSetEvent = {
      user: "GABC123",
      username: "bob",
      creator_token: "GTOKEN789",
      ledger: 2000,
    };

    await expect(handleProfileSet(db, event)).resolves.toBeUndefined();
  });

  // ── Idempotency ─────────────────────────────────────────────────────────────

  it("is idempotent — calling twice with the same event calls upsertProfile twice", async () => {
    const event: ProfileSetEvent = {
      user: "GABC123",
      username: "alice",
      creator_token: "GTOKEN456",
      ledger: 1000,
    };

    await handleProfileSet(db, event);
    await handleProfileSet(db, event);

    // Both calls must reach the database; the db layer handles upsert semantics.
    expect(db.upsertProfile).toHaveBeenCalledTimes(2);
    expect(db.upsertProfile).toHaveBeenNthCalledWith(1, {
      address: "GABC123",
      username: "alice",
      creator_token: "GTOKEN456",
      updated_ledger: 1000,
    });
    expect(db.upsertProfile).toHaveBeenNthCalledWith(2, {
      address: "GABC123",
      username: "alice",
      creator_token: "GTOKEN456",
      updated_ledger: 1000,
    });
  });

  it("upserts with updated username when the same user changes their name", async () => {
    const first: ProfileSetEvent = {
      user: "GABC123",
      username: "alice",
      creator_token: "GTOKEN456",
      ledger: 1000,
    };
    const second: ProfileSetEvent = {
      user: "GABC123",
      username: "alice_v2",
      creator_token: "GTOKEN456",
      ledger: 1500,
    };

    await handleProfileSet(db, first);
    await handleProfileSet(db, second);

    expect(db.upsertProfile).toHaveBeenCalledTimes(2);
    expect(db.upsertProfile).toHaveBeenLastCalledWith({
      address: "GABC123",
      username: "alice_v2",
      creator_token: "GTOKEN456",
      updated_ledger: 1500,
    });
  });

  // ── Validation ──────────────────────────────────────────────────────────────

  it("throws when user field is missing", async () => {
    const event = {
      user: "",
      username: "alice",
      creator_token: "GTOKEN456",
      ledger: 1000,
    } as ProfileSetEvent;

    await expect(handleProfileSet(db, event)).rejects.toThrow(
      "ProfileSet event missing required field: user"
    );
    expect(db.upsertProfile).not.toHaveBeenCalled();
  });

  it("throws when username field is missing", async () => {
    const event = {
      user: "GABC123",
      username: "",
      creator_token: "GTOKEN456",
      ledger: 1000,
    } as ProfileSetEvent;

    await expect(handleProfileSet(db, event)).rejects.toThrow(
      "ProfileSet event missing required field: username"
    );
    expect(db.upsertProfile).not.toHaveBeenCalled();
  });

  // ── Database error propagation ──────────────────────────────────────────────

  it("propagates database errors", async () => {
    db.upsertProfile.mockRejectedValueOnce(new Error("DB connection lost"));

    const event: ProfileSetEvent = {
      user: "GABC123",
      username: "alice",
      creator_token: "GTOKEN456",
      ledger: 1000,
    };

    await expect(handleProfileSet(db, event)).rejects.toThrow("DB connection lost");
  });
});
