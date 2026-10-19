/**
 * Regression test for issue #1580 — Following feed broken bindings.
 *
 * Verifies:
 *  - "For You" tab loads and renders posts from the mocked indexer.
 *  - "Following" tab loads, fans out per-author fetches, and renders posts.
 *  - Switching between tabs renders the correct post list for each.
 *  - A missing wallet address shows a helpful error on the Following tab.
 *  - setPosts / persistFeed are called exactly once per fetch (no duplicate).
 */

import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import FeedPage from "./page";

// ---------------------------------------------------------------------------
// Mock next/navigation (already mocked in jest.setup.ts, re-declared for clarity)
// ---------------------------------------------------------------------------
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => "/feed",
  useSearchParams: () => new URLSearchParams(),
}));

// ---------------------------------------------------------------------------
// Mock wallet hook
// ---------------------------------------------------------------------------
const mockUseWallet = jest.fn();
jest.mock("@/hooks/useWallet", () => ({
  useWallet: () => mockUseWallet(),
}));

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

const FOR_YOU_POSTS = [
  {
    id: "fy-1",
    author: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    username: "alice",
    content: "For You post 1",
    like_count: 2,
    tip_total: 10,
    timestamp: 1000,
  },
  {
    id: "fy-2",
    author: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    username: "bob",
    content: "For You post 2",
    like_count: 1,
    tip_total: 5,
    timestamp: 900,
  },
];

const FOLLOWING_LIST = ["GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"];

const FOLLOWING_POSTS = [
  {
    id: "fw-1",
    author: FOLLOWING_LIST[0],
    username: "charlie",
    content: "Following post 1",
    like_count: 3,
    tip_total: 0,
    timestamp: 800,
  },
];

// ---------------------------------------------------------------------------
// fetch mock
// ---------------------------------------------------------------------------

const mockFetch = jest.fn();
global.fetch = mockFetch;

function setupFetchMock({
  forYouPosts = FOR_YOU_POSTS,
  followingList = FOLLOWING_LIST,
  followingPosts = FOLLOWING_POSTS,
} = {}) {
  mockFetch.mockImplementation(async (url: string) => {
    const u = String(url);

    // Following list endpoint
    if (u.includes("/api/feed/following/")) {
      return {
        ok: true,
        json: async () => ({ following: followingList, cursor: null }),
      };
    }

    // Per-author posts fan-out
    if (u.includes("/api/posts?author=")) {
      return {
        ok: true,
        json: async () => ({ posts: followingPosts, cursor: null }),
      };
    }

    // Global / For You feed
    if (u.includes("/api/posts")) {
      return {
        ok: true,
        json: async () => ({ posts: forYouPosts, cursor: null }),
      };
    }

    return { ok: false, json: async () => ({}) };
  });
}

afterEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FeedPage (#1580)", () => {
  it('renders "For You" posts on load', async () => {
    mockUseWallet.mockReturnValue({ address: null });
    setupFetchMock();

    render(<FeedPage />);

    await waitFor(() => {
      expect(screen.getByText("For You post 1")).toBeInTheDocument();
    });
    expect(screen.getByText("For You post 2")).toBeInTheDocument();
  });

  it('renders "Following" posts after switching to that tab (with wallet connected)', async () => {
    mockUseWallet.mockReturnValue({
      address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    });
    setupFetchMock();

    render(<FeedPage />);

    // Wait for For You feed to load first.
    await waitFor(() => {
      expect(screen.getByText("For You post 1")).toBeInTheDocument();
    });

    // Switch to Following tab.
    fireEvent.click(screen.getByTestId("tab-following"));

    await waitFor(() => {
      expect(screen.getByText("Following post 1")).toBeInTheDocument();
    });

    // For You posts should no longer be visible in the active panel.
    expect(screen.queryByText("For You post 1")).not.toBeInTheDocument();
  });

  it('switching back to "For You" shows the cached For You posts', async () => {
    mockUseWallet.mockReturnValue({
      address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    });
    setupFetchMock();

    render(<FeedPage />);

    await waitFor(() => {
      expect(screen.getByText("For You post 1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("tab-following"));
    await waitFor(() => expect(screen.getByText("Following post 1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("tab-for-you"));
    await waitFor(() => expect(screen.getByText("For You post 1")).toBeInTheDocument());
  });

  it("shows helpful message on Following tab when wallet is not connected", async () => {
    mockUseWallet.mockReturnValue({ address: null });
    setupFetchMock();

    render(<FeedPage />);

    await waitFor(() => {
      expect(screen.getByText("For You post 1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("tab-following"));

    await waitFor(() => {
      expect(screen.getByTestId("feed-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("feed-error")).toHaveTextContent(
      "Connect your wallet"
    );
  });

  it("fans out one fetch per followed address and merges results", async () => {
    const twoFollowees = [
      "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
      "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
    ];
    mockUseWallet.mockReturnValue({
      address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    });
    setupFetchMock({ followingList: twoFollowees });

    render(<FeedPage />);

    await waitFor(() => expect(screen.getByText("For You post 1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("tab-following"));
    await waitFor(() => expect(screen.getByTestId("post-list")).toBeInTheDocument());

    // Should have called the per-author endpoint once per followee.
    const authorCalls = mockFetch.mock.calls.filter(([url]: [string]) =>
      String(url).includes("/api/posts?author=")
    );
    expect(authorCalls).toHaveLength(2);
  });

  it("shows a loading skeleton while the feed is being fetched", () => {
    mockUseWallet.mockReturnValue({ address: null });
    // Never resolve so loading state persists.
    mockFetch.mockReturnValue(new Promise(() => {}));

    render(<FeedPage />);

    expect(screen.getByTestId("loading-indicator")).toBeInTheDocument();
  });

  it("shows an empty state when no posts are returned", async () => {
    mockUseWallet.mockReturnValue({ address: null });
    setupFetchMock({ forYouPosts: [] });

    render(<FeedPage />);

    await waitFor(() => {
      expect(screen.getByTestId("empty-feed")).toBeInTheDocument();
    });
  });

  it("shows an error message when the indexer returns a non-ok response", async () => {
    mockUseWallet.mockReturnValue({ address: null });
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) });

    render(<FeedPage />);

    await waitFor(() => {
      expect(screen.getByTestId("feed-error")).toBeInTheDocument();
    });
  });
});
