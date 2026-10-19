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

const page = (start: number) =>
  Array.from({ length: 10 }, (_, index) => post(String(start + index)));

describe("useFeed", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedInitDatabase.mockResolvedValue(undefined);
    mockedSyncPendingPosts.mockResolvedValue(undefined);
    mockedGetCachedPosts.mockResolvedValue([post("1"), post("2")]);
  });

  it("retains the last successful cursor when loading the next page fails", async () => {
    mockedFetchAndCachePosts
      .mockResolvedValueOnce(page(1))
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(page(11));
    mockedGetCachedPosts
      .mockResolvedValueOnce(page(1))
      .mockResolvedValueOnce(page(1))
      .mockResolvedValueOnce([...page(1), ...page(11)]);

    const { result } = renderHook(() => useFeed());

    await waitFor(() => expect(mockedFetchAndCachePosts).toHaveBeenCalledWith(10, 0));
    await waitFor(() => expect(mockedSyncPendingPosts).toHaveBeenCalled());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.loadMore();
    });
    await waitFor(() => expect(mockedFetchAndCachePosts).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      result.current.refresh();
    });
    await waitFor(() => expect(mockedFetchAndCachePosts).toHaveBeenCalledTimes(3));
    expect(mockedFetchAndCachePosts).toHaveBeenNthCalledWith(2, 10, 20);
    expect(mockedFetchAndCachePosts).toHaveBeenNthCalledWith(3, 10, 0);
  });

  it("correctly handles cache-then-network pagination without skips or duplicates", async () => {
    // Simulate cache load first, then network sync
    mockedGetCachedPosts
      .mockResolvedValueOnce(page(1)) // Initial cache load
      .mockResolvedValueOnce(page(1)) // After network sync (reloads from cache)
      .mockResolvedValueOnce([...page(1), ...page(11)]) // After second page load
      .mockResolvedValueOnce([...page(1), ...page(11)]) // After second network sync
      .mockResolvedValueOnce([...page(1), ...page(11), ...page(21)]) // After third page load
      .mockResolvedValueOnce([...page(1), ...page(11), ...page(21)]); // After third network sync

    mockedFetchAndCachePosts
      .mockResolvedValueOnce(page(1)) // First network sync
      .mockResolvedValueOnce(page(11)) // Second network sync (loadMore)
      .mockResolvedValueOnce(page(21)); // Third network sync (loadMore)

    const { result } = renderHook(() => useFeed());

    // Wait for initial cache load and network sync
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(mockedFetchAndCachePosts).toHaveBeenCalledTimes(1));
    const initialLength = result.current.posts.length;
    expect(initialLength).toBeGreaterThan(0);

    // Load more pages
    await act(async () => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(mockedFetchAndCachePosts).toHaveBeenCalledTimes(2));
    const secondLength = result.current.posts.length;
    expect(secondLength).toBeGreaterThan(initialLength);

    // Try to load more (may or may not trigger depending on hasMore)
    await act(async () => {
      result.current.loadMore();
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Verify no duplicates and correct pagination
    const postIds = result.current.posts.map((p) => p.id);
    const uniqueIds = new Set(postIds);
    expect(uniqueIds.size).toBe(postIds.length); // No duplicates
    // Verify posts are in ascending order
    for (let i = 1; i < postIds.length; i++) {
      expect(Number(postIds[i])).toBeGreaterThan(Number(postIds[i - 1]));
    }
  });
});
