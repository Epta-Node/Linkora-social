import { Router, Request, Response } from "express";
import { Database } from "../../db";

export function createProfilesRouter(db: Database): Router {
  const router = Router();

  /**
   * GET /profiles/search?q=<query>&limit=<n>&offset=<n>
   * Full-text search over profiles, ordered by relevance then recency.
   */
  router.get("/search", async (req: Request, res: Response): Promise<void> => {
    const rawQ = req.query.q;
    if (typeof rawQ !== "string" || rawQ.trim() === "") {
      res
        .status(400)
        .json({ error: "q is required and must be a non-empty string", code: "INVALID_QUERY" });
      return;
    }

    const rawLimit = req.query.limit !== undefined ? Number(req.query.limit) : 20;
    const rawOffset = req.query.offset !== undefined ? Number(req.query.offset) : 0;

    if (!Number.isInteger(rawLimit) || rawLimit < 1) {
      res.status(400).json({ error: "limit must be a positive integer", code: "INVALID_QUERY" });
      return;
    }
    if (rawLimit > 100) {
      res.status(400).json({ error: "limit cannot exceed 100", code: "LIMIT_EXCEEDED" });
      return;
    }
    if (!Number.isInteger(rawOffset) || rawOffset < 0) {
      res
        .status(400)
        .json({ error: "offset must be a non-negative integer", code: "INVALID_QUERY" });
      return;
    }

    const { profiles, total } = await db.searchProfiles({
      q: rawQ,
      limit: rawLimit,
      offset: rawOffset,
    });

    res.json({
      profiles,
      total,
      limit: rawLimit,
      offset: rawOffset,
      has_more: rawOffset + profiles.length < total,
    });
  });

  /**
   * GET /profiles/:address
   * Returns the profile for the given Stellar address.
   */
  router.get("/:address", async (req: Request, res: Response): Promise<void> => {
    const { address } = req.params;

    if (!address || typeof address !== "string" || address.trim() === "") {
      res.status(400).json({ error: "address is required", code: "INVALID_ADDRESS" });
      return;
    }

    const profile = await db.getProfile(address);
    if (!profile) {
      res.status(404).json({ error: "Profile not found", code: "NOT_FOUND" });
      return;
    }

    res.json(profile);
  });

  return router;
}
