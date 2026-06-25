import { Router, Request, Response } from "express";
import { NotificationService } from "../../notifications/service";

const ADDRESS_PATTERN = /^G[A-Z2-7]{55}$/;
const TOKEN_PATTERN =
  /^ExponentPushToken\[[^\]]+\]$|^ExpoPushToken\[[^\]]+\]$|^[A-Za-z0-9:_\-[\]]{8,256}$/;
const PLATFORMS = new Set(["ios", "android", "web"]);

export function createNotificationsRouter(service: NotificationService): Router {
  const router = Router();

  router.post("/register", async (req: Request, res: Response): Promise<void> => {
    const { address, token, platform } = req.body as {
      address?: unknown;
      token?: unknown;
      platform?: unknown;
    };

    if (typeof address !== "string" || !ADDRESS_PATTERN.test(address)) {
      res
        .status(400)
        .json({ error: "address must be a Stellar public key", code: "INVALID_ADDRESS" });
      return;
    }

    if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) {
      res.status(400).json({ error: "token is required", code: "INVALID_TOKEN" });
      return;
    }

    if (typeof platform !== "string" || !PLATFORMS.has(platform)) {
      res
        .status(400)
        .json({ error: "platform must be ios, android, or web", code: "INVALID_PLATFORM" });
      return;
    }

    await service.registerDeviceToken(address, token, platform);
    res.status(204).send();
  });

  return router;
}
