import express from "express";
import request from "supertest";
import { createPoolsRouter } from "../pools";
import { Database, Pool, PoolAnalytics } from "../../../db";
import { encodeCursor } from "../cursor";

function makePool(overrides: Partial<Pool> = {}): Pool {
  return {
    pool_id: "community",
    token: "GDQOE23CFSUMSVQK4Y5JHPPYK73VYCNHZHA7ENKCV37P6SUEO6XQBKPP",
    balance: BigInt("5000000000"),
    admins: ["GAAA", "GBBB"],
    threshold: 2,
    created_ledger: 1000,
    updated_ledger: 1000,
    ...overrides,
  };
}

function makeAnalytics(overrides: Partial<PoolAnalytics> = {}): PoolAnalytics {
  return {
    total_deposited: "7000000000",
    total_withdrawn: "2000000000",
    contributor_count: 5,
    recent_events: [],
    volume_7d: "150000000",
    volume_30d: "300000000",
    ...overrides,
  };
}

function buildApp(db: Database) {
  const app = express();
  app.use(express.json());
  app.use("/pools", createPoolsRouter(db));
  return app;
}

function body(res: { body: unknown }): Record<string, unknown> {
  return res.body as Record<string, unknown>;
}

function makeDb(overrides: Partial<Database> = {}): Database {
  return {
    getPool: jest.fn().mockResolvedValue(null),
    listPools: jest.fn().mockResolvedValue([]),
    listPoolsCursor: jest.fn().mockResolvedValue({ pools: [], nextCursor: null }),
    searchPools: jest.fn().mockResolvedValue({ pools: [], total: 0 }),
    getPoolAnalytics: jest.fn().mockResolvedValue(makeAnalytics()),
    ...overrides,
  } as unknown as Database;
}

describe("GET /pools", () => {
  it("returns all pools with cursor pagination fields", async () => {
    const pools = [makePool({ pool_id: "community" }), makePool({ pool_id: "grants" })];
    const db = makeDb({ listPoolsCursor: jest.fn().mockResolvedValue({ pools, nextCursor: null }) });
    const app = buildApp(db);

    const res = await request(app).get("/pools");
    expect(res.status).toBe(200);
    expect(body(res).pools).toHaveLength(2);
    expect(body(res)).toHaveProperty("next_cursor", null);
    expect(body(res)).toHaveProperty("has_more", false);
    expect(body(res)).toHaveProperty("cursor", null);
  });

  it("forwards limit and cursor query params to the DB", async () => {
    const cursor = encodeCursor("1000", "community");
    const listPoolsCursor = jest.fn().mockResolvedValue({ pools: [], nextCursor: null });
    const db = makeDb({ listPoolsCursor });
    const app = buildApp(db);

    const res = await request(app).get(`/pools?limit=5&cursor=${encodeURIComponent(cursor)}`);
    expect(res.status).toBe(200);
    expect(listPoolsCursor).toHaveBeenCalledWith({ limit: 5, cursor });
  });

  it("returns next_cursor when more pages exist", async () => {
    const nextCursor = encodeCursor("999", "grants");
    const db = makeDb({
      listPoolsCursor: jest.fn().mockResolvedValue({
        pools: [makePool()],
        nextCursor,
      }),
    });
    const app = buildApp(db);

    const res = await request(app).get("/pools?limit=1");
    expect(res.status).toBe(200);
    expect(body(res).next_cursor).toBe(nextCursor);
    expect(body(res).has_more).toBe(true);
  });

  it("rejects limit > 100 with 400", async () => {
    const db = makeDb();
    const app = buildApp(db);

    const res = await request(app).get("/pools?limit=200");
    expect(res.status).toBe(400);
  });

  it("rejects a non-base64 cursor with 400", async () => {
    const db = makeDb();
    const app = buildApp(db);

    const res = await request(app).get("/pools?cursor=not+valid!!!");
    expect(res.status).toBe(400);
  });
  describe("GET /pools/search", () => {
    it("returns 400 when q is missing", async () => {
      const res = await request(buildApp(makeDb())).get("/pools/search");
      expect(res.status).toBe(400);
    });

    it("delegates to db.searchPools and serialises balances", async () => {
      const db = makeDb({
        searchPools: jest.fn().mockResolvedValue({ pools: [makePool()], total: 3 }),
      });
      const res = await request(buildApp(db)).get("/pools/search?q=comm&limit=1&offset=0");

      expect(res.status).toBe(200);
      expect(body(res).total).toBe(3);
      expect(body(res).has_more).toBe(true);
      expect((body(res).pools as Array<Record<string, unknown>>)[0].balance).toBe("5000000000");
      expect(db.searchPools).toHaveBeenCalledWith({ q: "comm", limit: 1, offset: 0 });
    });
  });
});

describe("GET /pools/:id", () => {
  it("returns 400 when id is whitespace-only", async () => {
    const db = makeDb();
    const app = buildApp(db);

    const res = await request(app).get("/pools/%20");
    expect(res.status).toBe(400);
  });

  it("returns 404 when pool not found", async () => {
    const db = makeDb({ getPool: jest.fn().mockResolvedValue(null) });
    const app = buildApp(db);

    const res = await request(app).get("/pools/nonexistent");
    expect(res.status).toBe(404);
    expect(body(res).error.code).toBe("NOT_FOUND");
  });
});

describe("GET /pools/:id/analytics", () => {
  it("returns 400 when id is whitespace-only", async () => {
    const db = makeDb();
    const app = buildApp(db);

    const res = await request(app).get("/pools/%20/analytics");
    expect(res.status).toBe(400);
  });

  it("returns 404 when pool not found", async () => {
    const db = makeDb({ getPool: jest.fn().mockResolvedValue(null) });
    const app = buildApp(db);

    const res = await request(app).get("/pools/nonexistent/analytics");
    expect(res.status).toBe(404);
    expect(body(res).error.code).toBe("NOT_FOUND");
  });

  it("returns analytics data for a pool", async () => {
    const pool = makePool();
    const analytics = makeAnalytics();
    const db = makeDb({
      getPool: jest.fn().mockResolvedValue(pool),
      getPoolAnalytics: jest.fn().mockResolvedValue(analytics),
    });
    const app = buildApp(db);

    const res = await request(app).get("/pools/community/analytics");
    expect(res.status).toBe(200);
    expect(body(res).pool_id).toBe("community");
    expect(body(res).contributor_count).toBe(5);
    expect(body(res).total_deposited).toBe("7000000000");
  });
});
