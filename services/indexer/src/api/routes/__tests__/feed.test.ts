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
