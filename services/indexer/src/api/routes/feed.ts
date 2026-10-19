import { Router, Request, Response } from "express";
import { Pool } from "pg";
import type { QueryResult, QueryResultRow } from "pg";
import { Database } from "../../db";
import { getFeedPosts } from "../../handlers/post";
import { validateParams, validateQuery } from "../../middleware/validate";
import { z } from "zod";
import { stellarAddressSchema, cursorPaginationSchema } from "@linkora/types/src/schemas";
import { decodeNumericCursor, decodeTimestampCursor, encodeCursor } from "./cursor";

const exploreQuerySchema = cursorPaginationSchema.extend({
  // Opaque composite cursor (score, id) — see ./cursor.ts (#1329). A bare
  // numeric cursor is no longer accepted: `score` alone cannot order rows
  // that tie, which used to skip or duplicate them across pages.
  cursor: z.string().optional(),
  tag: z.string().optional(),
});

const followingFeedParamsSchema = z.object({
  address: stellarAddressSchema,
});

const followingFeedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  // Opaque composite cursor (created_at, id) — see ./cursor.ts (#1329).
  cursor: z.string().optional(),
  tag: z.string().optional(),
});

async function queryView<R extends QueryResultRow = QueryResultRow>(
  pg: Pool,
  text: string,
  params: unknown[]
): Promise<QueryResult<R>> {
  try {
    return await pg.query<R>(text, params);
  } catch (err) {
    const code = (err as { code?: unknown })?.code;
    const isTransient =
      code === "55P03" || code === "57014" || code === "40P01" || code === "40001";
    if (!isTransient) throw err;
    await new Promise((resolve) => setTimeout(resolve, 200));
    return await pg.query<R>(text, params);
  }
}

function isPgPool(target: Database | Pool): target is Pool {
  return "query" in target && typeof (target as Pool).query === "function";
}

