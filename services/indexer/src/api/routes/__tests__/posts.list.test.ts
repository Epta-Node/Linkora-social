import express from "express";
import request from "supertest";
import { createPostsRouter } from "../posts";
import { Database, Post } from "../../../db";
import { encodeCursor } from "../cursor";

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    id: 1n,
    author: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW",
    deleted: false,
    tip_total: 0n,
    like_count: 0n,
    created_ledger: 1000,
    deleted_ledger: null,
    content: "hello",
    ...overrides,
  };
}

function makeDb(overrides: Partial<Database> = {}): Database {
  return {
    listPostsCursor: jest.fn().mockResolvedValue({ posts: [], nextCursor: null }),
    getPost: jest.fn().mockResolvedValue(null),
    getPostReports: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as Database;
}

function buildApp(db: Database) {
  const app = express();
  app.use(express.json());
  app.use("/posts", createPostsRouter(db));
  return app;
}

function body(res: { body: unknown }): Record<string, unknown> {
  return res.body as Record<string, unknown>;
}

describe("GET /posts — cursor pagination", () => {
  it("returns cursor pagination fields with no cursor", async () => {
    const posts = [makePost({ id: 1n }), makePost({ id: 2n })];
    const db = makeDb({
      listPostsCursor: jest.fn().mockResolvedValue({ posts, nextCursor: null }),
    });
    const app = buildApp(db);

    const res = await request(app).get("/posts");
    expect(res.status).toBe(200);
    expect(body(res)).toHaveProperty("posts");
    expect(body(res)).toHaveProperty("next_cursor", null);
    expect(body(res)).toHaveProperty("has_more", false);
    expect(body(res)).toHaveProperty("cursor", null);
    expect(body(res)).toHaveProperty("limit", 20);
  });

  it("forwards limit and cursor to the database", async () => {
    const cursor = encodeCursor("2026-01-01T00:00:00.000Z", "5");
    const listPostsCursor = jest.fn().mockResolvedValue({ posts: [], nextCursor: null });
    const db = makeDb({ listPostsCursor });
    const app = buildApp(db);

    const res = await request(app).get(`/posts?limit=5&cursor=${encodeURIComponent(cursor)}`);
    expect(res.status).toBe(200);
    expect(listPostsCursor).toHaveBeenCalledWith({ author: undefined, limit: 5, cursor });
  });

  it("forwards author filter alongside cursor params", async () => {
    const listPostsCursor = jest.fn().mockResolvedValue({ posts: [], nextCursor: null });
    const db = makeDb({ listPostsCursor });
    const app = buildApp(db);

    const author = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW";
    await request(app).get(`/posts?author=${author}`);
    expect(listPostsCursor).toHaveBeenCalledWith(
      expect.objectContaining({ author })
    );
  });

  it("returns next_cursor and has_more=true when more pages exist", async () => {
    const nextCursor = encodeCursor("2026-01-01T00:00:00.000Z", "3");
    const db = makeDb({
      listPostsCursor: jest.fn().mockResolvedValue({
        posts: [makePost()],
        nextCursor,
      }),
    });
    const app = buildApp(db);

    const res = await request(app).get("/posts?limit=1");
    expect(res.status).toBe(200);
    expect(body(res).next_cursor).toBe(nextCursor);
    expect(body(res).has_more).toBe(true);
  });

  it("returns has_more=false and next_cursor=null on the last page", async () => {
    const db = makeDb({
      listPostsCursor: jest.fn().mockResolvedValue({ posts: [makePost()], nextCursor: null }),
    });
    const app = buildApp(db);

    const res = await request(app).get("/posts");
    expect(res.status).toBe(200);
    expect(body(res).next_cursor).toBeNull();
    expect(body(res).has_more).toBe(false);
  });

  it("echoes the cursor param back in the response envelope", async () => {
    const cursor = encodeCursor("2026-01-01T00:00:00.000Z", "9");
    const db = makeDb();
    const app = buildApp(db);

    const res = await request(app).get(`/posts?cursor=${encodeURIComponent(cursor)}`);
    expect(res.status).toBe(200);
    expect(body(res).cursor).toBe(cursor);
  });

  it("rejects limit > 100 with 400", async () => {
    const app = buildApp(makeDb());
    const res = await request(app).get("/posts?limit=200");
    expect(res.status).toBe(400);
  });

  it("rejects a non-base64 cursor with 400", async () => {
    const app = buildApp(makeDb());
    const res = await request(app).get("/posts?cursor=not+valid!!!");
    expect(res.status).toBe(400);
  });

  it("no duplicate or skipped items — next page starts strictly after last row on page 1", async () => {
    // Two posts share the same created_at; the composite cursor (created_at|id)
    // ensures page 2 starts strictly after (ts, id=2) and yields id=1, never id=2 again.
    const ts = "2026-01-01T00:00:00.000Z";
    const page1Cursor = encodeCursor(ts, "2");

    const listPostsCursor = jest.fn().mockResolvedValue({ posts: [], nextCursor: null });
    const db = makeDb({ listPostsCursor });
    const app = buildApp(db);

    await request(app).get(`/posts?limit=1&cursor=${encodeURIComponent(page1Cursor)}`);

    expect(listPostsCursor).toHaveBeenCalledWith({
      author: undefined,
      limit: 1,
      cursor: page1Cursor,
    });
  });

  it("forwards search query q to the database", async () => {
    const listPostsCursor = jest.fn().mockResolvedValue({ posts: [], nextCursor: null });
    const db = makeDb({ listPostsCursor });
    const app = buildApp(db);

    const res = await request(app).get("/posts?q=stellar");
    expect(res.status).toBe(200);
    expect(listPostsCursor).toHaveBeenCalledWith(
      expect.objectContaining({
        q: "stellar",
      })
    );
  });

  it("forwards q, author, limit, and cursor together", async () => {
    const cursor = encodeCursor("2026-01-01T00:00:00.000Z", "10");
    const listPostsCursor = jest.fn().mockResolvedValue({ posts: [], nextCursor: null });
    const db = makeDb({ listPostsCursor });
    const app = buildApp(db);

    const res = await request(app).get(`/posts?q=web3&author=GAA&limit=5&cursor=${cursor}`);
    expect(res.status).toBe(200);
    expect(listPostsCursor).toHaveBeenCalledWith({
      author: "GAA",
      limit: 5,
      cursor,
      q: "web3",
    });
  });
});
