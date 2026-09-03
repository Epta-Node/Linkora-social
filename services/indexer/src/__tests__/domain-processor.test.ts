/**
 * Tests for the domain processor — verifies that profile_set, post_created,
 * and post_deleted events are routed to the correct Database methods, and that
 * existing follow/tip/like routing is unaffected.
 */

import { createDomainProcessor } from "../domain-processor";
import { Database, Post, Profile } from "../db";
import { PgClientLike } from "../pipeline";
import { NotificationService } from "../notifications/service";
import { logger } from "../logger";

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
    deleteProfile: jest.fn().mockResolvedValue(undefined),
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
    listPostsCursor: jest.fn().mockResolvedValue({ posts: [], total: 0, hasMore: false }),
    searchPosts: jest.fn().mockResolvedValue({ posts: [], total: 0 }),
    getFeed: jest.fn().mockResolvedValue({ posts: [], total: 0 }),
    upsertLike: jest.fn().mockResolvedValue(true),
    insertTip: jest.fn().mockResolvedValue(undefined),
    insertReport: jest.fn().mockResolvedValue(undefined),
    updateReportStatus: jest.fn().mockResolvedValue(undefined),
    getPostReports: jest.fn().mockResolvedValue([]),
    upsertPool: jest.fn().mockResolvedValue(undefined),
    adjustPoolBalance: jest.fn().mockResolvedValue(undefined),
    insertPool: jest.fn().mockResolvedValue(undefined),
    getPool: jest.fn().mockResolvedValue(null),
    listPools: jest.fn().mockResolvedValue([]),
    getPoolAnalytics: jest.fn().mockResolvedValue(null),
    addPoolAdmin: jest.fn().mockResolvedValue(undefined),
    removePoolAdmin: jest.fn().mockResolvedValue(undefined),
    upsertGovernanceProposal: jest.fn().mockResolvedValue(undefined),
    updateGovernanceProposalStatus: jest.fn().mockResolvedValue(undefined),
    insertGovernanceVote: jest.fn().mockResolvedValue(true),
    listGovernanceProposals: jest.fn().mockResolvedValue({ proposals: [], total: 0 }),
    insertBlock: jest.fn().mockResolvedValue(undefined),
    deleteBlock: jest.fn().mockResolvedValue(undefined),
    getBlockedUsers: jest.fn().mockResolvedValue({ blocked: [], total: 0 }),
    upsertDmKey: jest.fn().mockResolvedValue(undefined),
    getDmKey: jest.fn().mockResolvedValue(null),
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

// ── malformed numeric fields ────────────────────────────────────────────────