export function createFeedRouter(dbOrPg: Database | Pool): Router {
  const router = Router();

  router.get("/", async (req: Request, res: Response): Promise<void> => {
    const viewer = typeof req.query.viewer === "string" ? req.query.viewer : undefined;
    const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : 20;
    const offset = typeof req.query.offset === "string" ? parseInt(req.query.offset, 10) : 0;
    const rawLimit = Number.isNaN(limit) ? 20 : limit;
    const rawOffset = Number.isNaN(offset) ? 0 : offset;

    if (isPgPool(dbOrPg)) {
      const posts = await getFeedPosts(dbOrPg, {
        viewerAddress: viewer,
        limit: rawLimit,
        offset: rawOffset,
      });
      res.json({
        posts,
        total: posts.length,
        limit: rawLimit,
        offset: rawOffset,
        has_more: posts.length === rawLimit,
      });
      return;
    }

    const db = dbOrPg as Database;
    if (db.getFeed) {
      const { posts, total } = await db.getFeed({ viewer, limit: rawLimit, offset: rawOffset });
      res.json({
        posts,
        total,
        limit: rawLimit,
        offset: rawOffset,
        has_more: rawOffset + posts.length < total,
      });
      return;
    }

    const blockedRes = viewer ? await db.getBlockedUsers(viewer, 1000, 0) : { blocked: [] };
    const blockedSet = new Set(blockedRes.blocked);

    const { posts, total } = await db.listPosts({ limit: rawLimit * 2, offset: rawOffset });
    const filteredPosts = posts.filter((p) => !blockedSet.has(p.author)).slice(0, rawLimit);

    res.json({
      posts: filteredPosts,
      total: Math.max(0, total - blockedSet.size),
      limit: rawLimit,
      offset: rawOffset,
      has_more: rawOffset + filteredPosts.length < total,
    });
  });

  router.get(
    "/explore",
    validateQuery(exploreQuerySchema),
    async (req: Request, res: Response): Promise<void> => {
      const { limit, cursor, tag } = req.query as unknown as z.infer<typeof exploreQuerySchema>;

      if (!isPgPool(dbOrPg)) {
        const offset = cursor !== undefined ? (decodeNumericCursor(cursor)?.value ?? 0) : 0;
        const { posts } = await (dbOrPg as Database).listPosts({ limit, offset });
        res.json({ posts, has_more: false, next_cursor: null });
        return;
      }

      let query = `
        SELECT 
          id,
          author,
          content,
          tags,
          tip_total,
          like_count,
          created_at,
          score
        FROM post_scores
        WHERE 1=1
      `;
      const params: (number | string)[] = [];
      let paramIndex = 1;

      if (tag) {
        query += ` AND $${paramIndex} = ANY(tags)`;
        params.push(tag.toLowerCase());
        paramIndex++;
      }

      if (cursor !== undefined) {
        const decoded = decodeNumericCursor(cursor);
        if (!decoded) {
          res.status(400).json({ error: "Invalid cursor" });
          return;
        }
        // Composite keyset: strictly orders rows that tie on `score` by `id`
        // too, so a tied boundary row is never skipped or repeated (#1329).
        query += ` AND (score, id) < ($${paramIndex}, $${paramIndex + 1})`;
        params.push(decoded.value, decoded.id);
        paramIndex += 2;
      }

      query += ` ORDER BY score DESC, id DESC LIMIT $${paramIndex}`;
      params.push(limit);

      const result = await queryView(dbOrPg, query, params);

      res.json({
        posts: result.rows.map((row) => ({
          id: row.id,
          author: row.author,
          content: row.content,
          tags: row.tags || [],
          tip_total: row.tip_total,
          like_count: row.like_count,
          created_at: row.created_at,
          score: row.score,
        })),
        has_more: result.rows.length === limit,
        next_cursor:
          result.rows.length > 0
            ? encodeCursor(
                String(result.rows[result.rows.length - 1].score),
                String(result.rows[result.rows.length - 1].id)
              )
            : null,
      });
    }
  );

  router.get(
    "/following/:address",
    validateParams(followingFeedParamsSchema),
    validateQuery(followingFeedQuerySchema),
    async (req: Request, res: Response): Promise<void> => {
      const address = req.params.address;
      const { limit, cursor, tag } = req.query as unknown as z.infer<
        typeof followingFeedQuerySchema
      >;

      if (!isPgPool(dbOrPg)) {
        const { posts } = await (dbOrPg as Database).listPosts({ limit, offset: 0 });
        res.json({ posts, has_more: false, next_cursor: null });
        return;
      }

      let query = `
        SELECT
          p.id,
          p.author,
          p.content,
          p.tags,
          p.tip_total,
          p.like_count,
          p.created_at
        FROM posts p
        INNER JOIN follows f ON p.author = f.followee
        WHERE f.follower = $1
          AND p.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM blocks WHERE blocker = $1 AND blocked = p.author)
          AND NOT EXISTS (SELECT 1 FROM blocks WHERE blocker = p.author AND blocked = $1)
      `;
      const params: unknown[] = [address];
      let paramIndex = 2;

      if (tag) {
        query += ` AND $${paramIndex} = ANY(p.tags)`;
        params.push(tag.toLowerCase());
        paramIndex++;
      }

      if (cursor !== undefined) {
        const decoded = decodeTimestampCursor(cursor);
        if (!decoded) {
          res.status(400).json({ error: "Invalid cursor" });
          return;
        }
        // Composite keyset: strictly orders rows that tie on `created_at` by
        // `id` too, so a tied boundary row is never skipped or repeated (#1329).
        query += ` AND (p.created_at, p.id) < ($${paramIndex}, $${paramIndex + 1})`;
        params.push(decoded.value, decoded.id);
        paramIndex += 2;
      }

      query += ` ORDER BY p.created_at DESC, p.id DESC LIMIT $${paramIndex}`;
      params.push(limit);

      const result = await queryView(dbOrPg, query, params);

      res.json({
        posts: result.rows.map((row) => ({
          id: row.id,
          author: row.author,
          content: row.content,
          tags: row.tags || [],
          tip_total: row.tip_total,
          like_count: row.like_count,
          created_at: row.created_at,
        })),
        has_more: result.rows.length === limit,
        next_cursor:
          result.rows.length > 0
            ? encodeCursor(
                new Date(result.rows[result.rows.length - 1].created_at).toISOString(),
                String(result.rows[result.rows.length - 1].id)
              )
            : null,
      });
    }
  );

  return router;
}
