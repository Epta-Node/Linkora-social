import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { addNotificationResponseReceivedListener } from "expo-notifications";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
}));

jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  removeNotificationSubscription: jest.fn(),
}));

import { setupNotificationListeners } from "../notifications/notificationHandler";

const { router } = jest.requireMock("expo-router");

describe("notification tap handling", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    router.push.mockReset();
  });

  it("navigates to a profile screen for follow notifications", () => {
    setupNotificationListeners();
    const responseListener = (addNotificationResponseReceivedListener as jest.Mock).mock
      .calls[0][0];

    responseListener({
      notification: {
        request: {
          content: {
            data: { type: "NEW_FOLLOWER", followerAddress: "G123" },
          },
        },
      },
    });

    expect(router.push).toHaveBeenCalledWith("/profile/G123");
  });

  it("navigates to a post screen for tip notifications", () => {
    setupNotificationListeners();
    const responseListener = (addNotificationResponseReceivedListener as jest.Mock).mock
      .calls[0][0];

    responseListener({
      notification: {
        request: {
          content: {
            data: { type: "TIP_RECEIVED", postId: "42" },
          },
        },
      },
    });

    expect(router.push).toHaveBeenCalledWith("/post/42");
  });

  it("normalizes universal links in notification payloads", () => {
    setupNotificationListeners();
    const responseListener = (addNotificationResponseReceivedListener as jest.Mock).mock
      .calls[0][0];

    responseListener({
      notification: {
        request: {
          content: {
            data: { type: "LIKE_RECEIVED", deepLink: "https://linkora.social/post/42" },
          },
        },
      },
    });

    expect(router.push).toHaveBeenCalledWith("/post/42");
  });
});
