import { Router, Request, Response } from "express";
import { Database } from "../../db";
import { validateParams, validateQuery } from "../../middleware/validate";
import { z } from "zod";
import { offsetPaginationSchema, cursorPaginationSchema } from "@linkora/types/src/schemas";
import { notFoundError, internalError } from "@linkora/types/src/errors";
import { CacheService, CacheKeys, POOL_LIST_TTL_S } from "../../cache";

const poolIdParamsSchema = z.object({
  id: z
    .string()
    .min(1)
    .refine((v) => v.trim().length > 0, "id is required"),
});

const searchPoolsQuerySchema = offsetPaginationSchema.extend({
  q: z.string().trim().min(1, "q is required and must be a non-empty string"),
});

export function createPoolsRouter(db: Database, cache?: CacheService): Router {
  const router = Router();

  router.get(
    "/",
    validateQuery(cursorPaginationSchema),
    async (req: Request, res: Response): Promise<void> => {
      const { limit, cursor } = req.query as unknown as z.infer<typeof cursorPaginationSchema>;

      try {
        const cacheKey = CacheKeys.poolList(cursor ?? "", limit);
        if (cache) {
          const cached = await cache.get<{ pools: unknown[]; nextCursor: string | null }>(
            cacheKey
          );
          if (cached) {
            res.json({
              pools: cached.pools,
              limit,
              cursor: cursor ?? null,
              next_cursor: cached.nextCursor,
              has_more: cached.nextCursor !== null,
            });
            return;
          }
        }

        const { pools, nextCursor } = await db.listPoolsCursor({
          limit,
          cursor: cursor || undefined,
        });

        const serialisedPools = pools.map((p) => ({ ...p, balance: p.balance.toString() }));

        if (cache) {
          await cache.set(cacheKey, { pools: serialisedPools, nextCursor }, POOL_LIST_TTL_S);
        }

        res.json({
          pools: serialisedPools,
          limit,
          cursor: cursor ?? null,
          next_cursor: nextCursor,
          has_more: nextCursor !== null,
        });
      } catch {
        const err = internalError("Failed to fetch pools");
        res.status(err.statusCode).json(err.toJSON(req.context?.requestId));
      }
    }
  );

  router.get(
    "/search",
    validateQuery(searchPoolsQuerySchema),
    async (req: Request, res: Response): Promise<void> => {
      const { q, limit, offset } = req.query as unknown as z.infer<typeof searchPoolsQuerySchema>;

      try {
        const { pools, total } = await db.searchPools({ q, limit, offset });

        res.json({
          pools: pools.map((p) => ({ ...p, balance: p.balance.toString() })),
          total,
          limit,
          offset,
          has_more: offset + pools.length < total,
        });
      } catch {
        const err = internalError("Failed to search pools");
        res.status(err.statusCode).json(err.toJSON(req.context?.requestId));
      }
    }
  );

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
