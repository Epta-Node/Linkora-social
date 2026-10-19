import * as Notifications from "expo-notifications";
import { router } from "expo-router";

import {
  __resetNotificationResponseGuard,
  setupNotificationListeners,
} from "../notificationHandler";

const ADDRESS = "GCKFBEIYTKP6RCZNVPH73XL7XFWTEOAO4MKONX7HOILHDVBMW5EVPOPZ";

type Listener = (response: unknown) => void;

let responseListener: Listener | null = null;
let lastResponse: unknown = null;
let clearCalls = 0;

function response(data: Record<string, unknown>) {
  return { notification: { request: { content: { data } } } };
}

function setup() {
  const cleanup = setupNotificationListeners();
  // Let the cold-start read (a promise chain) settle.
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      cleanup();
      resolve();
    }, 0);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetNotificationResponseGuard();
  responseListener = null;
  lastResponse = null;
  clearCalls = 0;

  (Notifications.addNotificationReceivedListener as jest.Mock).mockReturnValue({
    remove: jest.fn(),
  });
  (Notifications.addNotificationResponseReceivedListener as jest.Mock).mockImplementation(
    (listener: Listener) => {
      responseListener = listener;
      return { remove: jest.fn() };
    }
  );
  (Notifications.getLastNotificationResponseAsync as jest.Mock).mockImplementation(async () => {
    const pending = lastResponse;
    lastResponse = null;
    return pending;
  });
  (Notifications.clearLastNotificationResponseAsync as jest.Mock).mockImplementation(async () => {
    clearCalls += 1;
  });
});

describe("notification routing (#1555)", () => {
  it("rejects a traversing deep link instead of routing it", async () => {
    await setup();

    responseListener?.(
      response({ type: "LIKE_RECEIVED", deepLink: "linkora://post/../../settings" })
    );

    // The crafted segment never reaches the router; the tap lands on the safe
    // fallback instead of on `/post/../../settings`.
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/(tabs)/explore");
    for (const call of (router.push as jest.Mock).mock.calls) {
      expect(call[0]).not.toContain("settings");
    }
  });

  it("rejects a deep link carrying a query string", async () => {
    await setup();

    responseListener?.(response({ type: "LIKE_RECEIVED", deepLink: "linkora://post/x?a=b" }));

    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/(tabs)/explore");
  });

  it("rejects a raw path that the prefix allowlist used to push straight through", async () => {
    await setup();

    responseListener?.(response({ type: "LIKE_RECEIVED", deepLink: "/post/../../settings" }));

    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/(tabs)/explore");
  });

  it("rejects an unknown target and falls back to the explore screen", async () => {
    await setup();

    responseListener?.(response({ type: "POOL_ACTIVITY", deepLink: "/settings/general" }));

    expect(router.push).toHaveBeenCalledWith("/(tabs)/explore");
  });

  it("routes a valid deep link", async () => {
    await setup();

    responseListener?.(response({ type: "LIKE_RECEIVED", deepLink: "linkora://post/abc-123" }));

    expect(router.push).toHaveBeenCalledWith("/post/abc-123");
  });

  it("validates the typed fallback the same way as a deep link", async () => {
    await setup();

    responseListener?.(response({ type: "NEW_FOLLOWER", followerAddress: "../../settings" }));

    expect(router.push).toHaveBeenCalledWith("/(tabs)/explore");
  });

  it("routes the typed fallback for a well-formed payload", async () => {
    await setup();

    responseListener?.(response({ type: "NEW_FOLLOWER", followerAddress: ADDRESS }));

    expect(router.push).toHaveBeenCalledWith(`/profile/${ADDRESS}`);
  });
});

describe("cold start notification handling (#1556)", () => {
  it("processes the response that terminated the app on mount", async () => {
    // The app was killed, the user tapped a notification, and the OS relaunched
    // us with that response pending. No live tap event fires in this case.
    lastResponse = response({ type: "LIKE_RECEIVED", deepLink: "linkora://post/abc-123" });

    await setup();

    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith("/post/abc-123");
  });

  it("clears the stored response after handling it", async () => {
    lastResponse = response({ type: "TIP_RECEIVED", postId: "abc-123" });

    await setup();

    expect(clearCalls).toBe(1);
  });

  it("navigates exactly once when the live listener also fires", async () => {
    const pending = response({ type: "LIKE_RECEIVED", deepLink: "linkora://post/abc-123" });
    lastResponse = pending;

    await setup();
    // The same response arriving on the live listener after the cold read
    // must not produce a second navigation.
    responseListener?.(pending);

    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("navigates once when the live tap wins the race", async () => {
    const pending = response({ type: "LIKE_RECEIVED", deepLink: "linkora://post/abc-123" });
    lastResponse = pending;

    const cleanup = setupNotificationListeners();
    responseListener?.(pending);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    cleanup();

    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it("does nothing when there is no pending response", async () => {
    lastResponse = null;

    await setup();

    expect(router.push).not.toHaveBeenCalled();
  });
});