describe("domain-processor: malformed numeric fields", () => {
  it("skips the event and logs a warning instead of writing a phantom id=0 record", async () => {
    const db = makeDb();
    const pool = makePool();
    const ns = makeNotificationService();
    const processor = createDomainProcessor(pool, ns, db);
    const client = makePgClient();
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => logger as never);

    await expect(
      processor(
        client,
        makeIngestEvent("post_created", { id: "not-a-number", author: "GABC" })
      )
    ).resolves.toBeUndefined();

    expect(db.insertPost).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ rawValue: "not-a-number" }),
      expect.stringContaining("malformed")
    );

    warnSpy.mockRestore();
  });

  it("still propagates errors unrelated to malformed values", async () => {
    const db = makeDb();
    (db.markPostDeleted as jest.Mock).mockRejectedValue(new Error("db exploded"));
    const pool = makePool();
    const ns = makeNotificationService();
    const processor = createDomainProcessor(pool, ns, db);
    const client = makePgClient();

    await expect(
      processor(client, makeIngestEvent("post_deleted", { post_id: 1n }))
    ).rejects.toThrow("db exploded");
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

// ── governance events ─────────────────────────────────────────────────────────

describe("domain-processor: gov_proposal_created", () => {
  it("calls db.upsertGovernanceProposal with mapped fields", async () => {
    const db = makeDb();
    const processor = createDomainProcessor(makePool(), makeNotificationService(), db);
    const client = makePgClient();

    await processor(
      client,
      makeIngestEvent("gov_proposal_created", {
        proposal_id: 7n,
        proposer: "GPROPOSER",
        parameter: "FeeBps",
        new_value: 500n,
      })
    );

    expect(db.upsertGovernanceProposal).toHaveBeenCalledWith({
      proposal_id: 7n,
      proposer: "GPROPOSER",
      parameter: "FeeBps",
      new_value: 500n,
      status: "Active",
      created_ledger: 100,
      updated_ledger: 100,
    });
  });

  it("does nothing when db is not provided", async () => {
    const processor = createDomainProcessor(makePool(), makeNotificationService());
    await expect(
      processor(
        makePgClient(),
        makeIngestEvent("gov_proposal_created", { proposal_id: 1n, proposer: "G1" })
      )
    ).resolves.toBeUndefined();
  });
});

describe("domain-processor: gov_vote", () => {
  it("calls db.insertGovernanceVote with mapped fields", async () => {
    const db = makeDb();
    const processor = createDomainProcessor(makePool(), makeNotificationService(), db);
    const client = makePgClient();

    await processor(
      client,
      makeIngestEvent("gov_vote", {
        proposal_id: 7n,
        voter: "GVOTER",
        support: true,
      })
    );

    expect(db.insertGovernanceVote).toHaveBeenCalledWith({
      proposal_id: 7n,
      voter: "GVOTER",
      support: true,
      ledger: 100,
    });
  });

  it("does not throw TypeError — db methods are callable", async () => {
    // Regression guard: before the fix, client as never was passed as db,
    // causing TypeError: db.insertGovernanceVote is not a function.
    const db = makeDb();
    const processor = createDomainProcessor(makePool(), makeNotificationService(), db);

    await expect(
      processor(
        makePgClient(),
        makeIngestEvent("gov_vote", { proposal_id: 3n, voter: "GVOTER", support: false })
      )
    ).resolves.toBeUndefined();

    expect(db.insertGovernanceVote).toHaveBeenCalledTimes(1);
  });

  it("does nothing when db is not provided", async () => {
    const processor = createDomainProcessor(makePool(), makeNotificationService());
    await expect(
      processor(
        makePgClient(),
        makeIngestEvent("gov_vote", { proposal_id: 1n, voter: "G1", support: true })
      )
    ).resolves.toBeUndefined();
  });
});

describe("domain-processor: gov_proposal_executed", () => {
  it("calls db.updateGovernanceProposalStatus with Executed", async () => {
    const db = makeDb();
    const processor = createDomainProcessor(makePool(), makeNotificationService(), db);

    await processor(
      makePgClient(),
      makeIngestEvent("gov_proposal_executed", { proposal_id: 7n, parameter: "FeeBps", new_value: 500n })
    );

    expect(db.updateGovernanceProposalStatus).toHaveBeenCalledWith(7n, "Executed", 100);
  });

  it("does nothing when db is not provided", async () => {
    const processor = createDomainProcessor(makePool(), makeNotificationService());
    await expect(
      processor(makePgClient(), makeIngestEvent("gov_proposal_executed", { proposal_id: 1n }))
    ).resolves.toBeUndefined();
  });
});

describe("domain-processor: gov_proposal_vetoed", () => {
  it("calls db.updateGovernanceProposalStatus with Vetoed", async () => {
    const db = makeDb();
    const processor = createDomainProcessor(makePool(), makeNotificationService(), db);

    await processor(
      makePgClient(),
      makeIngestEvent("gov_proposal_vetoed", { proposal_id: 9n })
    );

    expect(db.updateGovernanceProposalStatus).toHaveBeenCalledWith(9n, "Vetoed", 100);
  });
});

// ── moderation events ─────────────────────────────────────────────────────────

describe("domain-processor: post_reported", () => {
  it("calls db.insertReport with mapped fields", async () => {
    const db = makeDb();
    const processor = createDomainProcessor(makePool(), makeNotificationService(), db);

    await processor(
      makePgClient(),
      makeIngestEvent("post_reported", {
        post_id: 55n,
        reporter_address: "GREPORTER",
        reason: "Spam",
        tx_hash: "0xaaa",
      })
    );

    expect(db.insertReport).toHaveBeenCalledTimes(1);
    const arg = (db.insertReport as jest.Mock).mock.calls[0][0];
    expect(arg.post_id).toBe(55n);
    expect(arg.reporter_address).toBe("GREPORTER");
    expect(arg.reason).toBe("Spam");
    expect(arg.status).toBe("pending");
  });

  it("does not throw TypeError — db methods are callable", async () => {
    // Regression guard: before the fix, pool as never was passed as db,
    // causing TypeError: db.insertReport is not a function.
    const db = makeDb();
    const processor = createDomainProcessor(makePool(), makeNotificationService(), db);

    await expect(
      processor(
        makePgClient(),
        makeIngestEvent("post_reported", {
          post_id: 1n,
          reporter_address: "GREPORTER",
          reason: "Spam",
        })
      )
    ).resolves.toBeUndefined();

    expect(db.insertReport).toHaveBeenCalledTimes(1);
  });

  it("does nothing when db is not provided", async () => {
    const processor = createDomainProcessor(makePool(), makeNotificationService());
    await expect(
      processor(
        makePgClient(),
        makeIngestEvent("post_reported", { post_id: 1n, reporter_address: "G1", reason: "x" })
      )
    ).resolves.toBeUndefined();
  });
});

describe("domain-processor: report_dismissed", () => {
  it("calls db.updateReportStatus with dismissed", async () => {
    const db = makeDb();
    const processor = createDomainProcessor(makePool(), makeNotificationService(), db);

    await processor(
      makePgClient(),
      makeIngestEvent("report_dismissed", {
        post_id: 55n,
        reporter_address: "GREPORTER",
        moderator_address: "GMOD",
        moderator_notes: "Looks fine",
      })
    );

    expect(db.updateReportStatus).toHaveBeenCalledWith(
      55n,
      "GREPORTER",
      "dismissed",
      "GMOD",
      "Looks fine"
    );
  });

  it("does nothing when db is not provided", async () => {
    const processor = createDomainProcessor(makePool(), makeNotificationService());
    await expect(
      processor(
        makePgClient(),
        makeIngestEvent("report_dismissed", {
          post_id: 1n,
          reporter_address: "G1",
          moderator_address: "GMOD",
        })
      )
    ).resolves.toBeUndefined();
  });
});

describe("domain-processor: post_removed_by_moderation", () => {
  it("calls db.markPostDeleted and db.getPostReports + db.updateReportStatus for pending reports", async () => {
    const db = makeDb();
    (db.getPostReports as jest.Mock).mockResolvedValue([
      { post_id: 10n, reporter_address: "GREPORTER", status: "pending" },
    ]);
    const processor = createDomainProcessor(makePool(), makeNotificationService(), db);

    await processor(
      makePgClient(),
      makeIngestEvent("post_removed_by_moderation", {
        post_id: 10n,
        moderator_address: "GMOD",
        reason: "Violates guidelines",
      })
    );

    expect(db.markPostDeleted).toHaveBeenCalledWith(10n, 100);
    expect(db.getPostReports).toHaveBeenCalledWith(10n);
    expect(db.updateReportStatus).toHaveBeenCalledWith(
      10n,
      "GREPORTER",
      "action_taken",
      "GMOD",
      "Violates guidelines"
    );
  });

  it("does nothing when db is not provided", async () => {
    const processor = createDomainProcessor(makePool(), makeNotificationService());
    await expect(
      processor(
        makePgClient(),
        makeIngestEvent("post_removed_by_moderation", {
          post_id: 1n,
          moderator_address: "GMOD",
          reason: "x",
        })
      )
    ).resolves.toBeUndefined();
  });
});
