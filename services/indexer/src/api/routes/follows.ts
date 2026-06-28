import { Router, Request, Response } from "express";
import { Database } from "../../db";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

function parseCursor(query: Record<string, unknown>): { limit: number; cursor?: string } | { error: string; code: string } {
  const rawLimit = query.limit !== undefined ? Number(query.limit) : DEFAULT_LIMIT;
  const cursor = typeof query.cursor === "string" ? query.cursor : undefined;

  if (!Number.isInteger(rawLimit) || rawLimit < 1) {
    return { error: "limit must be a positive integer", code: "INVALID_QUERY" };
  }
  if (rawLimit > MAX_LIMIT) {
    return { error: `limit cannot exceed ${MAX_LIMIT}`, code: "LIMIT_EXCEEDED" };
  }

  return { limit: rawLimit, cursor };
}

export function createFollowsRouter(db: Database): Router {
  const router = Router();

  /**
   * GET /follows/:address/followers?limit=<n>&cursor=<id>
   * Returns accounts that follow the given address with cursor-based pagination.
   * Response includes nextCursor (null when no more pages).
   * Legacy ?offset parameter is ignored; clients should migrate to ?cursor.
   */
  router.get("/:address/followers", async (req: Request, res: Response): Promise<void> => {
    const { address } = req.params;
    const pagination = parseCursor(req.query as Record<string, unknown>);

    if ("error" in pagination) {
      res.status(400).json(pagination);
      return;
    }

    const { limit, cursor } = pagination;
    const { followers, nextCursor } = await db.getFollowers(address, limit, cursor);
    res.json({
      address,
      followers,
      limit,
      nextCursor,
    });
  });

  /**
   * GET /follows/:address/following?limit=<n>&cursor=<id>
   * Returns accounts that the given address follows with cursor-based pagination.
   * Response includes nextCursor (null when no more pages).
   * Legacy ?offset parameter is ignored; clients should migrate to ?cursor.
   */
  router.get("/:address/following", async (req: Request, res: Response): Promise<void> => {
    const { address } = req.params;
    const pagination = parseCursor(req.query as Record<string, unknown>);

    if ("error" in pagination) {
      res.status(400).json(pagination);
      return;
    }

    const { limit, cursor } = pagination;
    const { following, nextCursor } = await db.getFollowing(address, limit, cursor);
    res.json({
      address,
      following,
      limit,
      nextCursor,
    });
  });

  return router;
}
