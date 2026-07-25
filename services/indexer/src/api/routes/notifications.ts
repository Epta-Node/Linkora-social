import { Router, Request, Response } from "express";
import { NotificationService, NotificationPreferences } from "../../notifications/service";

const ADDRESS_PATTERN = /^G[A-Z2-7]{55}$/;
const TOKEN_PATTERN =
  /^ExponentPushToken\[[^\]]+\]$|^ExpoPushToken\[[^\]]+\]$|^[A-Za-z0-9:_\-[\]]{8,256}$/;
const PLATFORMS = new Set(["ios", "android", "web"]);

const BOOLEANPreferenceKeys: Array<keyof Omit<NotificationPreferences, "address">> = [
  "follow_notifications",
  "tip_notifications",
  "like_notifications",
  "moderation_notifications",
  "governance_notifications",
  "pool_notifications",
  "post_notifications",
];

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

  router.post("/deregister", async (req: Request, res: Response): Promise<void> => {
    const { address } = req.body as { address?: unknown };

    if (typeof address !== "string" || !ADDRESS_PATTERN.test(address)) {
      res
        .status(400)
        .json({ error: "address must be a Stellar public key", code: "INVALID_ADDRESS" });
      return;
    }

    await service.deregisterDeviceToken(address);
    res.status(204).send();
  });

  router.get("/preferences/:address", async (req: Request, res: Response): Promise<void> => {
    const { address } = req.params;

    if (!ADDRESS_PATTERN.test(address)) {
      res
        .status(400)
        .json({ error: "address must be a Stellar public key", code: "INVALID_ADDRESS" });
      return;
    }

    const prefs = await service.getPreferences(address);
    res.json(prefs);
  });

  router.put("/preferences/:address", async (req: Request, res: Response): Promise<void> => {
    const { address } = req.params;

    if (!ADDRESS_PATTERN.test(address)) {
      res
        .status(400)
        .json({ error: "address must be a Stellar public key", code: "INVALID_ADDRESS" });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const prefs: Record<string, boolean> = {};

    for (const key of BOOLEANPreferenceKeys) {
      if (key in body) {
        if (typeof body[key] !== "boolean") {
          res.status(400).json({
            error: `${key} must be a boolean`,
            code: "INVALID_PREFERENCE",
          });
          return;
        }
        prefs[key] = body[key] as boolean;
      }
    }

    await service.setPreferences(address, prefs as Omit<NotificationPreferences, "address">);
    res.status(204).send();
  });

  return router;
}
