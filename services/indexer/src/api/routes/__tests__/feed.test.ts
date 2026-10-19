import express from "express";
import request from "supertest";
import { createFeedRouter } from "../feed";
import { Database, Post } from "../../../db";

const VALID_ADDRESS = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW";

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 1n,
    author: "GABC",
    deleted: false,
    tip_total: 0n,
    like_count: 0n,
    created_ledger: 1000,
    deleted_ledger: null,
    ...overrides,
  };
}

function makeDb(posts: Post[] = []): Database {
  return {
    listPosts: jest.fn().mockResolvedValue({ posts, total: posts.length }),
  } as unknown as Database;
}

function buildApp(db: Database) {
  const app = express();
  app.use(express.json());
  app.use("/feed", createFeedRouter(db));
  return app;
}

describe("GET /feed/following/:address", () => {
  it("rejects an invalid stellar address with 400", async () => {
    const app = buildApp(makeDb());
    const res = await request(app).get("/feed/following/invalid-address");
    expect(res.status).toBe(400);
  });

  it("returns bounded single endpoint response for valid address", async () => {
    const posts = [makePost({ id: 1n }), makePost({ id: 2n })];
    const db = makeDb(posts);
    const app = buildApp(db);

    const res = await request(app).get(`/feed/following/${VALID_ADDRESS}?limit=10`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("posts");
    expect(res.body).toHaveProperty("has_more");
    expect(res.body).toHaveProperty("next_cursor");
  });
});

describe("GET /feed/explore — composite (score, id) keyset (#1329)", () => {
  function makePoolWithRows(rows: Array<Record<string, unknown>>) {
    const query = jest.fn().mockResolvedValue({ rows });
    return { pool: { query } as unknown as import("pg").Pool, query };
  }

  function buildExploreApp(pool: import("pg").Pool) {
    const app = express();
    app.use(express.json());
    app.use("/feed", createFeedRouter(pool));
    return app;
  }

  it("encodes next_cursor as an opaque composite value, not the raw score", async () => {
    const rows = [
      {
        id: "2",
        author: "GA",
        content: "b",
        tags: [],
        tip_total: 0,
        like_count: 0,
        created_at: new Date(),
        score: 50,
      },
    ];
    const { pool } = makePoolWithRows(rows);
    const res = await request(buildExploreApp(pool)).get("/feed/explore?limit=1");

    expect(res.status).toBe(200);
    expect(res.body.next_cursor).not.toBe(50);
    expect(res.body.next_cursor).not.toContain("50");
    const decoded = Buffer.from(res.body.next_cursor, "base64").toString("utf-8");
    expect(decoded).toBe("50|2");
  });

  it("filters on the composite (score, id) tuple, not score alone", async () => {
    const rows: Array<Record<string, unknown>> = [];
    const { pool, query } = makePoolWithRows(rows);
    const cursor = Buffer.from("50|2", "utf-8").toString("base64");

    await request(buildExploreApp(pool)).get(`/feed/explore?limit=10&cursor=${cursor}`);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/\(score, id\) < \(\$1, \$2\)/);
    expect(sql).toMatch(/ORDER BY score DESC, id DESC/);
    expect(params).toEqual([50, "2", 10]);
  });

  it("rejects a malformed cursor with 400 instead of silently ignoring it", async () => {
    const { pool, query } = makePoolWithRows([]);
    const res = await request(buildExploreApp(pool)).get(
      "/feed/explore?limit=10&cursor=not-a-valid-cursor-at-all"
    );
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("a tied boundary row is included exactly once across two pages (no skip, no duplicate)", async () => {
    // Two posts share score=50 (id "2" and id "1"); with a single-column
    // `score < cursor` filter, both would be dropped or repeated depending on
    // which one landed on the earlier page's boundary. The composite filter
    // orders them by id too, so continuing from (50, "2") always yields "1"
    // and never re-yields "2".
    const page1Rows = [
      {
        id: "2",
        author: "GA",
        content: "a",
        tags: [],
        tip_total: 0,
        like_count: 0,
        created_at: new Date(),
        score: 50,
      },
    ];
    const { pool: pool1 } = makePoolWithRows(page1Rows);
    const firstRes = await request(buildExploreApp(pool1)).get("/feed/explore?limit=1");
    expect(firstRes.body.posts.map((p: { id: string }) => p.id)).toEqual(["2"]);

    const page2Rows = [
      {
        id: "1",
        author: "GA",
        content: "b",
        tags: [],
        tip_total: 0,
        like_count: 0,
        created_at: new Date(),
        score: 50,
      },
    ];
    const { pool: pool2, query } = makePoolWithRows(page2Rows);
    const secondRes = await request(buildExploreApp(pool2)).get(
      `/feed/explore?limit=1&cursor=${firstRes.body.next_cursor}`
    );

    expect(secondRes.body.posts.map((p: { id: string }) => p.id)).toEqual(["1"]);
    const [, params] = query.mock.calls[0];
    expect(params).toEqual([50, "2", 1]);
  });
});

describe("GET /feed/following/:address — composite (created_at, id) keyset (#1329)", () => {
  function makePoolWithRows(rows: Array<Record<string, unknown>>) {
    const query = jest.fn().mockResolvedValue({ rows });
    return { pool: { query } as unknown as import("pg").Pool, query };
  }

  function buildApp(pool: import("pg").Pool) {
    const app = express();
    app.use(express.json());
    app.use("/feed", createFeedRouter(pool));
    return app;
  }

  it("encodes next_cursor as an opaque composite value, not the raw timestamp", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const rows = [
      {
        id: "9",
        author: "GA",
        content: "x",
        tags: [],
        tip_total: 0,
        like_count: 0,
        created_at: createdAt,
      },
    ];
    const { pool } = makePoolWithRows(rows);
    const res = await request(buildApp(pool)).get(`/feed/following/${VALID_ADDRESS}?limit=1`);

    expect(res.status).toBe(200);
    const decoded = Buffer.from(res.body.next_cursor, "base64").toString("utf-8");
    expect(decoded).toBe(`${createdAt.toISOString()}|9`);
  });

  it("filters on the composite (created_at, id) tuple, not created_at alone", async () => {
    const { pool, query } = makePoolWithRows([]);
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const cursor = Buffer.from(`${createdAt.toISOString()}|9`, "utf-8").toString("base64");

    await request(buildApp(pool)).get(`/feed/following/${VALID_ADDRESS}?limit=10&cursor=${cursor}`);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/\(p\.created_at, p\.id\) < \(\$2, \$3\)/);
    expect(sql).toMatch(/ORDER BY p\.created_at DESC, p\.id DESC/);
    expect(params[0]).toBe(VALID_ADDRESS);
    expect((params[1] as Date).getTime()).toBe(createdAt.getTime());
    expect(params[2]).toBe("9");
    expect(params[3]).toBe(10);
  });

  it("rejects a malformed cursor with 400", async () => {
    const { pool, query } = makePoolWithRows([]);
    const res = await request(buildApp(pool)).get(
      `/feed/following/${VALID_ADDRESS}?limit=10&cursor=not-a-valid-cursor`
    );
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
});
