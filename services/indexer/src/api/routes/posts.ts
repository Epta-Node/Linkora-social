import { Router, Request, Response } from "express";
import { Database } from "../../db";
import { validateQuery, validateParams } from "../../middleware/validate";
import { z } from "zod";
import { cursorPaginationSchema, numericIdStringSchema } from "@linkora/types/src/schemas";
import { notFoundError, internalError } from "@linkora/types/src/errors";

const listPostsQuerySchema = cursorPaginationSchema.extend({
  author: z.string().optional(),
});

const postIdParamsSchema = z.object({
  id: numericIdStringSchema,
});

export function createPostsRouter(db: Database): Router {
  const router = Router();

  router.get(
    "/",
    validateQuery(listPostsQuerySchema),
    async (req: Request, res: Response): Promise<void> => {
      const { author, limit, cursor } = req.query as unknown as z.infer<
        typeof listPostsQuerySchema
      >;

      const { posts, total, hasMore } = await db.listPostsCursor({
        author: author || undefined,
        limit,
        cursor: cursor || undefined,
      });
      res.json({
        posts,
        total,
        limit,
        cursor: cursor ?? null,
        has_more: hasMore,
      });
    }
  );

  router.get(
    "/:id",
    validateParams(postIdParamsSchema),
    async (req: Request, res: Response): Promise<void> => {
      const postId = BigInt(req.params.id);
      const post = await db.getPost(postId);
      if (!post) {
        const err = notFoundError("Post not found");
        res.status(err.statusCode).json(err.toJSON(req.context?.requestId));
        return;
      }
      res.json(post);
    }
  );

  router.get(
    "/:id/reports",
    validateParams(postIdParamsSchema),
    async (req: Request, res: Response): Promise<void> => {
      const postId = BigInt(req.params.id);

      try {
        const reports = await db.getPostReports(postId);
        res.json({
          post_id: postId.toString(),
          reports,
          total: reports.length,
        });
      } catch (error) {
        console.error(`Error fetching reports for post ${postId}:`, error);
        const err = internalError("Failed to fetch reports");
        res.status(err.statusCode).json(err.toJSON(req.context?.requestId));
      }
    }
  );

  return router;
}
