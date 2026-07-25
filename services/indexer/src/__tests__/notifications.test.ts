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
});
