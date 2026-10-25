/**
 * @jest-environment jsdom
 *
 * Search results rendering for #1747 (non-blocking results via useTransition)
 * and #1748 (priority / lazy images in the result list).
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SearchPageClient } from "../SearchPageClient";

const mockReplace = jest.fn();
const mockPush = jest.fn();
let mockParams = new URLSearchParams("q=stellar");

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, prefetch: jest.fn() }),
  usePathname: () => "/search",
  useSearchParams: () => mockParams,
}));

// Results land in a transition, which React may render in several time-sliced
// chunks; give slow CI workers more than waitFor's 1s default.
const RESULTS_TIMEOUT = { timeout: 5000 };

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

const makePost = (index: number) => ({
  id: `p${index}`,
  author: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  content: `stellar post ${index}`,
  timestamp: 1_700_000_000 + index,
  imageUrl: `/media/p${index}.png`,
});

beforeEach(() => {
  mockParams = new URLSearchParams("q=stellar");
  mockReplace.mockReset();
  mockPush.mockReset();
  mockFetch.mockReset();
  localStorage.clear();
});

describe("SearchPageClient", () => {
  it("renders fetched results and clears the busy state (#1747)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ posts: [1, 2, 3, 4, 5].map(makePost) }),
    });

    render(<SearchPageClient />);

    const results = screen.getByTestId("search-results");
    expect(results).toHaveAttribute("aria-busy", "true");

    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(5), RESULTS_TIMEOUT);
    expect(results).toHaveAttribute("aria-busy", "false");
    expect(results).not.toHaveAttribute("data-pending");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/search?q=stellar"),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("keeps the search input interactive while results are loading (#1747)", async () => {
    mockFetch.mockReturnValue(new Promise(() => {}));

    render(<SearchPageClient />);

    const input = screen.getByRole("textbox", {
      name: "Search posts, profiles, and pools",
    });
    fireEvent.change(input, { target: { value: "stellar wave" } });

    expect(input).toHaveValue("stellar wave");
    expect(screen.getByTestId("search-results")).toHaveAttribute("aria-busy", "true");
  });

  it("updates sort through a transition-wrapped navigation (#1747)", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ posts: [makePost(1)] }) });

    render(<SearchPageClient />);
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1), RESULTS_TIMEOUT);

    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "recent" } });

    expect(mockReplace).toHaveBeenCalledWith("/search?q=stellar&sort=recent", { scroll: false });
  });

  it("prioritises only the first three result images (#1748)", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ posts: [1, 2, 3, 4, 5].map(makePost) }),
    });

    const { container } = render(<SearchPageClient />);
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(5), RESULTS_TIMEOUT);

    const images = Array.from(container.querySelectorAll("article img"));
    expect(images).toHaveLength(5);
    images.slice(0, 3).forEach((img) => expect(img).toHaveAttribute("fetchpriority", "high"));
    images.slice(3).forEach((img) => expect(img).toHaveAttribute("loading", "lazy"));
    images.forEach((img) => expect(img).toHaveAttribute("sizes"));
  });

  it("shows the request error and drops stale results", async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) });

    render(<SearchPageClient />);

    expect(await screen.findByRole("alert", {}, RESULTS_TIMEOUT)).toHaveTextContent(
      "Search request failed."
    );
    expect(screen.queryAllByRole("article")).toHaveLength(0);
    expect(screen.getByTestId("search-results")).toHaveAttribute("aria-busy", "false");
  });

  it("searches profiles and applies a follower filter from the URL", async () => {
    mockParams = new URLSearchParams("q=alice&tab=profiles&min_followers=100");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        profiles: [
          {
            address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            username: "alice",
            follower_count: 12,
          },
          {
            address: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
            username: "alice_pro",
            follower_count: 250,
          },
        ],
      }),
    });

    render(<SearchPageClient />);

    expect(await screen.findByText("alice_pro", {}, RESULTS_TIMEOUT)).toBeInTheDocument();
    expect(screen.queryByText("alice")).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/profiles/search?q=alice"),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("searches pools and filters by balance status", async () => {
    mockParams = new URLSearchParams("q=community&tab=pools&status=empty");
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        pools: [
          {
            pool_id: "community",
            token: "GTOKEN",
            balance: "5000000000",
            admins: ["GADMIN"],
            threshold: 1,
          },
          {
            pool_id: "treasury",
            token: "GTOKEN",
            balance: "0",
            admins: ["GADMIN"],
            threshold: 1,
          },
        ],
      }),
    });

    render(<SearchPageClient />);

    expect(await screen.findByRole("heading", { name: "treasury" }, RESULTS_TIMEOUT)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "community" })).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/pools/search?q=community"),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("shows trending searches and debounces typed queries into the URL", async () => {
    mockParams = new URLSearchParams();
    mockFetch.mockReturnValue(new Promise(() => {}));

    render(<SearchPageClient />);

    expect(screen.getByTestId("trending-searches")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Soroban" }));
    expect(mockPush).toHaveBeenCalledWith("/search?q=soroban");

    const input = screen.getByRole("textbox", {
      name: "Search posts, profiles, and pools",
    });
    fireEvent.change(input, { target: { value: "soroban" } });

    expect(mockReplace).not.toHaveBeenCalled();
    await waitFor(
      () =>
        expect(mockReplace).toHaveBeenCalledWith("/search?q=soroban", {
          scroll: false,
        }),
      { timeout: 2000 }
    );
  });

  it("focuses search when / is pressed outside an input", () => {
    mockParams = new URLSearchParams();
    mockFetch.mockReturnValue(new Promise(() => {}));

    render(<SearchPageClient />);

    const input = screen.getByRole("textbox", {
      name: "Search posts, profiles, and pools",
    });
    fireEvent.keyDown(window, { key: "/" });

    expect(input).toHaveFocus();
  });

  it("renders an illustrated empty state when nothing matches", async () => {
    mockParams = new URLSearchParams("q=zzz");
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ posts: [] }) });

    render(<SearchPageClient />);

    expect(
      await screen.findByText('No posts found for "zzz".', {}, RESULTS_TIMEOUT)
    ).toBeInTheDocument();
    expect(screen.getByTestId("search-empty-illustration")).toBeInTheDocument();
  });
});
