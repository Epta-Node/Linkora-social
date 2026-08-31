import express from "express";
import request from "supertest";
import { createPoolsRouter } from "../pools";
import { Database, Pool, PoolAnalytics } from "../../../db";

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
    getPoolAnalytics: jest.fn().mockResolvedValue(makeAnalytics()),
    ...overrides,
  } as unknown as Database;
}

describe("GET /pools", () => {
  it("returns all pools", async () => {
    const pools = [makePool({ pool_id: "community" }), makePool({ pool_id: "grants" })];
    const db = makeDb({ listPools: jest.fn().mockResolvedValue(pools) });
    const app = buildApp(db);

    const res = await request(app).get("/pools");
    expect(res.status).toBe(200);
    expect(body(res).pools).toHaveLength(2);
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
