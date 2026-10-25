import express from "express";
import request from "supertest";
import { createProfilesRouter } from "../profiles";
import { Database, Profile } from "../../../db";
import { encodeCursor } from "../cursor";

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    address: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW",
    username: "testuser",
    creator_token: "GTOKEN123",
    updated_ledger: 1000,
    follower_count: 4,
    ...overrides,
  };
}

function makeDb(overrides: Partial<Database> = {}): Database {
  return {
    searchProfiles: jest.fn().mockResolvedValue({ profiles: [], total: 0 }),
    listProfilesCursor: jest.fn().mockResolvedValue({ profiles: [], nextCursor: null }),
    getProfile: jest.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as Database;
}

function buildApp(db: Database) {
  const app = express();
  app.use(express.json());
  app.use("/profiles", createProfilesRouter(db));
  return app;
}

function body(res: { body: unknown }): Record<string, unknown> {
  return res.body as Record<string, unknown>;
}

describe("GET /profiles/search", () => {
  it("returns 400 when q is missing", async () => {
    const res = await request(buildApp(makeDb())).get("/profiles/search");
    expect(res.status).toBe(400);
  });

  it("returns 400 when q is blank", async () => {
    const res = await request(buildApp(makeDb())).get("/profiles/search?q=%20");
    expect(res.status).toBe(400);
  });

  it("delegates to db.searchProfiles and returns the list shape", async () => {
    const searchProfiles = jest
      .fn()
      .mockResolvedValue({ profiles: [makeProfile()], total: 5 });
    const db = makeDb({ searchProfiles });
    const res = await request(buildApp(db)).get("/profiles/search?q=link&limit=1&offset=0");

    expect(res.status).toBe(200);
    expect(body(res).total).toBe(5);
    expect(body(res).limit).toBe(1);
    expect(body(res).offset).toBe(0);
    expect(body(res).has_more).toBe(true);
    expect(body(res).profiles).toEqual([makeProfile()]);
    expect(searchProfiles).toHaveBeenCalledWith({ q: "link", limit: 1, offset: 0 });
  });

  it("passes default pagination", async () => {
    const db = makeDb();
    await request(buildApp(db)).get("/profiles/search?q=gabc");
    expect(db.searchProfiles).toHaveBeenCalledWith({ q: "gabc", limit: 20, offset: 0 });
  });
});

describe("GET /profiles — cursor pagination", () => {
  it("returns cursor pagination fields with no cursor", async () => {
    const profiles = [makeProfile(), makeProfile({ address: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" })];
    const db = makeDb({
      listProfilesCursor: jest.fn().mockResolvedValue({ profiles, nextCursor: null }),
    });
    const app = buildApp(db);

    const res = await request(app).get("/profiles");
    expect(res.status).toBe(200);
    expect(body(res)).toHaveProperty("profiles");
    expect(body(res)).toHaveProperty("next_cursor", null);
    expect(body(res)).toHaveProperty("has_more", false);
    expect(body(res)).toHaveProperty("cursor", null);
    expect(body(res)).toHaveProperty("limit", 20);
  });

  it("forwards limit and cursor to the database", async () => {
    const cursor = encodeCursor("1000", "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW");
    const listProfilesCursor = jest.fn().mockResolvedValue({ profiles: [], nextCursor: null });
    const db = makeDb({ listProfilesCursor });
    const app = buildApp(db);

    const res = await request(app).get(`/profiles?limit=5&cursor=${encodeURIComponent(cursor)}`);
    expect(res.status).toBe(200);
    expect(listProfilesCursor).toHaveBeenCalledWith({ limit: 5, cursor });
  });

  it("returns next_cursor and has_more=true when more pages exist", async () => {
    const nextCursor = encodeCursor("999", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    const db = makeDb({
      listProfilesCursor: jest.fn().mockResolvedValue({
        profiles: [makeProfile()],
        nextCursor,
      }),
    });
    const app = buildApp(db);

    const res = await request(app).get("/profiles?limit=1");
    expect(res.status).toBe(200);
    expect(body(res).next_cursor).toBe(nextCursor);
    expect(body(res).has_more).toBe(true);
  });

  it("returns has_more=false and next_cursor=null on the last page", async () => {
    const db = makeDb({
      listProfilesCursor: jest.fn().mockResolvedValue({ profiles: [makeProfile()], nextCursor: null }),
    });
    const app = buildApp(db);

    const res = await request(app).get("/profiles");
    expect(res.status).toBe(200);
    expect(body(res).next_cursor).toBeNull();
    expect(body(res).has_more).toBe(false);
  });

  it("echoes the cursor param back in the response envelope", async () => {
    const cursor = encodeCursor("500", "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVW");
    const db = makeDb();
    const app = buildApp(db);

    const res = await request(app).get(`/profiles?cursor=${encodeURIComponent(cursor)}`);
    expect(res.status).toBe(200);
    expect(body(res).cursor).toBe(cursor);
  });

  it("rejects limit > 100 with 400", async () => {
    const app = buildApp(makeDb());
    const res = await request(app).get("/profiles?limit=150");
    expect(res.status).toBe(400);
  });

  it("rejects a non-base64 cursor with 400", async () => {
    const app = buildApp(makeDb());
    const res = await request(app).get("/profiles?cursor=not+valid!!!");
    expect(res.status).toBe(400);
  });

  it("returns the correct profile shape", async () => {
    const profile = makeProfile({ username: "alice", updated_ledger: 42 });
    const db = makeDb({
      listProfilesCursor: jest.fn().mockResolvedValue({ profiles: [profile], nextCursor: null }),
    });
    const app = buildApp(db);

    const res = await request(app).get("/profiles");
    expect(res.status).toBe(200);
    const profiles = body(res).profiles as Profile[];
    expect(profiles[0].username).toBe("alice");
    expect(profiles[0].updated_ledger).toBe(42);
  });
});
