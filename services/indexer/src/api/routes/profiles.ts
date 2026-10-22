import { Router, Request, Response } from "express";
import { Database } from "../../db";
import { validateParams, validateQuery } from "../../middleware/validate";
import { z } from "zod";
import { offsetPaginationSchema, stellarAddressSchema } from "@linkora/types/src/schemas";
import { notFoundError, internalError } from "@linkora/types/src/errors";

const getProfileParamsSchema = z.object({
  address: stellarAddressSchema,
});

const searchProfilesQuerySchema = offsetPaginationSchema.extend({
  q: z.string().trim().min(1, "q is required and must be a non-empty string"),
});

export function createProfilesRouter(db: Database): Router {
  const router = Router();

  router.get(
    "/search",
    validateQuery(searchProfilesQuerySchema),
    async (req: Request, res: Response): Promise<void> => {
      const { q, limit, offset } = req.query as unknown as z.infer<
        typeof searchProfilesQuerySchema
      >;

      try {
        const { profiles, total } = await db.searchProfiles({ q, limit, offset });

        res.json({
          profiles,
          total,
          limit,
          offset,
          has_more: offset + profiles.length < total,
        });
      } catch {
        const err = internalError("Failed to search profiles");
        res.status(err.statusCode).json(err.toJSON(req.context?.requestId));
      }
    }
  );

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
