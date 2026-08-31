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

      // Convert cursor to offset (cursor represents the offset for pagination)
      const offset = cursor ?? 0;
      const { followers, total } = await db.getFollowers(address, limit, offset);

      // Calculate next cursor based on current offset + results count
      const nextCursor = offset + followers.length < total ? (offset + limit).toString() : null;

      res.json({
        address,
        followers,
        total,
        limit,
        cursor: cursor ?? null,
        next_cursor: nextCursor,
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

      // Convert cursor to offset (cursor represents the offset for pagination)
      const offset = cursor ?? 0;
      const { following, total } = await db.getFollowing(address, limit, offset);

      // Calculate next cursor based on current offset + results count
      const nextCursor = offset + following.length < total ? (offset + limit).toString() : null;

      res.json({
        address,
        following,
        total,
        limit,
        cursor: cursor ?? null,
        next_cursor: nextCursor,
      });
    }
  );

  return router;
}
