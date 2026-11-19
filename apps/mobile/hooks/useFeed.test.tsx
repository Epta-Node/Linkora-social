import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useFeed } from "./useFeed";
import { getCachedPosts, initDatabase } from "../utils/db";
import { fetchAndCachePosts, syncPendingPosts } from "../utils/sync";

jest.mock("../utils/db", () => ({
  getCachedPosts: jest.fn(),
  initDatabase: jest.fn(),
  evictStaleCache: jest.fn(),
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

const page = (start: number, size = 10) =>
  Array.from({ length: size }, (_, index) => post(String(start + index)));

/**
 * Fake indexer + SQLite cache: every fetched page is appended to the cache and
 * getCachedPosts returns a window of it, like the real reconcile/read cycle.
 */
function fakeBackend(pages: Array<ReturnType<typeof page> | Error>) {
  const cache: ReturnType<typeof page> = [];
  let call = 0;
  mockedFetchAndCachePosts.mockImplementation(async (_limit, offset) => {
    const next = pages[call++];
    if (next === undefined) return [];
    if (next instanceof Error) throw next;
    cache.splice(offset, next.length, ...next);
    return next;
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

    let resolvePage: (posts: ReturnType<typeof page>) => void = () => undefined;
    mockedFetchAndCachePosts.mockImplementationOnce(
      () => new Promise((resolve) => (resolvePage = resolve))
    );

    act(() => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loadingMore).toBe(true));
    expect(result.current.refreshing).toBe(false);

    await act(async () => {
      resolvePage(page(11));
    });
    await waitFor(() => expect(result.current.loadingMore).toBe(false));
  });

  it("ignores loadMore while a page is already loading", async () => {
    fakeBackend([page(1)]);
    const { result } = renderHook(() => useFeed());
    await waitFor(() => expect(result.current.posts).toHaveLength(10));

    let resolvePage: (posts: ReturnType<typeof page>) => void = () => undefined;
    mockedFetchAndCachePosts.mockImplementationOnce(
      () => new Promise((resolve) => (resolvePage = resolve))
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
      resolvePage(page(11));
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
});
