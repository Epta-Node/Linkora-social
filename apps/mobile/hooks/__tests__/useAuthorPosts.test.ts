/**
 * #1595 — the profile screen queries the indexer per author instead of loading
 * the whole feed and filtering it client-side.
 */
import { act, renderHook, waitFor } from "@testing-library/react-native";

jest.mock("../../utils/sync", () => ({
  AUTHOR_POSTS_PAGE_SIZE: 2,
  fetchAuthorPosts: jest.fn(),
}));

import { fetchAuthorPosts } from "../../utils/sync";
import { useAuthorPosts } from "../useAuthorPosts";

const mockedFetchAuthorPosts = fetchAuthorPosts as jest.Mock;
const AUTHOR = "GAUTHOR";

function makePost(id: string) {
  return {
    id,
    author: AUTHOR,
    username: "alice",
    content: `post ${id}`,
    tip_total: 0,
    timestamp: 1_700_000_000,
    like_count: 0,
    has_liked: false,
  };
}

describe("useAuthorPosts (#1595)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("loads the first page for the given author", async () => {
    mockedFetchAuthorPosts.mockResolvedValue([makePost("1"), makePost("2")]);

    const { result } = renderHook(() => useAuthorPosts(AUTHOR));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockedFetchAuthorPosts).toHaveBeenCalledWith(AUTHOR, 2, 0);
    expect(result.current.posts.map((p) => p.id)).toEqual(["1", "2"]);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("does not query the indexer without an author", async () => {
    const { result } = renderHook(() => useAuthorPosts(undefined));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockedFetchAuthorPosts).not.toHaveBeenCalled();
    expect(result.current.posts).toEqual([]);
  });

  it("appends the next page on loadMore without duplicating posts", async () => {
    mockedFetchAuthorPosts
      .mockResolvedValueOnce([makePost("1"), makePost("2")])
      .mockResolvedValueOnce([makePost("2"), makePost("3")]);

    const { result } = renderHook(() => useAuthorPosts(AUTHOR));
    await waitFor(() => expect(result.current.posts).toHaveLength(2));

    await act(async () => {
      result.current.loadMore();
    });

    await waitFor(() => expect(result.current.posts).toHaveLength(3));
    expect(mockedFetchAuthorPosts).toHaveBeenLastCalledWith(AUTHOR, 2, 2);
    expect(result.current.posts.map((p) => p.id)).toEqual(["1", "2", "3"]);
  });

  it("stops paging once a short page arrives", async () => {
    mockedFetchAuthorPosts.mockResolvedValue([makePost("1")]);

    const { result } = renderHook(() => useAuthorPosts(AUTHOR));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.hasMore).toBe(false);
    await act(async () => {
      result.current.loadMore();
    });
    expect(mockedFetchAuthorPosts).toHaveBeenCalledTimes(1);
  });

  it("refresh replaces the list from offset 0", async () => {
    mockedFetchAuthorPosts
      .mockResolvedValueOnce([makePost("1"), makePost("2")])
      .mockResolvedValueOnce([makePost("9")]);

    const { result } = renderHook(() => useAuthorPosts(AUTHOR));
    await waitFor(() => expect(result.current.posts).toHaveLength(2));

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.posts.map((p) => p.id)).toEqual(["9"]));
    expect(mockedFetchAuthorPosts).toHaveBeenLastCalledWith(AUTHOR, 2, 0);
  });

  it("surfaces an error instead of leaving the screen loading forever", async () => {
    mockedFetchAuthorPosts.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useAuthorPosts(AUTHOR));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.loading).toBe(false);
    expect(result.current.posts).toEqual([]);
  });

  it("resets and reloads when the author changes", async () => {
    mockedFetchAuthorPosts.mockResolvedValue([makePost("1")]);

    const { result, rerender } = renderHook(
      ({ author }: { author: string }) => useAuthorPosts(author),
      {
        initialProps: { author: "GONE" },
      }
    );
    await waitFor(() => expect(result.current.posts).toHaveLength(1));

    mockedFetchAuthorPosts.mockResolvedValue([makePost("2")]);
    rerender({ author: "GTWO" });

    await waitFor(() => expect(mockedFetchAuthorPosts).toHaveBeenLastCalledWith("GTWO", 2, 0));
    await waitFor(() => expect(result.current.posts.map((p) => p.id)).toEqual(["2"]));
  });

  it("does not let a slow response from the previous author land in the new one", async () => {
    let resolveFirst: ((posts: unknown[]) => void) | undefined;
    mockedFetchAuthorPosts
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockResolvedValueOnce([makePost("2")]);

    const { result, rerender } = renderHook(
      ({ author }: { author: string }) => useAuthorPosts(author),
      {
        initialProps: { author: "GONE" },
      }
    );

    // Switch authors while the first request is still in flight.
    rerender({ author: "GTWO" });
    await waitFor(() => expect(result.current.posts.map((p) => p.id)).toEqual(["2"]));

    // The stale response arrives last and must be dropped.
    await act(async () => {
      resolveFirst?.([makePost("1")]);
    });

    expect(result.current.posts.map((p) => p.id)).toEqual(["2"]);
    expect(result.current.loading).toBe(false);
  });
});
