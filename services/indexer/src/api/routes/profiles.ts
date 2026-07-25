import { Router, Request, Response } from "express";
import { Database } from "../../db";
import { validateParams } from "../../middleware/validate";
import { z } from "zod";
import { stellarAddressSchema } from "@linkora/types/src/schemas";
import { notFoundError } from "@linkora/types/src/errors";

const getProfileParamsSchema = z.object({
  address: stellarAddressSchema,
});

export function createProfilesRouter(db: Database): Router {
  const router = Router();

  router.get(
    "/:address",
    validateParams(getProfileParamsSchema),
    async (req: Request, res: Response): Promise<void> => {
      const { address } = req.params;

      const profile = await db.getProfile(address);
      if (!profile) {
        const err = notFoundError("Profile not found");
        res.status(err.statusCode).json(err.toJSON(req.context?.requestId));
        return;
      }

      res.json(profile);
    }
  );

  return router;
}
