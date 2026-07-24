import { Router, Request, Response } from "express";
import { Database } from "../../db";
import { validateQuery } from "../../middleware/validate";
import { offsetPaginationSchema } from "@linkora/types/src/schemas";
import { internalError } from "@linkora/types/src/errors";

export function createGovernanceRouter(db: Database): Router {
  const router = Router();

  router.get(
    "/proposals",
    validateQuery(offsetPaginationSchema),
    async (req: Request, res: Response): Promise<void> => {
      const { limit, offset } = req.query as unknown as { limit: number; offset: number };

      try {
        const { proposals, total } = await db.listGovernanceProposals({
          limit,
          offset,
        });

        const serializedProposals = proposals.map((p) => ({
          ...p,
          proposal_id: p.proposal_id.toString(),
          new_value: p.new_value.toString(),
          votes_for: p.votes_for.toString(),
          votes_against: p.votes_against.toString(),
        }));

        res.json({
          proposals: serializedProposals,
          total,
          limit,
          offset,
          has_more: offset + proposals.length < total,
        });
      } catch (error) {
        const err = internalError("Failed to list proposals");
        res.status(err.statusCode).json(err.toJSON(req.context?.requestId));
      }
    }
  );

  return router;
}
