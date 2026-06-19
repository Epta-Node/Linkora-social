import { Router, Request, Response } from "express";
import { Pool as PgPool } from "pg";
import { getStateRoot } from "../../stateRoot";

/**
 * GET /api/state-root?ledger=N
 * Returns the stored cryptographic state root for ledger N.
 */
export function createStateRootRouter(pg: PgPool): Router {
  const router = Router();

  router.get("/", async (req: Request, res: Response): Promise<void> => {
    const ledgerParam = req.query["ledger"];

    if (!ledgerParam || isNaN(Number(ledgerParam))) {
      res.status(400).json({ error: "ledger query parameter is required and must be a number" });
      return;
    }

    const ledger = Number(ledgerParam);
    const result = await getStateRoot(pg, ledger);

    if (!result) {
      res.status(404).json({ error: `No state root found for ledger ${ledger}` });
      return;
    }

    res.json({ ledger: result.ledger, root: result.root });
  });

  return router;
}
