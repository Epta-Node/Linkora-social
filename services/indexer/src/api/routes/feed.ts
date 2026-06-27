import { Router, Request, Response } from "express";
import { Database } from "../../db";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

export function createFeedRouter(db: Database): Router {
  const router = Router();

  /**
   * GET /explore?limit=<n>&cursor=<offset>
   * Returns posts ordered by score for the explore feed.
   */
  router.get("/explore", async (req: Request, res: Response): Promise<void> => {
    const rawLimit = req.query.limit !== undefined ? Number(req.query.limit) : DEFAULT_LIMIT;
    const cursor = req.query.cursor !== undefined ? Number(req.query.cursor) : undefined;

    if (!Number.isInteger(rawLimit) || rawLimit < 1) {
      res.status(400).json({ error: "limit must be a positive integer", code: "INVALID_QUERY" });
      return;
    }
    if (rawLimit > MAX_LIMIT) {
      res.status(400).json({ error: `limit cannot exceed ${MAX_LIMIT}`, code: "LIMIT_EXCEEDED" });
      return;
    }
    if (cursor !== undefined && (!Number.isInteger(cursor) || cursor < 0)) {
      res.status(400).json({
        error: "cursor must be a non-negative integer",
        code: "INVALID_QUERY",
      });
      return;
    }

    try {
      const { posts, total, hasMore } = await db.getExploreFeed(rawLimit, cursor);
      res.json({
        posts,
        total,
        limit: rawLimit,
        cursor: cursor ?? 0,
        has_more: hasMore,
      });
    } catch (error) {
      console.error("Error fetching explore feed", error);
      res.status(500).json({ error: "Failed to fetch explore feed", code: "INTERNAL_ERROR" });
    }
  });

  /**
   * GET /following/:address?limit=<n>&cursor=<timestamp>
   * Returns posts from accounts the user follows, ordered by recency.
   */
  router.get("/following/:address", async (req: Request, res: Response): Promise<void> => {
    const address = req.params.address;
    const rawLimit = req.query.limit !== undefined ? Number(req.query.limit) : DEFAULT_LIMIT;
    const cursor = req.query.cursor !== undefined ? Number(req.query.cursor) : undefined;

    if (!address) {
      res.status(400).json({ error: "address is required", code: "INVALID_PARAMS" });
      return;
    }

    if (!Number.isInteger(rawLimit) || rawLimit < 1) {
      res.status(400).json({ error: "limit must be a positive integer", code: "INVALID_QUERY" });
      return;
    }
    if (rawLimit > MAX_LIMIT) {
      res.status(400).json({ error: `limit cannot exceed ${MAX_LIMIT}`, code: "LIMIT_EXCEEDED" });
      return;
    }
    if (cursor !== undefined && (!Number.isFinite(cursor) || cursor < 0)) {
      res.status(400).json({
        error: "cursor must be a non-negative number (unix timestamp)",
        code: "INVALID_QUERY",
      });
      return;
    }

    try {
      const { posts, total, hasMore } = await db.getFollowingFeed(address, rawLimit, cursor);
      res.json({
        posts,
        total,
        limit: rawLimit,
        cursor: cursor ?? null,
        has_more: hasMore,
      });
    } catch (error) {
      console.error("Error fetching following feed", error);
      res.status(500).json({ error: "Failed to fetch following feed", code: "INTERNAL_ERROR" });
    }
  });

  return router;
}
