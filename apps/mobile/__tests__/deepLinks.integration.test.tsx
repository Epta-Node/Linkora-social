import React from "react";
import { render } from "@testing-library/react-native";
import { useLocalSearchParams } from "expo-router";

jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("../hooks/useWallet", () => ({
  useWallet: () => ({ address: "G123", connected: true, wallet: { address: "G123" } }),
}));

jest.mock("../hooks/useDeletePost", () => ({
  useDeletePost: () => ({ deleting: false, deletePost: jest.fn() }),
}));

jest.mock("../hooks/useFeed", () => ({
  getFeedPost: jest.fn(() => null),
  useFeed: () => ({ posts: [], loading: false, refresh: jest.fn() }),
}));

jest.mock("../hooks/useProfile", () => ({
  useProfile: () => ({
    profile: null,
    loading: false,
    error: null,
    followerCount: 0,
    followingCount: 0,
    isFollowing: false,
    toggleFollow: jest.fn(),
    refresh: jest.fn(),
  }),
}));

jest.mock("../theme/useTheme", () => ({
  useTheme: () => ({
    theme: {
      colors: {
        surface: { background: "#0f172a", surface1: "#111827", border: "#334155" },
        text: { primary: "#fff", secondary: "#94a3b8", onBrand: "#fff" },
        semantic: { error: "#ef4444" },
        brand: { primary: "#6366f1" },
      },
      radius: { full: 999 },
    },
  }),
}));

import PostDetailScreen from "../app/post/[id]";
import ProfileDetailScreen from "../app/profile/[address]";
import PoolsDetailScreen from "../app/pools/[id]";

describe("deep link screens", () => {
  it("renders a post detail placeholder for unknown ids", () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: "999" });
    const { getByText } = render(<PostDetailScreen />);
    expect(getByText("Post not found.")).toBeTruthy();
  });

  it("renders profile screen shell", () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ address: "G123" });
    const { getByText } = render(<ProfileDetailScreen />);
    expect(getByText("No posts yet")).toBeTruthy();
  });

  it("renders pool details shell", () => {
    (useLocalSearchParams as jest.Mock).mockReturnValue({ id: "pool-1" });
    const { getByText } = render(<PoolsDetailScreen />);
    expect(getByText("Pool details coming soon.")).toBeTruthy();
  });
});
