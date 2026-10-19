/**
 * Indexer → cache boundary (#1543) and deep-link resolution (#1544).
 *
 * Kept separate from `sync.test.ts` because the workspace `linkora-sdk` package
 * is not built in this checkout; these code paths never touch it, so it is
 * stubbed out rather than depending on a build artifact.
 */

import { getCachedPostById, getCachedPostsByIds, reconcilePosts } from "../db";
import {
  AUTHOR_POSTS_PAGE_SIZE,
  fetchAndCachePosts,
  fetchAuthorPosts,
  fetchPostById,
  indexerPostTimestamp,
  ledgerToUnixSeconds,
  normalizeIndexerPost,
  resolvePostWithFallback,
} from "../sync";

jest.mock("linkora-sdk", () => ({ LinkoraClient: jest.fn() }), { virtual: true });

jest.mock("../db", () => ({
  getCachedPostById: jest.fn(),
  getCachedPostsByIds: jest.fn(),
  reconcilePosts: jest.fn(),
}));

const mockedGetCachedPostById = getCachedPostById as jest.Mock;
const mockedGetCachedPostsByIds = getCachedPostsByIds as jest.Mock;
const mockedReconcilePosts = reconcilePosts as jest.Mock;

const originalFetch = global.fetch;

beforeAll(() => {
  process.env.EXPO_PUBLIC_INDEXER_URL = "https://indexer.example.com";
});

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("ledgerToUnixSeconds (#1543)", () => {
  // Stellar closes a ledger every ~5s; ledger 1 is the genesis ledger, opened at
  // network genesis: 2015-09-01T00:00:00Z = 1441065600.
  const GENESIS_UNIX_SECONDS = 1_441_065_600;

  it("maps the genesis ledger to network genesis", () => {
    expect(ledgerToUnixSeconds(1)).toBe(GENESIS_UNIX_SECONDS);
  });

  it("advances exactly one ledger-close interval per sequence number", () => {
    expect(ledgerToUnixSeconds(2)).toBe(GENESIS_UNIX_SECONDS + 5);
    expect(ledgerToUnixSeconds(1001)).toBe(GENESIS_UNIX_SECONDS + 1000 * 5);
  });

  it("produces a plausible seconds-since-epoch value for a real mainnet ledger", () => {
    // A mainnet ledger is around 5x10^7 while "now" is around 1.8x10^9. Storing
    // the raw sequence is what made every post render as ~20000 days old and
    // made the whole offline cache look older than the 7-day eviction cutoff.
    const MAINNET_LEDGER = 52_000_000;
    const seconds = ledgerToUnixSeconds(MAINNET_LEDGER);

    expect(seconds).toBe(GENESIS_UNIX_SECONDS + (MAINNET_LEDGER - 1) * 5);
    expect(seconds).toBeGreaterThan(1_600_000_000);
    expect(seconds).toBeLessThan(2_000_000_000);
    expect(seconds).toBeGreaterThan(MAINNET_LEDGER * 10);
  });
});

describe("normalizeIndexerPost (#1543)", () => {
  it("renames created_ledger to createdLedger at the type boundary", () => {
    const normalized = normalizeIndexerPost({
      id: 42,
      author: "GAUTHOR",
      content: "hi",
      username: "alice",
      tip_total: "10",
      created_ledger: 52_000_000,
      like_count: "3",
      has_liked: true,
    });

    expect(normalized).toEqual({
      id: "42",
      author: "GAUTHOR",
      content: "hi",
      username: "alice",
      tipTotal: 10,
      createdLedger: 52_000_000,
      likeCount: 3,
      hasLiked: true,
    });
  });

  it("treats a missing or non-numeric ledger as null rather than 0", () => {
    expect(normalizeIndexerPost({ id: "1", author: "G" }).createdLedger).toBeNull();
    expect(
      normalizeIndexerPost({ id: "1", author: "G", created_ledger: "nope" }).createdLedger
    ).toBeNull();
  });

  it("falls back to the supplied clock reading when there is no ledger", () => {
    const noLedger = normalizeIndexerPost({ id: "1", author: "G" });
    expect(indexerPostTimestamp(noLedger, 1_700_000_000)).toBe(1_700_000_000);

    const withLedger = normalizeIndexerPost({ id: "1", author: "G", created_ledger: 10_000_000 });
    expect(indexerPostTimestamp(withLedger, 1_700_000_000)).toBe(ledgerToUnixSeconds(10_000_000));
  });
});

describe("fetchAndCachePosts timestamps (#1543)", () => {
  it("converts created_ledger to seconds instead of storing the sequence number", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        posts: [
          {
            id: "1",
            author: "GAUTHOR1",
            content: "hello",
            username: "alice",
            tip_total: 0,
            created_ledger: 52_000_000,
            like_count: 0,
          },
        ],
      }),
    }) as unknown as typeof fetch;
    mockedGetCachedPostsByIds.mockResolvedValue(new Map());

    const [post] = await fetchAndCachePosts(1, 0);

    expect(post.timestamp).toBe(ledgerToUnixSeconds(52_000_000));
    expect(post.timestamp).not.toBe(52_000_000);
    // A plausible age in days, not the ~20115d the raw sequence produced.
    const ageSeconds = Math.floor(Date.now() / 1000) - post.timestamp;
    expect(ageSeconds).toBeGreaterThan(0);
    expect(ageSeconds).toBeLessThan(86400 * 365 * 5);
    expect(Math.floor(ageSeconds / 86400)).toBeLessThan(3650);
  });

  it("falls back to the current time when the indexer omits the ledger", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ posts: [{ id: "1", author: "GAUTHOR1" }] }),
    }) as unknown as typeof fetch;
    mockedGetCachedPostsByIds.mockResolvedValue(new Map());

    const before = Math.floor(Date.now() / 1000);
    const [post] = await fetchAndCachePosts(1, 0);

    expect(post.timestamp).toBeGreaterThanOrEqual(before);
  });

  it("still batches the cache lookup into a single call", async () => {
    const indexerPosts = Array.from({ length: 20 }, (_, i) => ({
      id: i,
      author: `GAUTHOR${i}`,
      content: `content-${i}`,
      username: `user-${i}`,
      tip_total: 0,
      created_ledger: 1000,
      like_count: 0,
    }));
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ posts: indexerPosts }),
    }) as unknown as typeof fetch;
    mockedGetCachedPostsByIds.mockResolvedValue(new Map());

    await fetchAndCachePosts(20, 0);

    expect(mockedGetCachedPostsByIds).toHaveBeenCalledTimes(1);
    expect(mockedGetCachedPostsByIds).toHaveBeenCalledWith(indexerPosts.map((p) => String(p.id)));
  });
});

