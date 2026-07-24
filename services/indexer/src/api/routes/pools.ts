import { Router, Request, Response } from "express";
import { Database } from "../../db";
import { validateParams } from "../../middleware/validate";
import { z } from "zod";
import { notFoundError, internalError } from "@linkora/types/src/errors";

const poolIdParamsSchema = z.object({
  id: z
    .string()
    .min(1)
    .refine((v) => v.trim().length > 0, "id is required"),
});

export function createPoolsRouter(db: Database): Router {
  const router = Router();

  router.get("/", async (_req: Request, res: Response): Promise<void> => {
    try {
      const pools = await db.listPools();
      res.json({
        pools: pools.map((p) => ({ ...p, balance: p.balance.toString() })),
      });
    } catch {
      const err = internalError("Failed to fetch pools");
      res.status(err.statusCode).json(err.toJSON(_req.context?.requestId));
    }
  });

  router.get(
    "/:id",
    validateParams(poolIdParamsSchema),
    async (req: Request, res: Response): Promise<void> => {
      const { id } = req.params;

      const pool = await db.getPool(id);
      if (!pool) {
        const err = notFoundError("Pool not found");
        res.status(err.statusCode).json(err.toJSON(req.context?.requestId));
        return;
      }

      res.json({
        ...pool,
        balance: pool.balance.toString(),
      });
    }
  );

  router.get(
    "/:id/analytics",
    validateParams(poolIdParamsSchema),
    async (req: Request, res: Response): Promise<void> => {
      const { id } = req.params;

      try {
        const pool = await db.getPool(id);
        if (!pool) {
          const err = notFoundError("Pool not found");
          res.status(err.statusCode).json(err.toJSON(req.context?.requestId));
          return;
        }

        const analytics = await db.getPoolAnalytics(id);
        res.json({
          pool_id: pool.pool_id,
          token: pool.token,
          balance: pool.balance.toString(),
          admins: pool.admins,
          threshold: pool.threshold,
          created_ledger: pool.created_ledger,
          ...analytics,
        });
      } catch {
        const err = internalError("Failed to fetch analytics");
        res.status(err.statusCode).json(err.toJSON(req.context?.requestId));
      }
    }
  );

  return router;
}
