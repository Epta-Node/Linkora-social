import express from "express";
import request from "supertest";
import { createProfilesRouter } from "../profiles";
import { Database, Profile } from "../../../db";

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    username: "alice",
    creator_token: "ALICE",
    updated_ledger: 1000,
    ...overrides,
  };
}

function makeDb(
  searchResult: { profiles: Profile[]; total: number } = { profiles: [], total: 0 }
): Database {
  return {
    searchProfiles: jest.fn().mockResolvedValue(searchResult),
    getProfile: jest.fn(),
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
    const app = buildApp(makeDb());
    const res = await request(app).get("/profiles/search");
    expect(res.status).toBe(400);
    expect(body(res).code).toBe("INVALID_QUERY");
  });

  it("delegates to db.searchProfiles and returns the list shape", async () => {
    const profile = makeProfile({ address: "GALICE" });
    const db = makeDb({ profiles: [profile], total: 1 });
    const app = buildApp(db);

    const res = await request(app).get("/profiles/search?q=alice&limit=10&offset=0");
    const b = body(res);

    expect(res.status).toBe(200);
    expect(b.total).toBe(1);
    expect(b.limit).toBe(10);
    expect(b.offset).toBe(0);
    expect(b.has_more).toBe(false);
    expect((b.profiles as unknown[]).length).toBe(1);

    expect(db.searchProfiles).toHaveBeenCalledWith({ q: "alice", limit: 10, offset: 0 });
  });
});
