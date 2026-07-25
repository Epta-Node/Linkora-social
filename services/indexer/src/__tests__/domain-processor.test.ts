/**
 * Tests for the domain processor — verifies that profile_set, post_created,
 * and post_deleted events are routed to the correct Database methods, and that
 * existing follow/tip/like routing is unaffected.
 */

import { createDomainProcessor } from "../domain-processor";
import { Database, Post, Profile } from "../db";
import { PgClientLike } from "../pipeline";
import { NotificationService } from "../notifications/service";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeIngestEvent(
  topic: string,
  data: Record<string, unknown>,
  ledgerSequence = 100
) {
  return {
    ledgerSequence,
    eventIndex: 0,
    contractId: "C_TEST",
    type: topic,
    topic: [topic],
    data,
  };
}

function makeDb(): jest.Mocked<Database> {
  return {
    upsertProfile: jest.fn().mockResolvedValue(undefined),
    getProfile: jest.fn().mockResolvedValue(null),
    insertFollow: jest.fn().mockResolvedValue(undefined),
    deleteFollow: jest.fn().mockResolvedValue(undefined),
    getFollowers: jest.fn().mockResolvedValue({ followers: [], total: 0 }),
    getFollowing: jest.fn().mockResolvedValue({ following: [], total: 0 }),
    insertPost: jest.fn().mockResolvedValue(undefined),
    markPostDeleted: jest.fn().mockResolvedValue(undefined),
    incrementPostLikeCount: jest.fn().mockResolvedValue(undefined),
    addPostTipTotal: jest.fn().mockResolvedValue(undefined),
    getPost: jest.fn().mockResolvedValue(null),
    listPosts: jest.fn().mockResolvedValue({ posts: [], total: 0 }),
    searchPosts: jest.fn().mockResolvedValue({ posts: [], total: 0 }),
    upsertLike: jest.fn().mockResolvedValue(true),
    insertTip: jest.fn().mockResolvedValue(undefined),
    upsertPool: jest.fn().mockResolvedValue(undefined),
    adjustPoolBalance: jest.fn().mockResolvedValue(undefined),
    insertPool: jest.fn().mockResolvedValue(undefined),
    getPool: jest.fn().mockResolvedValue(null),
    addPoolAdmin: jest.fn().mockResolvedValue(undefined),
    removePoolAdmin: jest.fn().mockResolvedValue(undefined),
  } as jest.Mocked<Database>;
}

