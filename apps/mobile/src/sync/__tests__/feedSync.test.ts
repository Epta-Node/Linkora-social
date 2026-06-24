import { MemoryPostStore } from "../../db/MemoryPostStore";
import { PostRepository } from "../../db/PostRepository";
import type { PostRecord } from "../../db/types";
import { FeedSyncService } from "../feedSync";
import type { FetchResult, IndexerClient } from "../types";

const AUTHOR = "GABCD1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function makePost(id: string, timestamp: number): PostRecord {
  return {
    id,
    author: AUTHOR,
    content: `post ${id}`,
    tip_total: "0",
    like_count: 0,
    timestamp,
    synced_at: timestamp,
  };
}

describe("FeedSyncService", () => {
  it("renders feed from cache when the network is unavailable", async () => {
    const repo = new PostRepository(new MemoryPostStore());
    await repo.upsert([makePost("a", 100), makePost("b", 200)]);

    const offlineIndexer: IndexerClient = {
      fetchPostsSince: jest.fn(async () => {
        throw new Error("offline");
      }),
    };
    const sync = new FeedSyncService(repo, offlineIndexer);

    const failed = jest.fn();
    sync.events.on("syncFailed", failed);
    const ok = await sync.syncNow();

    expect(ok).toBe(false);
    expect(failed).toHaveBeenCalledWith({ error: "offline" });
    // Cached posts are still readable despite the failed sync.
    expect((await repo.getPage(0, 10)).map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("fetches only new posts using the persisted cursor", async () => {
    const repo = new PostRepository(new MemoryPostStore());
    const calls: Array<string | null> = [];
    const indexer: IndexerClient = {
      fetchPostsSince: jest.fn(async (cursor): Promise<FetchResult> => {
        calls.push(cursor);
        if (cursor === null) {
          return { posts: [makePost("a", 100), makePost("b", 200)], nextCursor: "200" };
        }
        return { posts: [makePost("c", 300)], nextCursor: "300" };
      }),
    };
    const sync = new FeedSyncService(repo, indexer);

    await sync.syncNow();
    await sync.syncNow();

    // First call starts from null, second resumes from the saved cursor.
    expect(calls).toEqual([null, "200"]);
    expect(await repo.getCursor("home")).toBe("300");
    expect((await repo.getPage(0, 10)).map((p) => p.id)).toEqual(["c", "b", "a"]);
  });

  it("does not reset the cursor when the indexer returns nothing new", async () => {
    const repo = new PostRepository(new MemoryPostStore());
    await repo.setCursor("home", "200");
    const indexer: IndexerClient = {
      fetchPostsSince: jest.fn(async () => ({ posts: [], nextCursor: null })),
    };
    const sync = new FeedSyncService(repo, indexer);

    await sync.syncNow();
    expect(await repo.getCursor("home")).toBe("200");
  });

  it("emits started and completed events with the fetched count", async () => {
    const repo = new PostRepository(new MemoryPostStore());
    const indexer: IndexerClient = {
      fetchPostsSince: jest.fn(async () => ({ posts: [makePost("a", 100)], nextCursor: "100" })),
    };
    const sync = new FeedSyncService(repo, indexer);

    const started = jest.fn();
    const completed = jest.fn();
    sync.events.on("syncStarted", started);
    sync.events.on("syncCompleted", completed);

    await sync.syncNow();

    expect(started).toHaveBeenCalledTimes(1);
    expect(completed).toHaveBeenCalledWith({ fetched: 1, cursor: "100" });
  });

  it("coalesces concurrent syncs", async () => {
    const repo = new PostRepository(new MemoryPostStore());
    let resolveFetch: (r: FetchResult) => void = () => {};
    const indexer: IndexerClient = {
      fetchPostsSince: jest.fn(
        () =>
          new Promise<FetchResult>((resolve) => {
            resolveFetch = resolve;
          })
      ),
    };
    const sync = new FeedSyncService(repo, indexer);

    const first = sync.syncNow();
    const second = await sync.syncNow(); // rejected while first is in flight
    expect(second).toBe(false);

    resolveFetch({ posts: [], nextCursor: null });
    expect(await first).toBe(true);
    expect(indexer.fetchPostsSince).toHaveBeenCalledTimes(1);
  });
});
