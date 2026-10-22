import express from "express";
import request from "supertest";
import { createProfilesRouter } from "../profiles";
import { Database, Profile } from "../../../db";

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    username: "linkora",
    creator_token: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    updated_ledger: 1000,
    follower_count: 4,
    ...overrides,
  };
}

function makeDb(
  result: { profiles: Profile[]; total: number } = { profiles: [], total: 0 }
): Database {
  return {
    searchProfiles: jest.fn().mockResolvedValue(result),
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
    const db = makeDb({ profiles: [makeProfile()], total: 5 });
    const res = await request(buildApp(db)).get("/profiles/search?q=link&limit=1&offset=0");

    expect(res.status).toBe(200);
    expect(body(res).total).toBe(5);
    expect(body(res).limit).toBe(1);
    expect(body(res).offset).toBe(0);
    expect(body(res).has_more).toBe(true);
    expect(body(res).profiles).toEqual([makeProfile()]);
    expect(db.searchProfiles).toHaveBeenCalledWith({ q: "link", limit: 1, offset: 0 });
  });

  it("passes default pagination", async () => {
    const db = makeDb();
    await request(buildApp(db)).get("/profiles/search?q=gabc");
    expect(db.searchProfiles).toHaveBeenCalledWith({ q: "gabc", limit: 20, offset: 0 });
  });
});
