/**
 * Post detail screen (#1544).
 *
 * The screen used to resolve its content from SQLite alone, so any post reached
 * by a deep link, share or notification target that was not already in the local
 * cache rendered "not found". These tests cover the cache-miss fallback, the
 * distinction between a missing post and a network failure, and the retry
 * action bound to the network fetch.
 */

import React from "react";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react-native";

const mockGetFeedPost = jest.fn();
const mockRetryPostFetch = jest.fn();

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "77" }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  Stack: { Screen: () => null },
}));

jest.mock("../../hooks/useFeed", () => ({
  getFeedPost: (...args: unknown[]) => mockGetFeedPost(...args),
  retryPostFetch: (...args: unknown[]) => mockRetryPostFetch(...args),
}));

jest.mock("../../hooks/useDeletePost", () => ({
  useDeletePost: () => ({ deleting: false, deletePost: jest.fn() }),
}));

jest.mock("../../hooks/useWallet", () => ({
  useWallet: () => ({ address: "GSOMEONEELSE" }),
}));

jest.mock("../../context/ToastContext", () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn() }));

import PostDetailScreen from "./[id]";

const deepPost = {
  id: "77",
  author: "GAUTHOR77DEEP",
  username: "deepuser",
  content: "deep linked body",
  tip_total: 3,
  timestamp: Math.floor(Date.now() / 1000) - 7200,
  like_count: 4,
  has_liked: false,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("PostDetailScreen — cache-miss fallback", () => {
  it("renders full content for a post that is not in the local cache", async () => {
    // The screen's resolver already falls back to the indexer; assert the
    // screen renders whatever it returns, with no "not found" state in between.
    mockGetFeedPost.mockResolvedValue(deepPost);

    render(<PostDetailScreen />);

    expect(await screen.findByText("deep linked body")).toBeTruthy();
    expect(mockGetFeedPost).toHaveBeenCalledWith("77");
    expect(screen.queryByTestId("post-detail-status")).toBeNull();
  });

  it("shows a loading indicator before the post resolves", () => {
    let resolve: (p: unknown) => void = () => {};
    mockGetFeedPost.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      })
    );

    render(<PostDetailScreen />);

    expect(screen.getByTestId("post-detail-loading")).toBeTruthy();

    act(() => {
      resolve(deepPost);
    });
  });

  it("distinguishes a genuinely missing post from a network error", async () => {
    mockGetFeedPost.mockResolvedValue(null);
    const { unmount } = render(<PostDetailScreen />);

    await waitFor(() => expect(screen.getByTestId("post-detail-status")).toBeTruthy());
    expect(screen.getByText(/Post not found/)).toBeTruthy();
    expect(screen.queryByText(/Couldn't reach the network/)).toBeNull();
    unmount();

    mockGetFeedPost.mockRejectedValue(new Error("offline"));
    render(<PostDetailScreen />);

    await waitFor(() => expect(screen.getByTestId("post-detail-status")).toBeTruthy());
    expect(screen.getByText(/Couldn't reach the network/)).toBeTruthy();
    expect(screen.queryByText(/Post not found/)).toBeNull();
  });

  it("offers a retry action bound to the network fetch", async () => {
    mockGetFeedPost.mockResolvedValue(null);
    mockRetryPostFetch.mockResolvedValue(deepPost);

    render(<PostDetailScreen />);

    await waitFor(() => expect(screen.getByTestId("post-detail-status")).toBeTruthy());
    expect(mockRetryPostFetch).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText("Retry loading post"));

    await waitFor(() => expect(screen.getByText("deep linked body")).toBeTruthy());
    expect(mockRetryPostFetch).toHaveBeenCalledWith("77");
  });

  it("keeps showing a network error when the retry also fails", async () => {
    mockGetFeedPost.mockResolvedValue(null);
    mockRetryPostFetch.mockRejectedValue(new Error("still offline"));

    render(<PostDetailScreen />);

    await waitFor(() => expect(screen.getByTestId("post-detail-status")).toBeTruthy());
    fireEvent.press(screen.getByLabelText("Retry loading post"));

    await waitFor(() => expect(mockRetryPostFetch).toHaveBeenCalled());
    expect(screen.getByText(/Couldn't reach the network/)).toBeTruthy();
  });
});
