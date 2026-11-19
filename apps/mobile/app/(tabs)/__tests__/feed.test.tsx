/**
 * #1851 — infinite scroll + pull-to-refresh on the mobile feed.
 */
import React from "react";
import { FlatList, RefreshControl } from "react-native";
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import type { UseFeedReturn } from "../../../hooks/useFeed";

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}));

jest.mock("../../../components/PostCard", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    PostCard: ({ post }: { post: { id: string; content: string } }) => <Text>{post.content}</Text>,
  };
});

jest.mock("../../../utils/db", () => ({
  evictStaleCache: jest.fn(() => Promise.resolve()),
}));

jest.mock("../../../utils/analytics", () => ({
  trackPostViewed: jest.fn(),
}));

const mockLoadMore = jest.fn();
const mockRefresh = jest.fn();
let mockFeed: Partial<UseFeedReturn> = {};

jest.mock("../../../hooks/useFeed", () => ({
  useFeed: () => ({
    posts: [],
    loading: false,
    refreshing: false,
    loadingMore: false,
    error: null,
    loadMoreError: null,
    hasMore: true,
    loadMore: mockLoadMore,
    refresh: mockRefresh,
    ...mockFeed,
  }),
}));

/* eslint-disable @typescript-eslint/no-var-requires */
const FeedScreen = require("../feed").default as React.ComponentType;
/* eslint-enable @typescript-eslint/no-var-requires */

const posts = Array.from({ length: 10 }, (_, i) => ({
  id: String(i + 1),
  author: "GABC",
  username: "user",
  content: `post ${i + 1}`,
  tip_total: 0,
  timestamp: i + 1,
  like_count: 0,
  has_liked: false,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockFeed = { posts };
});

describe("Feed screen (#1851)", () => {
  it("fetches the next page when the end of the list is reached", () => {
    render(<FeedScreen />);

    act(() => {
      screen.UNSAFE_getByType(FlatList).props.onEndReached({ distanceFromEnd: 0 });
    });
    expect(mockLoadMore).toHaveBeenCalledTimes(1);
  });

  it("does not request more posts at the end of the feed", () => {
    mockFeed = { posts, hasMore: false };
    render(<FeedScreen />);

    act(() => {
      screen.UNSAFE_getByType(FlatList).props.onEndReached({ distanceFromEnd: 0 });
    });
    expect(mockLoadMore).not.toHaveBeenCalled();
    expect(screen.getByTestId("feed-end")).toBeTruthy();
    expect(screen.getByText("You are all caught up")).toBeTruthy();
  });

  it("does not request more posts while a page is loading", () => {
    mockFeed = { posts, loadingMore: true };
    render(<FeedScreen />);

    act(() => {
      screen.UNSAFE_getByType(FlatList).props.onEndReached({ distanceFromEnd: 0 });
    });
    expect(mockLoadMore).not.toHaveBeenCalled();
  });

  it("shows a spinner at the bottom while the next page loads", () => {
    mockFeed = { posts, loadingMore: true };
    render(<FeedScreen />);

    expect(screen.getByTestId("feed-loading-more")).toBeTruthy();
    expect(screen.queryByTestId("feed-end")).toBeNull();
  });

  it("does not claim the feed is finished while more pages exist", () => {
    render(<FeedScreen />);
    expect(screen.queryByTestId("feed-end")).toBeNull();
    expect(screen.queryByTestId("feed-loading-more")).toBeNull();
  });

  it("offers a retry when the next page fails to load", () => {
    mockFeed = { posts, loadMoreError: "Could not load more posts." };
    render(<FeedScreen />);

    fireEvent.press(screen.getByRole("button", { name: "Retry loading more posts" }));
    expect(mockLoadMore).toHaveBeenCalledTimes(1);
  });

  it("reloads the first page on pull-to-refresh", () => {
    mockFeed = { posts, refreshing: true };
    render(<FeedScreen />);

    const refreshControl = screen.UNSAFE_getByType(RefreshControl);
    expect(refreshControl.props.refreshing).toBe(true);
    act(() => {
      refreshControl.props.onRefresh();
    });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the pull-to-refresh spinner off while paginating", () => {
    mockFeed = { posts, loadingMore: true };
    render(<FeedScreen />);

    expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
  });
});
