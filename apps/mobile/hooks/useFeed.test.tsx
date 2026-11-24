import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useFeed } from "./useFeed";
import { getCachedPosts, getFeedLastSyncedAt, initDatabase } from "../utils/db";
import { fetchAndCachePosts, FetchedFeedPage, syncPendingPosts } from "../utils/sync";

jest.mock("../utils/db", () => ({
  getCachedPosts: jest.fn(),
  initDatabase: jest.fn(),
  evictStaleCache: jest.fn(),
  getFeedLastSyncedAt: jest.fn(() => Promise.resolve(null)),
}));

jest.mock("../utils/sync", () => ({
  fetchAndCachePosts: jest.fn(),
  syncPendingPosts: jest.fn(),
  getSyncPendingPostsOptions: jest.fn(() => null),
}));

jest.mock("../context/NetworkContext", () => ({
  useNetworkContext: () => ({
    contractId: "CTEST",
    rpcUrl: "https://rpc.test",
    network: { id: "testnet" },
  }),
}));

const mockedGetCachedPosts = jest.mocked(getCachedPosts);
const mockedGetFeedLastSyncedAt = jest.mocked(getFeedLastSyncedAt);
const mockedInitDatabase = jest.mocked(initDatabase);
const mockedFetchAndCachePosts = jest.mocked(fetchAndCachePosts);
const mockedSyncPendingPosts = jest.mocked(syncPendingPosts);

const post = (id: string) => ({
  id,
  author: "GABC",
  username: "user",
  content: `post ${id}`,
  tip_total: 0,
  timestamp: Number(id),
  like_count: 0,
  has_liked: false,
});

type FeedPost = ReturnType<typeof post>;
type FakePage = FeedPost[] & Partial<Pick<FetchedFeedPage, "nextCursor" | "hasMore">>;

const page = (start: number, size = 10): FeedPost[] =>
  Array.from({ length: size }, (_, index) => post(String(start + index)));

const asPage = (posts: FeedPost[]): FetchedFeedPage =>
  Object.assign([...posts], { nextCursor: null, hasMore: posts.length >= 10 });

/**
 * Fake indexer + SQLite cache: every fetched page is appended to the cache and
 * getCachedPosts returns a window of it, like the real reconcile/read cycle.
 */
function fakeBackend(pages: Array<FakePage | Error>) {
  const cache: FeedPost[] = [];
  let call = 0;
  mockedFetchAndCachePosts.mockImplementation(async (_limit, offset) => {
    const next = pages[call++];
    if (next === undefined) return asPage([]);
    if (next instanceof Error) throw next;
    cache.splice(offset, next.length, ...next);
    const result = asPage(next);
    result.nextCursor = next.nextCursor ?? null;
    result.hasMore = next.hasMore ?? next.length >= 10;
    return result;
  });
  mockedGetCachedPosts.mockImplementation(async (limit, offset) =>
    cache.slice(offset, offset + limit)
  );
  return cache;
}

