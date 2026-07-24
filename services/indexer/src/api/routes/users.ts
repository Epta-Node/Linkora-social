import { Router, Request, Response } from "express";
import { Database } from "../../db";
import { validateParams, validateQuery } from "../../middleware/validate";
import { z } from "zod";
import { stellarAddressSchema, offsetPaginationSchema } from "@linkora/types/src/schemas";
import { notFoundError } from "@linkora/types/src/errors";

const addressParamsSchema = z.object({
  address: stellarAddressSchema,
});

export function createUsersRouter(db: Database): Router {
  const router = Router();

  router.get(
    "/:address/blocked",
    validateParams(addressParamsSchema),
    validateQuery(offsetPaginationSchema),
    async (req: Request, res: Response): Promise<void> => {
      const { address } = req.params;
      const { limit, offset } = req.query as unknown as z.infer<typeof offsetPaginationSchema>;

      const { blocked, total } = await db.getBlockedUsers(address, limit, offset);

      res.json({
        address,
        blocked,
        total,
        limit,
        offset,
        has_more: offset + blocked.length < total,
      });
    }
  );

  router.get(
    "/:address/dm-key",
    validateParams(addressParamsSchema),
    async (req: Request, res: Response): Promise<void> => {
      const { address } = req.params;

      const pubkey = await db.getDmKey(address);
      if (!pubkey) {
        const err = notFoundError("DM key not found");
        res.status(err.statusCode).json(err.toJSON(req.context?.requestId));
        return;
      }

      res.json({ address, x25519_pubkey: pubkey });
    }
  );

  return router;
}
