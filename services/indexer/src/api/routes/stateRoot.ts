import { Router, Request, Response } from "express";
import { Pool as PgPool } from "pg";
import { getStateRoot } from "../../stateRoot";
import { validateQuery } from "../../middleware/validate";
import { z } from "zod";
import { notFoundError, badRequestError } from "@linkora/types/src/errors";

const stateRootQuerySchema = z.object({
  ledger: z.coerce
    .number({
      required_error: "ledger query parameter is required and must be a number",
      invalid_type_error: "ledger must be a number",
    })
    .int("ledger must be an integer")
    .positive("ledger must be a positive integer")
    .max(Number.MAX_SAFE_INTEGER, "ledger must be a valid number"),
});

export function createStateRootRouter(pg: PgPool): Router {
  const router = Router();

  router.get(
    "/",
    validateQuery(stateRootQuerySchema),
    async (req: Request, res: Response): Promise<void> => {
      const { ledger } = req.query as unknown as z.infer<typeof stateRootQuerySchema>;

      // Additional verification: ensure ledger number is reasonable (Issue #1661)
      // Ledgers are roughly 10 seconds apart, so reject requests for unrealistic future ledgers
      const MAX_LEDGER_OFFSET = 10000; // ~27 hours in the future
      const currentLedgerEstimate = Math.floor(Date.now() / 10000);
      if (ledger > currentLedgerEstimate + MAX_LEDGER_OFFSET) {
        const err = badRequestError(
          `Requested ledger ${ledger} is too far in the future (current: ~${currentLedgerEstimate})`
        );
        res.status(err.statusCode).json(err.toJSON(req.context?.requestId));
        return;
      }

      try {
        const result = await getStateRoot(pg, ledger);

        if (!result) {
          const err = notFoundError(`No state root found for ledger ${ledger}`);
          res.status(err.statusCode).json(err.toJSON(req.context?.requestId));
          return;
        }

        // Verify root is valid hex string before returning (Issue #1661)
        if (!result.root || !/^[0-9a-f]{64}$/i.test(result.root)) {
          const err = badRequestError(`Invalid state root format for ledger ${ledger}`);
          res.status(err.statusCode).json(err.toJSON(req.context?.requestId));
          return;
        }

        res.json({
          ledger: result.ledger,
          root: result.root,
          verified: true,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        const err_response = badRequestError(`Failed to verify state root: ${errorMessage}`);
        res.status(err_response.statusCode).json(err_response.toJSON(req.context?.requestId));
      }
    }
  );

  return router;
}
