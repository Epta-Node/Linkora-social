import { Router, Request, Response } from "express";
import { Pool } from "pg";
import { logger } from "../logger.js";
import { internalError, isAppError } from "@linkora/types/src/errors.js";

export interface WeeklyTipper {
  address: string;
  handle: string | null;
  total_xlm: string;
  tip_count: number;
}

export function createLeaderboardRouter(db: Pool): Router {
  const router = Router();

  router.get("/leaderboard/weekly", async (req: Request, res: Response): Promise<void> => {
    const requestId = (req as Request & { requestId?: string }).requestId;
    try {
      const result = await db.query<{
        address: string;
        handle: string | null;
        total_xlm: string;
        tip_count: string;
      }>(
        `
        SELECT
          t.tipper AS address,
          MAX(p.username) AS handle,
          COALESCE(SUM(t.amount), 0)::text AS total_xlm,
          COUNT(*)::text AS tip_count
        FROM tips t
        LEFT JOIN profiles p ON p.address = t.tipper
        WHERE t.created_at >= date_trunc('week', NOW())
        GROUP BY t.tipper
        ORDER BY COALESCE(SUM(t.amount), 0) DESC, COUNT(*) DESC
        LIMIT 20
        `
      );

      const tippers: WeeklyTipper[] = result.rows.map((row) => ({
        address: row.address,
        handle: row.handle,
        total_xlm: row.total_xlm,
        tip_count: Number(row.tip_count),
      }));

      res.json({
        week_start: new Date().toISOString(),
        tippers,
      });
    } catch (err) {
      logger.error({ requestId, err }, "Failed to compute weekly leaderboard");
      if (isAppError(err as Error)) {
        const appErr = err as { statusCode: number; toJSON: (id?: string) => object };
        res.status(appErr.statusCode).json(appErr.toJSON(requestId));
        return;
      }
      const fallback = internalError("Failed to compute weekly leaderboard");
      res.status(fallback.statusCode).json(fallback.toJSON(requestId));
    }
  });

  return router;
}
