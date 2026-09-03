import { createFakeDb as mockCreateFakeDb } from "../../jest.sqlite-fake";

let mockFakeDb: ReturnType<typeof mockCreateFakeDb>;

jest.mock("expo-sqlite", () => ({
  openDatabaseSync: () => {
    // db.ts opens the database once at module load, so capture that single
    // instance for assertions on call counts.
    mockFakeDb = mockCreateFakeDb();
    return mockFakeDb;
  },
}));

import {
  addOutboxDmMessage,
  addOptimisticPost,
  getCachedPostsByIds,
  getDmLastRead,
  getDmMessages,
  getDmSyncCursor,
  markDmMessageFailed,
  mergeDmDeltas,
  reconcilePosts,
  setDmLastRead,
  setDmSyncCursor,
} from "../db";
import { Post } from "../../components/PostCard";

describe("DM delta merge", () => {
  it("upserts a relay-confirmed message exactly once even if merged twice, so reconnect never duplicates it", async () => {
    const conversationId = "delta-dedup";
    const incoming = [
      {
        id: "relay-1",
        sender: "A",
        recipient: "B",
        content: "hello",
        ciphertextHash: "hash-1",
        timestamp: 100,
      },
    ];

    await mergeDmDeltas(conversationId, incoming);
    await mergeDmDeltas(conversationId, incoming); // simulate an overlapping/retried reconciliation pass

    const messages = await getDmMessages(conversationId);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: "relay-1", syncStatus: "synced" });
  });

  it("removes the matching pending outbox row once its relay-confirmed counterpart arrives", async () => {
    const conversationId = "delta-outbox-match";
    const outbox = await addOutboxDmMessage(conversationId, "A", "B", "hi there", "shared-hash");

    await mergeDmDeltas(conversationId, [
      {
        id: "relay-2",
        sender: "A",
        recipient: "B",
        content: "hi there",
        ciphertextHash: "shared-hash",
        timestamp: 200,
      },
    ]);

    const messages = await getDmMessages(conversationId);
    expect(messages).toHaveLength(1);
    expect(messages.find((m) => m.id === outbox.id)).toBeUndefined();
    expect(messages.find((m) => m.id === "relay-2")).toMatchObject({ syncStatus: "synced" });
  });

  it("leaves an unrelated failed outbox message alone when a different message is confirmed", async () => {
    const conversationId = "delta-outbox-unrelated";
    await markDmMessageFailed(
      (await addOutboxDmMessage(conversationId, "A", "B", "oops", "hash-a")).id,
      "rejected"
    );

    await mergeDmDeltas(conversationId, [
      {
        id: "relay-3",
        sender: "A",
        recipient: "B",
        content: "other",
        ciphertextHash: "hash-b",
        timestamp: 300,
      },
    ]);

    const messages = await getDmMessages(conversationId);
    expect(messages).toHaveLength(2);
    expect(messages.find((m) => m.ciphertextHash === "hash-a")).toMatchObject({
      syncStatus: "failed",
    });
  });

  it("reports the newest timestamp in the merged batch for advancing the sync cursor", async () => {
    const result = await mergeDmDeltas("delta-newest-ts", [
      { id: "r1", sender: "A", recipient: "B", content: "a", ciphertextHash: "h1", timestamp: 50 },
      { id: "r2", sender: "A", recipient: "B", content: "b", ciphertextHash: "h2", timestamp: 400 },
      { id: "r3", sender: "A", recipient: "B", content: "c", ciphertextHash: "h3", timestamp: 250 },
    ]);
    expect(result.newestTimestamp).toBe(400);
  });
});

describe("DM sync cursor and last-read watermark", () => {
  it("defaults to 0 for a conversation that has never synced", async () => {
    expect(await getDmSyncCursor("never-synced")).toBe(0);
    expect(await getDmLastRead("never-synced")).toBe(0);
  });

  it("is monotonic: a later call with a smaller cursor never moves it backward", async () => {
    await setDmSyncCursor("mono-1", 500);
    await setDmSyncCursor("mono-1", 100);
    expect(await getDmSyncCursor("mono-1")).toBe(500);
  });

  it("advances last_read independently of the sync cursor", async () => {
    await setDmSyncCursor("mono-2", 700);
    await setDmLastRead("mono-2", 300);
    expect(await getDmSyncCursor("mono-2")).toBe(700);
    expect(await getDmLastRead("mono-2")).toBe(300);
  });
});