describe("resolvePostWithFallback — deep-link cache miss (#1544)", () => {
  const indexerPost = {
    id: "77",
    author: "GAUTHOR77DEEP",
    content: "deep linked body",
    username: "deepuser",
    tip_total: 3,
    created_ledger: 52_000_000,
    like_count: 4,
    has_liked: false,
  };

  it("serves a cache hit without touching the network", async () => {
    mockedGetCachedPostById.mockResolvedValue({
      id: "77",
      author: "GAUTHOR77DEEP",
      username: "deepuser",
      content: "cached body",
      tip_total: 3,
      timestamp: 1_700_000_000,
      like_count: 4,
    });
    global.fetch = jest.fn() as unknown as typeof fetch;

    const post = await resolvePostWithFallback("77");

    expect(post?.content).toBe("cached body");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fetches from the indexer on a cache miss and caches the result", async () => {
    mockedGetCachedPostById.mockResolvedValue(null);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ post: indexerPost }),
    }) as unknown as typeof fetch;

    const post = await resolvePostWithFallback("77");

    expect(post).toMatchObject({
      id: "77",
      content: "deep linked body",
      username: "deepuser",
      tip_total: 3,
      like_count: 4,
    });
    expect(post?.timestamp).toBe(ledgerToUnixSeconds(52_000_000));
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("/api/posts/77"));
    // Written back so the next open is served offline, without evicting the feed.
    expect(mockedReconcilePosts).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "77" })],
      false
    );
  });

  it("accepts a bare post object as well as a { post } envelope", async () => {
    mockedGetCachedPostById.mockResolvedValue(null);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(indexerPost),
    }) as unknown as typeof fetch;

    const post = await resolvePostWithFallback("77");

    expect(post?.content).toBe("deep linked body");
  });

  it("returns null when the indexer reports the post does not exist", async () => {
    mockedGetCachedPostById.mockResolvedValue(null);
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: jest.fn().mockResolvedValue({}),
    }) as unknown as typeof fetch;

    await expect(resolvePostWithFallback("77")).resolves.toBeNull();
    expect(mockedReconcilePosts).not.toHaveBeenCalled();
  });

  it("throws on a transport failure so the screen can distinguish it from a missing post", async () => {
    mockedGetCachedPostById.mockResolvedValue(null);
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: jest.fn().mockResolvedValue({}),
    }) as unknown as typeof fetch;

    await expect(resolvePostWithFallback("77")).rejects.toThrow(/503/);
  });

  it("fetchPostById (the retry action) always hits the network", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ post: indexerPost }),
    }) as unknown as typeof fetch;

    const post = await fetchPostById("77");

    expect(post?.content).toBe("deep linked body");
    expect(mockedGetCachedPostById).not.toHaveBeenCalled();
  });
});

describe("fetchAuthorPosts — author-scoped indexer query (#1595)", () => {
  it("queries only the author's posts, with explicit pagination", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        posts: [{ id: "1", author: "GAUTHOR9", content: "mine", created_ledger: 1000 }],
      }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    mockedGetCachedPostsByIds.mockResolvedValue(new Map());

    await fetchAuthorPosts("GAUTHOR9", 2, 4);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://indexer.example.com/api/posts?author=GAUTHOR9&limit=2&offset=4"
    );
  });

  it("never evicts the main feed cache while listing one author", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        posts: [{ id: "1", author: "GAUTHOR9", content: "mine", created_ledger: 1000 }],
      }),
    }) as unknown as typeof fetch;
    mockedGetCachedPostsByIds.mockResolvedValue(new Map());

    const posts = await fetchAuthorPosts("GAUTHOR9");

    expect(posts).toHaveLength(1);
    // evictStale must be false: an author page must not wipe the feed window.
    expect(mockedReconcilePosts).toHaveBeenCalledTimes(1);
    expect(mockedReconcilePosts.mock.calls[0][1]).toBe(false);
  });

  it("URL-encodes the author address", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ posts: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    mockedGetCachedPostsByIds.mockResolvedValue(new Map());

    await fetchAuthorPosts("G/WEIRD+ADDRESS", AUTHOR_POSTS_PAGE_SIZE, 0);

    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://indexer.example.com/api/posts?author=${encodeURIComponent(
        "G/WEIRD+ADDRESS"
      )}&limit=${AUTHOR_POSTS_PAGE_SIZE}&offset=0`
    );
  });

  it("does not hit the network without an author", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(fetchAuthorPosts("")).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws on a transport failure so the screen can show an error state", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: jest.fn().mockResolvedValue({}),
    }) as unknown as typeof fetch;

    await expect(fetchAuthorPosts("GAUTHOR9")).rejects.toThrow(/author posts/i);
    expect(mockedReconcilePosts).not.toHaveBeenCalled();
  });
});
