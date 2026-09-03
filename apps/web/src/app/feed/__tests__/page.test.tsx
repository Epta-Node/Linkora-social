/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import FeedPage from "../page";
import { fetchUserLikes } from "@/lib/api";
import { useWallet } from "@/hooks/useWallet";

// Mock dependencies
jest.mock("@/lib/api");
jest.mock("@/hooks/useWallet");
jest.mock("@/components/onboarding/OnboardingGuard", () => ({
  OnboardingGuard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock("@/components/AnimatedList", () => ({
  AnimatedList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockFetchUserLikes = fetchUserLikes as jest.MockedFunction<typeof fetchUserLikes>;
const mockUseWallet = useWallet as jest.MockedFunction<typeof useWallet>;

// Mock fetch for posts
global.fetch = jest.fn();

describe("FeedPage - Liked State", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default wallet mock
    mockUseWallet.mockReturnValue({
      address: "GABC123",
      connected: true,
      connect: jest.fn(),
    } as any);

    // Default fetch mock for posts endpoint
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        posts: [
          {
            id: "1",
            author: "GDEF456",
            content: "Test post 1",
            like_count: "5",
            tip_total: "0",
            created_at: Date.now(),
          },
          {
            id: "2",
            author: "GDEF456",
            content: "Test post 2",
            like_count: "3",
            tip_total: "0",
            created_at: Date.now() - 1000,
          },
        ],
        has_more: false,
      }),
    });
  });

  it("should fetch and render already-liked posts as liked", async () => {
    // User has liked post "1"
    mockFetchUserLikes.mockResolvedValue(new Set(["1"]));

    render(<FeedPage />);

    // Wait for likes to be fetched
    await waitFor(() => {
      expect(mockFetchUserLikes).toHaveBeenCalledWith("GABC123");
    });

    // Wait for posts to be rendered
    await waitFor(() => {
      expect(screen.getByText("Test post 1")).toBeInTheDocument();
    });

    // Find the like buttons for both posts
    const likeButtons = screen.getAllByRole("button", { name: /like post|unlike post/i });
    
    // First post should be liked (red heart)
    expect(likeButtons[0]).toHaveAttribute("aria-label", "Unlike post");
    expect(likeButtons[0]).toHaveTextContent("❤️");
    
    // Second post should not be liked (white heart)
    expect(likeButtons[1]).toHaveAttribute("aria-label", "Like post");
    expect(likeButtons[1]).toHaveTextContent("🤍");
  });

  it("should render all posts as unliked when user has no likes", async () => {
    // User has no liked posts
    mockFetchUserLikes.mockResolvedValue(new Set());

    render(<FeedPage />);

    await waitFor(() => {
      expect(mockFetchUserLikes).toHaveBeenCalledWith("GABC123");
    });

    await waitFor(() => {
      expect(screen.getByText("Test post 1")).toBeInTheDocument();
    });

    const likeButtons = screen.getAllByRole("button", { name: /like post/i });
    
    // All posts should be unliked
    likeButtons.forEach((button) => {
      expect(button).toHaveAttribute("aria-label", "Like post");
      expect(button).toHaveTextContent("🤍");
    });
  });

  it("should handle fetchUserLikes failure gracefully", async () => {
    // Simulate API failure
    mockFetchUserLikes.mockRejectedValue(new Error("Network error"));

    const consoleSpy = jest.spyOn(console, "error").mockImplementation();

    render(<FeedPage />);

    await waitFor(() => {
      expect(mockFetchUserLikes).toHaveBeenCalledWith("GABC123");
    });

    // Should log error but not crash
    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to fetch user likes:",
        expect.any(Error)
      );
    });

    // Posts should still render
    await waitFor(() => {
      expect(screen.getByText("Test post 1")).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it("should not fetch likes when user is not connected", async () => {
    mockUseWallet.mockReturnValue({
      address: null,
      connected: false,
      connect: jest.fn(),
    } as any);

    render(<FeedPage />);

    // Should not call fetchUserLikes
    await waitFor(() => {
      expect(mockFetchUserLikes).not.toHaveBeenCalled();
    });
  });

  it("should clear likes when user disconnects", async () => {
    const { rerender } = render(<FeedPage />);

    // Initial connection with likes
    await waitFor(() => {
      expect(mockFetchUserLikes).toHaveBeenCalledWith("GABC123");
    });

    // User disconnects
    mockUseWallet.mockReturnValue({
      address: null,
      connected: false,
      connect: jest.fn(),
    } as any);

    rerender(<FeedPage />);

    // Should not show any liked posts when disconnected
    await waitFor(() => {
      const connectButtons = screen.queryAllByText(/connect wallet/i);
      expect(connectButtons.length).toBeGreaterThan(0);
    });
  });
});
