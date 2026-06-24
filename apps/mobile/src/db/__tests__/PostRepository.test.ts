import { MemoryPostStore } from "../MemoryPostStore";
import { PostRepository } from "../PostRepository";
import type { PostRecord } from "../types";

const AUTHOR = "GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function makePost(id: string, timestamp: number, content = `post ${id}`): PostRecord {
  return {
    id,
    author: AUTHOR,
    content,
    tip_total: "0",
    like_count: 0,
    timestamp,
    synced_at: timestamp,
  };
}

function newRepo(): PostRepository {
  return new PostRepository(new MemoryPostStore());
}

describe("PostRepository", () => {
  it("upserts and pages posts newest-first", async () => {
    const repo = newRepo();
    await repo.upsert([makePost("a", 100), makePost("b", 300), makePost("c", 200)]);

    const page = await repo.getPage(0, 10);
    expect(page.map((p) => p.id)).toEqual(["b", "c", "a"]);
  });

  it("upsert overwrites an existing post by id", async () => {
    const repo = newRepo();
    await repo.upsert([makePost("a", 100, "first")]);
    await repo.upsert([{ ...makePost("a", 100, "edited"), like_count: 9 }]);

    const page = await repo.getPage(0, 10);
    expect(page).toHaveLength(1);
    expect(page[0].content).toBe("edited");
    expect(page[0].like_count).toBe(9);
  });

  it("supports offset/limit pagination", async () => {
    const repo = newRepo();
    await repo.upsert([makePost("a", 100), makePost("b", 200), makePost("c", 300)]);

    expect((await repo.getPage(0, 2)).map((p) => p.id)).toEqual(["c", "b"]);
    expect((await repo.getPage(2, 2)).map((p) => p.id)).toEqual(["a"]);
  });

  it("adds pending posts and lists them", async () => {
    const repo = newRepo();
    const pending = await repo.addPending("local-1", "hello world");

    expect(pending.status).toBe("pending");
    expect(await repo.getPending()).toHaveLength(1);
  });

  it("markSynced moves a pending post into the posts table", async () => {
    const repo = newRepo();
    await repo.addPending("local-1", "hello world");

    const record = await repo.markSynced("local-1", "chain-42", AUTHOR);

    expect(record?.id).toBe("chain-42");
    expect(await repo.getPending()).toHaveLength(0);
    const page = await repo.getPage(0, 10);
    expect(page).toHaveLength(1);
    expect(page[0].id).toBe("chain-42");
    expect(page[0].content).toBe("hello world");
  });

  it("markFailed records the error and keeps the pending post for retry", async () => {
    const repo = newRepo();
    await repo.addPending("local-1", "hello world");

    await repo.markFailed("local-1", "network error");

    const [pending] = await repo.getPending();
    expect(pending.status).toBe("failed");
    expect(pending.error).toBe("network error");
  });

  it("findConfirmedMatch detects an already-confirmed post within the window", async () => {
    const repo = newRepo();
    const pending = await repo.addPending("local-1", "duplicate content");
    await repo.upsert([
      { ...makePost("chain-1", pending.created_at), content: "duplicate content" },
    ]);

    const match = await repo.findConfirmedMatch(AUTHOR, pending);
    expect(match?.id).toBe("chain-1");
  });

  it("findConfirmedMatch ignores posts outside the conflict window", async () => {
    const repo = newRepo();
    const pending = await repo.addPending("local-1", "duplicate content");
    await repo.upsert([
      { ...makePost("chain-1", pending.created_at + 48 * 3600), content: "duplicate content" },
    ]);

    expect(await repo.findConfirmedMatch(AUTHOR, pending)).toBeNull();
  });

  it("persists and reads the feed cursor", async () => {
    const repo = newRepo();
    expect(await repo.getCursor("home")).toBeNull();
    await repo.setCursor("home", "cursor-123");
    expect(await repo.getCursor("home")).toBe("cursor-123");
  });
});
