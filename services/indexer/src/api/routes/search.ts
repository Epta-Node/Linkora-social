import { Router, Request, Response } from "express";
import { Database } from "../../db";
import { validateQuery } from "../../middleware/validate";
import { z } from "zod";
import { offsetPaginationSchema } from "@linkora/types/src/schemas";

const searchPostsQuerySchema = offsetPaginationSchema.extend({
  q: z.string().min(1, "q is required and must be a non-empty string"),
});

export function createSearchRouter(db: Database): Router {
  const router = Router();

  router.get(
    "/posts",
    validateQuery(searchPostsQuerySchema),
    async (req: Request, res: Response): Promise<void> => {
      const { q, limit, offset } = req.query as unknown as z.infer<typeof searchPostsQuerySchema>;

      const { posts, total } = await db.searchPosts({
        q,
        limit,
        offset,
      });

      const serialised = posts.map((p) => ({
        ...p,
        id: p.id.toString(),
        tip_total: p.tip_total.toString(),
        like_count: p.like_count.toString(),
      }));

      res.json({
        posts: serialised,
        total,
        limit,
        offset,
        has_more: offset + posts.length < total,
      });
    }
  );

  return router;
}
