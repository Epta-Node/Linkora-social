import express from "express";
import request from "supertest";
import { createSearchRouter } from "../search";
import { Database, Post } from "../../../db";

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

function makeDb(
  searchResult: { posts: Post[]; total: number } = { posts: [], total: 0 }
): Database {
  return {
    searchPosts: jest.fn().mockResolvedValue(searchResult),
  } as unknown as Database;
}

function buildApp(db: Database) {
  const app = express();
  app.use(express.json());
  app.use("/search", createSearchRouter(db));
  return app;
}

function body(res: { body: unknown }): Record<string, unknown> {
  return res.body as Record<string, unknown>;
}

describe("GET /search/posts", () => {
  it("returns 400 when q is missing", async () => {
    const app = buildApp(makeDb());
    const res = await request(app).get("/search/posts");
    expect(res.status).toBe(400);
  });

  it("returns 400 when q is empty string", async () => {
    const app = buildApp(makeDb());
    const res = await request(app).get("/search/posts?q=");
    expect(res.status).toBe(400);
  });

  it("returns 400 when limit is 0", async () => {
    const app = buildApp(makeDb());
    const res = await request(app).get("/search/posts?q=hello&limit=0");
    expect(res.status).toBe(400);
  });

  it("returns 400 when limit exceeds 100", async () => {
    const app = buildApp(makeDb());
    const res = await request(app).get("/search/posts?q=hello&limit=101");
    expect(res.status).toBe(400);
  });

  it("returns 400 when offset is negative", async () => {
    const app = buildApp(makeDb());
    const res = await request(app).get("/search/posts?q=hello&offset=-1");
    expect(res.status).toBe(400);
  });

  it("delegates to db.searchPosts and returns the list shape", async () => {
    const post = makePost({ id: 42n });
    const db = makeDb({ posts: [post], total: 1 });
    const app = buildApp(db);

    const res = await request(app).get("/search/posts?q=hello&limit=10&offset=0");
    const b = body(res);

    expect(res.status).toBe(200);
    expect(b.total).toBe(1);
    expect(b.limit).toBe(10);
    expect(b.offset).toBe(0);
    expect(b.has_more).toBe(false);
    expect((b.posts as unknown[]).length).toBe(1);

    expect(db.searchPosts).toHaveBeenCalledWith({ q: "hello", limit: 10, offset: 0 });
  });

  it("calculates has_more correctly when more results exist", async () => {
    const posts = Array.from({ length: 10 }, (_, i) => makePost({ id: BigInt(i + 1) }));
    const db = makeDb({ posts, total: 20 });
    const app = buildApp(db);

    const res = await request(app).get("/search/posts?q=linkora&limit=10&offset=0");
    expect(res.status).toBe(200);
    expect(body(res).has_more).toBe(true);
  });

  it("uses default limit and offset when not supplied", async () => {
    const db = makeDb();
    const app = buildApp(db);

    await request(app).get("/search/posts?q=test");
    expect(db.searchPosts).toHaveBeenCalledWith({ q: "test", limit: 20, offset: 0 });
  });
});
