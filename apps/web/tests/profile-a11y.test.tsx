import React from "react";
import { render } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import ProfilePage from "../src/app/profile/[address]/page";

expect.extend(toHaveNoViolations);

/* ────────────────────────────────────────────────────────────────────────── */
/*  Mocks                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

jest.mock("next/navigation", () => ({
  useParams: () => ({ address: "GABC1234" }),
}));

jest.mock("@/hooks/useProfile", () => ({
  useProfile: () => ({
    state: {
      status: "success",
      data: {
        profile: {
          address: "GABC1234",
          username: "testuser",
          creator_token: "GXYZ5678",
          bio: "Hello from the chain",
        },
        followersCount: 10,
        followingCount: 5,
        isFollowing: false,
        posts: [
          {
            id: "1",
            author: "GABC1234",
            deleted: false,
            tip_total: "500",
            like_count: "3",
            created_ledger: 11000,
            deleted_ledger: null,
          },
        ],
        postsTotal: 1,
        postsHasMore: false,
        creatorTokenBalance: "100",
        totalTipsReceived: 500,
      },
    },
    refetch: jest.fn(),
    fetchMorePosts: jest.fn(),
  }),
}));

jest.mock("@/hooks/useWallet", () => ({
  useWallet: () => ({
    address: "GDEF5678",
    connected: true,
    network: "TESTNET",
  }),
}));

jest.mock("@/lib/OptimisticStore", () => ({
  useOptimisticFollow: () => ({
    isFollowing: false,
    followersCount: 10,
    followingCount: 5,
  }),
  OptimisticStore: {
    setFollowState: jest.fn(),
    getFollowState: jest.fn(),
    clearFollowState: jest.fn(),
  },
}));

jest.mock("@/lib/LinkoraEventSubscriber", () => ({
  useLinkoraEvent: jest.fn(),
  useWatchAddress: jest.fn(),
  linkoraEventSubscriber: {
    on: jest.fn(() => jest.fn()),
    emit: jest.fn(),
    watch: jest.fn(),
    unwatch: jest.fn(),
    triggerMockEvent: jest.fn(),
  },
}));

// Mock the SDK import used inside the page for follow actions
jest.mock("../../../../../../packages/sdk/src/client", () => ({
  LinkoraClient: jest.fn().mockImplementation(() => ({
    follow: jest.fn(() => "mock-xdr"),
    unfollow: jest.fn(() => "mock-xdr"),
  })),
}));

/* ────────────────────────────────────────────────────────────────────────── */
/*  Tests                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

describe("ProfilePage Accessibility", () => {
  it("should have no critical or serious accessibility violations", async () => {
    const { container } = render(<ProfilePage />);

    const results = await axe(container, {
      rules: {
        // Ignore color-contrast in JSDOM since it can't compute rendered styles
        "color-contrast": { enabled: false },
      },
    });

    // Filter to only critical and serious (the acceptance criteria)
    const criticalOrSerious = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious"
    );

    expect(criticalOrSerious).toHaveLength(0);
  });

  it("Follow button has an appropriate aria-label", () => {
    const { getByRole } = render(<ProfilePage />);
    const followBtn = getByRole("button", { name: /follow testuser/i });
    expect(followBtn).toBeTruthy();
  });

  it("Follow button is inside an aria-live region", () => {
    const { container } = render(<ProfilePage />);
    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeTruthy();
    // The follow button should be a descendant
    const followBtn = liveRegion?.querySelector("#follow-btn");
    expect(followBtn).toBeTruthy();
  });

  it("profile header section has an accessible label", () => {
    const { container } = render(<ProfilePage />);
    const section = container.querySelector('[aria-label="Profile header"]');
    expect(section).toBeTruthy();
  });
});