describe("useFeed", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedInitDatabase.mockResolvedValue(undefined);
    mockedGetFeedLastSyncedAt.mockResolvedValue(null);
    mockedSyncPendingPosts.mockResolvedValue(undefined);
  });

  it("loads the first page from the network", async () => {
    fakeBackend([page(1)]);

    const { result } = renderHook(() => useFeed());

    await waitFor(() => expect(result.current.posts).toHaveLength(10));
    expect(mockedFetchAndCachePosts).toHaveBeenCalledWith(10, 0, false);
    expect(result.current.loading).toBe(false);
    expect(result.current.hasMore).toBe(true);
  });

  it("appends the next page on loadMore without skips or duplicates", async () => {
    fakeBackend([page(1), page(11), page(21)]);

    const { result } = renderHook(() => useFeed());
    await waitFor(() => expect(result.current.posts).toHaveLength(10));

    await act(async () => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.posts).toHaveLength(20));
    expect(mockedFetchAndCachePosts).toHaveBeenLastCalledWith(10, 10, true);

    await act(async () => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.posts).toHaveLength(30));
    expect(mockedFetchAndCachePosts).toHaveBeenLastCalledWith(10, 20, true);

    const ids = result.current.posts.map((p) => Number(p.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it("exposes loadingMore while the next page is in flight", async () => {
    fakeBackend([page(1)]);
    const { result } = renderHook(() => useFeed());
    await waitFor(() => expect(result.current.posts).toHaveLength(10));

    let resolvePage: (posts: FetchedFeedPage) => void = () => undefined;
    mockedFetchAndCachePosts.mockImplementationOnce(
      () => new Promise<FetchedFeedPage>((resolve) => (resolvePage = resolve))
    );

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loadingMore).toBe(true));
    expect(result.current.refreshing).toBe(false);

    await act(async () => {
      resolvePage(asPage(page(11)));
    });
    await waitFor(() => expect(result.current.loadingMore).toBe(false));
  });

  it("ignores loadMore while a page is already loading", async () => {
    fakeBackend([page(1)]);
    const { result } = renderHook(() => useFeed());
    await waitFor(() => expect(result.current.posts).toHaveLength(10));

    let resolvePage: (posts: FetchedFeedPage) => void = () => undefined;
    mockedFetchAndCachePosts.mockImplementationOnce(
      () => new Promise<FetchedFeedPage>((resolve) => (resolvePage = resolve))
    );
    const callsBefore = mockedFetchAndCachePosts.mock.calls.length;

    act(() => {
      result.current.loadMore();
      result.current.loadMore();
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loadingMore).toBe(true));
    act(() => {
      result.current.loadMore();
    });
    expect(mockedFetchAndCachePosts.mock.calls.length).toBe(callsBefore + 1);

    await act(async () => {
      resolvePage(asPage(page(11)));
    });
    await waitFor(() => expect(result.current.loadingMore).toBe(false));
    expect(mockedFetchAndCachePosts.mock.calls.length).toBe(callsBefore + 1);
  });

  it("marks the end of the feed when the indexer returns a short page", async () => {
    fakeBackend([page(1), page(11, 4)]);
    const { result } = renderHook(() => useFeed());
    await waitFor(() => expect(result.current.posts).toHaveLength(10));

    await act(async () => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.hasMore).toBe(false));
    expect(result.current.posts).toHaveLength(14);

    const calls = mockedFetchAndCachePosts.mock.calls.length;
    await act(async () => {
      result.current.loadMore();
    });
    expect(mockedFetchAndCachePosts.mock.calls.length).toBe(calls);
  });

  it("keeps the cursor when loading the next page fails, so a retry asks for the same page", async () => {
    fakeBackend([page(1), new Error("network error"), page(11)]);
    const { result } = renderHook(() => useFeed());
    await waitFor(() => expect(result.current.posts).toHaveLength(10));

    await act(async () => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loadMoreError).not.toBeNull());
    expect(result.current.posts).toHaveLength(10);
    expect(result.current.hasMore).toBe(true);

    await act(async () => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.posts).toHaveLength(20));
    expect(mockedFetchAndCachePosts).toHaveBeenNthCalledWith(2, 10, 10, true);
    expect(mockedFetchAndCachePosts).toHaveBeenNthCalledWith(3, 10, 10, true);
    expect(result.current.loadMoreError).toBeNull();
  });

  it("pull-to-refresh reloads the first page and resets pagination", async () => {
    fakeBackend([page(1), page(11), page(1)]);
    const { result } = renderHook(() => useFeed());
    await waitFor(() => expect(result.current.posts).toHaveLength(10));

    await act(async () => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.posts).toHaveLength(20));

    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(mockedFetchAndCachePosts).toHaveBeenLastCalledWith(10, 0, false);
    expect(result.current.posts).toHaveLength(10);
    expect(result.current.hasMore).toBe(true);
  });

  it("paints cached posts and the sync watermark before the network resolves", async () => {
    const cached = page(1, 3);
    let resolvePage: (posts: FetchedFeedPage) => void = () => undefined;
    mockedGetCachedPosts.mockResolvedValue(cached);
    mockedGetFeedLastSyncedAt.mockResolvedValue(1_700_000_000);
    mockedFetchAndCachePosts.mockImplementationOnce(
      () => new Promise<FetchedFeedPage>((resolve) => (resolvePage = resolve))
    );

    const { result } = renderHook(() => useFeed());

    await waitFor(() => expect(result.current.posts).toHaveLength(3));
    expect(result.current.servedFromCache).toBe(true);
    expect(result.current.lastUpdatedAt).toBe(1_700_000_000);
    expect(result.current.loading).toBe(false);

    await act(async () => {
      resolvePage(asPage(page(1)));
    });
  });

  it("deduplicates overlapping post ids when merging a page into the cache", async () => {
    mockedFetchAndCachePosts.mockResolvedValue(asPage([]));
    mockedGetCachedPosts.mockResolvedValue([post("1"), post("1"), post("2")]);

    const { result } = renderHook(() => useFeed());

    await waitFor(() => expect(result.current.posts).toHaveLength(2));
    expect(new Set(result.current.posts.map((p) => p.id)).size).toBe(2);
  });

  it("uses the indexer's next cursor for the following page", async () => {
    const firstPage = Object.assign(page(1), { nextCursor: "cursor-1", hasMore: true });
    fakeBackend([firstPage, page(11)]);

    const { result } = renderHook(() => useFeed());
    await waitFor(() => expect(result.current.posts).toHaveLength(10));

    await act(async () => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.posts).toHaveLength(20));
    expect(mockedFetchAndCachePosts).toHaveBeenLastCalledWith(10, 10, true, "cursor-1");
  });
});
