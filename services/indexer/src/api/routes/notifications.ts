import { Router, Request, Response } from "express";
import { NotificationService } from "../../notifications/service";
import { requireStellarAuth } from "../../middleware/stellarAuth";
import { validateBody } from "../../middleware/validate";
import { z } from "zod";
import { stellarAddressSchema } from "@linkora/types/src/schemas";
import { unauthorizedError, internalError } from "@linkora/types/src/errors";

const PLATFORMS = ["ios", "android", "web"] as const;

const registerDeviceSchema = z.object({
  address: stellarAddressSchema,
  token: z.string().min(1, "token is required"),
  platform: z.enum(PLATFORMS),
});

const deregisterDeviceSchema = z.object({
  address: stellarAddressSchema,
});

const preferencesSchema = z.object({
  browserPushEnabled: z.boolean().optional().default(false),
  newFollowers: z.boolean().optional().default(true),
  newLikes: z.boolean().optional().default(true),
  newComments: z.boolean().optional().default(true),
  directMessages: z.boolean().optional().default(true),
  poolActivity: z.boolean().optional().default(true),
  governanceUpdates: z.boolean().optional().default(true),
});

const updatePreferencesSchema = z.object({
  preferences: preferencesSchema,
  subscription: z.union([z.string(), z.record(z.unknown())]).optional(),
});

const DEFAULT_PREFERENCES = {
  browserPushEnabled: false,
  newFollowers: true,
  newLikes: true,
  newComments: true,
  directMessages: true,
  poolActivity: true,
  governanceUpdates: true,
};

export function createNotificationsRouter(service: NotificationService): Router {
  const router = Router();

  router.post(
    "/register",
    validateBody(registerDeviceSchema),
    async (req: Request, res: Response): Promise<void> => {
      const { address, token, platform } = req.body as z.infer<typeof registerDeviceSchema>;
      await service.registerDeviceToken(address, token, platform);
      res.status(204).send();
    }
  );

  router.post(
    "/deregister",
    validateBody(deregisterDeviceSchema),
    async (req: Request, res: Response): Promise<void> => {
      const { address } = req.body as z.infer<typeof deregisterDeviceSchema>;
      await service.deregisterDeviceToken(address);
      res.status(204).send();
    }
  );

  router.get(
    "/preferences",
    requireStellarAuth,
    async (req: Request, res: Response): Promise<void> => {
      const address = req.context?.stellarAddress;
      if (!address) {
        const err = unauthorizedError("Unauthorized");
        res.status(err.statusCode).json(err.toJSON(req.context?.requestId));
        return;
      }

      try {
        const prefs = await service.getPreferences(address);
        res.json(prefs || { ...DEFAULT_PREFERENCES, address });
      } catch (error) {
        const err = internalError("Failed to fetch preferences");
        res.status(err.statusCode).json(err.toJSON(req.context?.requestId));
      }
    }
  );

  router.post(
    "/preferences",
    requireStellarAuth,
    validateBody(updatePreferencesSchema),
    async (req: Request, res: Response): Promise<void> => {
      const address = req.context?.stellarAddress;
      if (!address) {
        const err = unauthorizedError("Unauthorized");
        res.status(err.statusCode).json(err.toJSON(req.context?.requestId));
        return;
      }

      const { preferences, subscription } = req.body as z.infer<typeof updatePreferencesSchema>;

      try {
        await service.savePreferences(address, preferences);

        if (preferences.browserPushEnabled && subscription) {
          const tokenStr =
            typeof subscription === "string" ? subscription : JSON.stringify(subscription);
          await service.registerDeviceToken(address, tokenStr, "web");
        } else {
          await service.deregisterDeviceToken(address);
        }

        res.status(200).json({ success: true });
      } catch (error) {
        const err = internalError("Failed to save preferences");
        res.status(err.statusCode).json(err.toJSON(req.context?.requestId));
      }
    }
  );

  return router;
}
