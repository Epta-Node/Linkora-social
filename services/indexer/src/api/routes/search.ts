import { Router, Request, Response } from "express";
import { Database } from "../../db";
import { validateQuery } from "../../middleware/validate";
import { z } from "zod";
import { offsetPaginationSchema } from "@linkora/types/src/schemas";

const searchPostsQuerySchema = offsetPaginationSchema
  .extend({
    q: z.string().min(1, "q is required and must be a non-empty string").optional(),
    tag: z.string().optional(),
  })
  .refine((data) => data.q || data.tag, "q or tag is required");

const searchQuerySchema = offsetPaginationSchema.extend({
  q: z.string().min(1, "q is required and must be a non-empty string"),
  type: z.enum(["posts", "profiles", "pools"]).optional(),
});

export function createSearchRouter(db: Database): Router {
  const router = Router();

  router.get(
    "/posts",
    validateQuery(searchPostsQuerySchema),
    async (req: Request, res: Response): Promise<void> => {
      const { q, tag, limit, offset } = req.query as unknown as z.infer<
        typeof searchPostsQuerySchema
      >;

      const { posts, total } = await db.searchPosts({
        q,
        tag,
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

  router.get(
    "/",
    validateQuery(searchQuerySchema),
    async (req: Request, res: Response): Promise<void> => {
      const { q, type, limit, offset } = req.query as unknown as z.infer<
        typeof searchQuerySchema
      >;

      const result = await db.search({
        q,
        type: type as any,
        limit,
        offset,
      });

      const response: any = {
        total: result.total,
        limit,
        offset,
      };

      if (result.posts) {
        response.posts = result.posts.map((p: any) => ({
          ...p,
          id: p.id.toString(),
          tip_total: p.tip_total?.toString(),
          like_count: p.like_count?.toString(),
        }));
      }
      if (result.profiles) {
        response.profiles = result.profiles;
      }
      if (result.pools) {
        response.pools = result.pools.map((p: any) => ({
          ...p,
          balance: p.balance?.toString(),
        }));
      }

      res.json(response);
    }
  );

  return router;
}
