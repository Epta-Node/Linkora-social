import { createNotificationsRouter } from "../notifications";
import { NotificationService } from "../../../notifications/service";

function createMockResponse() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
  return res;
}

async function invokeRoute(
  router: ReturnType<typeof createNotificationsRouter>,
  path: string,
  req: Record<string, unknown>
) {
  const layer = router.stack.find((item: any) => item.route?.path === path);
  if (!layer) throw new Error(`Route ${path} not found`);

  const res = createMockResponse();
  const stack = layer.route.stack;

  let i = 0;
  const next = () => {
    if (i < stack.length) {
      const handler = stack[i++].handle;
      handler(req, res, next);
    }
  };
  next();
  return res;
}

async function postRegister(body: Record<string, unknown>, service: NotificationService) {
  const router = createNotificationsRouter(service);
  return invokeRoute(router, "/register", { body });
}

async function postDeregister(body: Record<string, unknown>, service: NotificationService) {
  const router = createNotificationsRouter(service);
  return invokeRoute(router, "/deregister", { body });
}

describe("notifications API", () => {
  const address = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

  it("registers a device token", async () => {
    const service = new NotificationService();

    const res = await postRegister(
      { address, token: "ExpoPushToken[token-123]", platform: "ios" },
      service
    );

    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
    await expect(service.getDeviceToken(address)).resolves.toBe("ExpoPushToken[token-123]");
  });

  it("rejects malformed registration requests", async () => {
    const service = new NotificationService();

    const res = await postRegister(
      { address: "bad", token: "ExpoPushToken[token-123]", platform: "ios" },
      service
    );

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("deregisters a device token", async () => {
    const service = new NotificationService();
    await service.registerDeviceToken(address, "ExpoPushToken[token-456]", "ios");

    const res = await postDeregister({ address }, service);

    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();
    await expect(service.getDeviceToken(address)).resolves.toBeNull();
  });

  it("rejects deregistration with invalid address", async () => {
    const service = new NotificationService();

    const res = await postDeregister({ address: "bad" }, service);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});
