import { Router, Request, Response } from "express";
import { Database } from "../../db";
import { validateParams, validateQuery } from "../../middleware/validate";
import { z } from "zod";
import { stellarAddressSchema, cursorPaginationSchema } from "@linkora/types/src/schemas";

const addressParamsSchema = z.object({
  address: stellarAddressSchema,
});

export function createFollowsRouter(db: Database): Router {
  const router = Router();

  router.get(
    "/:address/followers",
    validateParams(addressParamsSchema),
    validateQuery(cursorPaginationSchema),
    async (req: Request, res: Response): Promise<void> => {
      const { address } = req.params;
      const { limit, cursor } = req.query as unknown as z.infer<typeof cursorPaginationSchema>;

      const { followers, total, nextCursor } = await db.getFollowers(address, { limit, cursor });
      res.json({
        address,
        followers,
        total,
        limit,
        cursor: cursor ?? null,
        next_cursor: nextCursor ?? null,
      });
    }
  );

  router.get(
    "/:address/following",
    validateParams(addressParamsSchema),
    validateQuery(cursorPaginationSchema),
    async (req: Request, res: Response): Promise<void> => {
      const { address } = req.params;
      const { limit, cursor } = req.query as unknown as z.infer<typeof cursorPaginationSchema>;

      const { following, total, nextCursor } = await db.getFollowing(address, { limit, cursor });
      res.json({
        address,
        following,
        total,
        limit,
        cursor: cursor ?? null,
        next_cursor: nextCursor ?? null,
      });
    }
  );

  return router;
}