function makePool() {
  return { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
}

function makeNotificationService(): jest.Mocked<NotificationService> {
  return {
    dispatchEventNotification: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<NotificationService>;
}

function makePgClient(): PgClientLike {
  return { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) } as unknown as PgClientLike;
}

// ── profile_set ───────────────────────────────────────────────────────────────

describe("domain-processor: profile_set", () => {
  it("calls db.upsertProfile with mapped fields", async () => {
    const db = makeDb();
    const pool = makePool();
    const ns = makeNotificationService();
    const processor = createDomainProcessor(pool, ns, db);
    const client = makePgClient();

    await processor(
      client,
      makeIngestEvent("profile_set", {
        user: "GABC",
        username: "alice",
        creator_token: "TOKEN",
      })
    );

    expect(db.upsertProfile).toHaveBeenCalledWith<[Profile]>({
      address: "GABC",
      username: "alice",
      creator_token: "TOKEN",
      updated_ledger: 100,
    });
  });

  it("does nothing when db is not provided", async () => {
    const pool = makePool();
    const ns = makeNotificationService();
    // No db passed → fourth arg undefined
    const processor = createDomainProcessor(pool, ns);
    const client = makePgClient();

    // Should not throw
    await expect(
      processor(client, makeIngestEvent("profile_set", { user: "G1", username: "bob" }))
    ).resolves.toBeUndefined();
  });
});

// ── post_created ──────────────────────────────────────────────────────────────

describe("domain-processor: post_created", () => {
  it("calls db.insertPost with correct fields", async () => {
    const db = makeDb();
    const pool = makePool();
    const ns = makeNotificationService();
    const processor = createDomainProcessor(pool, ns, db);
    const client = makePgClient();

    await processor(
      client,
      makeIngestEvent("post_created", {
        id: 99n,
        author: "GABC",
        content: "Hello world",
      })
    );

    expect(db.insertPost).toHaveBeenCalledTimes(1);
    const arg = (db.insertPost as jest.Mock).mock.calls[0][0] as Post & { content?: string };
    expect(arg.id).toBe(99n);
    expect(arg.author).toBe("GABC");
    expect(arg.deleted).toBe(false);
    expect(arg.tip_total).toBe(0n);
    expect(arg.like_count).toBe(0n);
    expect(arg.created_ledger).toBe(100);
    expect(arg.deleted_ledger).toBeNull();
  });

  it("does nothing when db is not provided", async () => {
    const pool = makePool();
    const ns = makeNotificationService();
    const processor = createDomainProcessor(pool, ns);
    const client = makePgClient();

    await expect(
      processor(client, makeIngestEvent("post_created", { id: 1n, author: "G1" }))
    ).resolves.toBeUndefined();
  });
});

// ── post_deleted ──────────────────────────────────────────────────────────────

describe("domain-processor: post_deleted", () => {
  it("calls db.markPostDeleted with post_id and ledger", async () => {
    const db = makeDb();
    const pool = makePool();
    const ns = makeNotificationService();
    const processor = createDomainProcessor(pool, ns, db);
    const client = makePgClient();

    await processor(
      client,
      makeIngestEvent("post_deleted", { post_id: 77n }, 200)
    );

    expect(db.markPostDeleted).toHaveBeenCalledWith(77n, 200);
  });

  it("does nothing when db is not provided", async () => {
    const pool = makePool();
    const ns = makeNotificationService();
    const processor = createDomainProcessor(pool, ns);
    const client = makePgClient();

    await expect(
      processor(client, makeIngestEvent("post_deleted", { post_id: 1n }))
    ).resolves.toBeUndefined();
  });
});

// ── pool events ───────────────────────────────────────────────────────────────────

describe("domain-processor: pool_created", () => {
  it("calls db.insertPool with mapped fields", async () => {
    const db = makeDb();
    const processor = createDomainProcessor(makePool(), makeNotificationService(), db);
    const client = makePgClient();

    await processor(
      client,
      makeIngestEvent("pool_created", {
        pool_id: "P123",
        token: "TOKEN_A",
        admins: ["A1", "A2"],
        threshold: 2,
      })
    );

    expect(db.insertPool).toHaveBeenCalledWith({
      pool_id: "P123",
      token: "TOKEN_A",
      balance: 0n,
      admins: ["A1", "A2"],
      threshold: 2,
      created_ledger: 100,
      updated_ledger: 100,
    });
  });

  it("does nothing when db is not provided", async () => {
    const processor = createDomainProcessor(makePool(), makeNotificationService());
    await expect(
      processor(makePgClient(), makeIngestEvent("pool_created", { pool_id: "P1" }))
    ).resolves.toBeUndefined();
  });
});

describe("domain-processor: pool_deposit", () => {
  it("calls db.adjustPoolBalance with amount", async () => {
    const db = makeDb();
    const processor = createDomainProcessor(makePool(), makeNotificationService(), db);
    const client = makePgClient();

    await processor(
      client,
      makeIngestEvent("pool_deposit", {
        pool_id: "P123",
        amount: 500n,
      })
    );

    expect(db.adjustPoolBalance).toHaveBeenCalledWith("P123", 500n, 100);
  });
});

describe("domain-processor: pool_withdraw", () => {
  it("calls db.adjustPoolBalance with negative amount", async () => {
    const db = makeDb();
    const processor = createDomainProcessor(makePool(), makeNotificationService(), db);
    const client = makePgClient();

    await processor(
      client,
      makeIngestEvent("pool_withdraw", {
        pool_id: "P123",
        amount: 200n,
      })
    );

    expect(db.adjustPoolBalance).toHaveBeenCalledWith("P123", -200n, 100);
  });
});

// ── unknown topics still fall through ────────────────────────────────────────

describe("domain-processor: unknown topic", () => {
  it("does not throw for unknown topics", async () => {
    const db = makeDb();
    const pool = makePool();
    const ns = makeNotificationService();
    const processor = createDomainProcessor(pool, ns, db);
    const client = makePgClient();

    await expect(
      processor(client, makeIngestEvent("some_unknown_event", {}))
    ).resolves.toBeUndefined();

    expect(db.upsertProfile).not.toHaveBeenCalled();
    expect(db.insertPost).not.toHaveBeenCalled();
    expect(db.markPostDeleted).not.toHaveBeenCalled();
  });
});