describe("outbox failure surfacing", () => {
  it("marks a pending outbox message failed with the relay's error, and it stays out of the synced set", async () => {
    const outbox = await addOutboxDmMessage("convo-2", "A", "B", "will fail", "hash-fail");
    await markDmMessageFailed(outbox.id, "400 invalid recipient");

    const messages = await getDmMessages("convo-2");
    const failed = messages.find((m) => m.id === outbox.id);
    expect(failed).toMatchObject({ syncStatus: "failed", errorMessage: "400 invalid recipient" });
  });
});

function makePost(id: string, overrides: Partial<Post> = {}): Post {
  return {
    id,
    author: `author-${id}`,
    username: `user-${id}`,
    content: `content-${id}`,
    tip_total: 0,
    timestamp: 1000,
    like_count: 0,
    has_liked: false,
    ...overrides,
  };
}

describe("reconcilePosts batching", () => {
  it("issues a constant number of SQLite statements no matter how large the feed is", async () => {
    const small = Array.from({ length: 5 }, (_, i) => makePost(`bounded-small-${i}`));
    mockFakeDb.runAsync.mockClear();
    await reconcilePosts(small);
    const smallCallCount = mockFakeDb.runAsync.mock.calls.length;

    const large = Array.from({ length: 50 }, (_, i) => makePost(`bounded-large-${i}`));
    mockFakeDb.runAsync.mockClear();
    await reconcilePosts(large);
    const largeCallCount = mockFakeDb.runAsync.mock.calls.length;

    // A per-post implementation would issue 2 * N statements (100 for the 50-post
    // feed); batching keeps this fixed regardless of feed size.
    expect(largeCallCount).toBe(smallCallCount);
    expect(largeCallCount).toBeLessThanOrEqual(3);
  });

  it("upserts every post in the feed via a single multi-row insert", async () => {
    const posts = Array.from({ length: 10 }, (_, i) => makePost(`upsert-${i}`));
    await reconcilePosts(posts);

    const cached = await getCachedPostsByIds(posts.map((p) => String(p.id)));
    expect(cached.size).toBe(10);
    for (const post of posts) {
      expect(cached.get(String(post.id))).toMatchObject({
        author: post.author,
        content: post.content,
        sync_status: "synced",
      });
    }
  });

  it("removes an optimistic row once its chain-confirmed counterpart lands, batched across the whole feed", async () => {
    const author = "GAUTHOR-BATCH";
    const content = "hello from chain";
    const localId = await addOptimisticPost(author, content, "local_user");

    await reconcilePosts([
      makePost("chain-confirmed-1", { author, content }),
      makePost("chain-confirmed-2"),
    ]);

    const cached = await getCachedPostsByIds([localId, "chain-confirmed-1", "chain-confirmed-2"]);
    expect(cached.has(localId)).toBe(false);
    expect(cached.get("chain-confirmed-1")).toMatchObject({ sync_status: "synced" });
    expect(cached.get("chain-confirmed-2")).toMatchObject({ sync_status: "synced" });
  });

  it("evicts stale synced rows that fall out of the remote set on the next reconcile pass", async () => {
    await reconcilePosts([makePost("stale-1"), makePost("stale-2")]);
    await reconcilePosts([makePost("stale-2")]);

    const cached = await getCachedPostsByIds(["stale-1", "stale-2"]);
    expect(cached.has("stale-1")).toBe(false);
    expect(cached.has("stale-2")).toBe(true);
  });

  it("does nothing for an empty feed", async () => {
    mockFakeDb.runAsync.mockClear();
    await reconcilePosts([]);
    expect(mockFakeDb.runAsync).not.toHaveBeenCalled();
  });
});

describe("getCachedPostsByIds", () => {
  it("returns an empty map without querying the database when given no ids", async () => {
    mockFakeDb.getAllAsync.mockClear();
    const result = await getCachedPostsByIds([]);
    expect(result.size).toBe(0);
    expect(mockFakeDb.getAllAsync).not.toHaveBeenCalled();
  });

  it("issues a single query for any number of ids and omits ids with no cached row", async () => {
    await reconcilePosts([makePost("batch-lookup-1"), makePost("batch-lookup-2")]);

    mockFakeDb.getAllAsync.mockClear();
    const result = await getCachedPostsByIds(["batch-lookup-1", "batch-lookup-2", "missing-id"]);

    expect(mockFakeDb.getAllAsync).toHaveBeenCalledTimes(1);
    expect(result.size).toBe(2);
    expect(result.has("missing-id")).toBe(false);
    expect(result.get("batch-lookup-1")).toMatchObject({ id: "batch-lookup-1" });
  });
});
