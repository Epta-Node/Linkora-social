import { NotificationService } from "../notifications/service";

const sendPushMock = jest.fn();

jest.mock("node-fetch", () => jest.fn());

describe("notification service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("dispatches a push for tip events to the registered token", async () => {
    const service = new NotificationService({
      sendPush: sendPushMock,
      deviceTokens: new Map(),
    });

    await service.registerDeviceToken("GRECIPIENT", "token-123", "ios");

    await service.dispatchEventNotification({
      type: "TIP_RECEIVED",
      recipient: "GRECIPIENT",
      payload: { postId: "42" },
    });

    expect(sendPushMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "token-123",
        title: expect.stringContaining("Tip"),
      })
    );
  });

  it("retries a transient Expo failure before succeeding", async () => {
    const sendPush = jest
      .fn()
      .mockRejectedValueOnce(new Error("temporary 503"))
      .mockResolvedValueOnce({ ok: true });
    const service = new NotificationService({
      sendPush,
      deviceTokens: new Map(),
      retryDelayMs: 0,
    });

    await service.registerDeviceToken("GRECIPIENT", "token-123", "ios");

    await expect(
      service.dispatchEventNotification({
        type: "TIP_RECEIVED",
        recipient: "GRECIPIENT",
      })
    ).resolves.toBe(true);
    expect(sendPush).toHaveBeenCalledTimes(2);
  });
});
