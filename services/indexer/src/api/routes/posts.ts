import { Router, Request, Response } from "express";
import { Database } from "../../db";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

export function createPostsRouter(db: Database): Router {
  const router = Router();

  /**
   * GET /posts?author=<address>&limit=<n>&cursor=<id>
   * Lists posts with optional author filter and cursor-based pagination.
   * Response includes nextCursor (null when no more pages).
   * Legacy ?offset parameter is ignored; clients should migrate to ?cursor.
   */
  router.get("/", async (req: Request, res: Response): Promise<void> => {
    const author = typeof req.query.author === "string" ? req.query.author : undefined;

    const rawLimit = req.query.limit !== undefined ? Number(req.query.limit) : DEFAULT_LIMIT;
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;

    if (!Number.isInteger(rawLimit) || rawLimit < 1) {
      res.status(400).json({ error: "limit must be a positive integer", code: "INVALID_QUERY" });
      return;
    }
    if (rawLimit > MAX_LIMIT) {
      res.status(400).json({ error: `limit cannot exceed ${MAX_LIMIT}`, code: "LIMIT_EXCEEDED" });
      return;
    }

    const { posts, nextCursor } = await db.listPosts({ author, limit: rawLimit, cursor });
    res.json({
      posts,
      nextCursor,
      limit: rawLimit,
    });
  });

  /**
   * GET /posts/:id
   * Returns a single post by its numeric ID.
   */
  router.get("/:id", async (req: Request, res: Response): Promise<void> => {
    const rawId = req.params.id;

    let postId: bigint;
    try {
      postId = BigInt(rawId);
      if (postId < BigInt(0)) throw new Error();
    } catch {
      res.status(400).json({ error: "id must be a non-negative integer", code: "INVALID_ID" });
      return;
    }

    const post = await db.getPost(postId);
    if (!post) {
      res.status(404).json({ error: "Post not found", code: "NOT_FOUND" });
      return;
    }

    res.json(post);
  });

  return router;
}
