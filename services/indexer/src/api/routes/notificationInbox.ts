/**
 * Notification inbox (issue #1632).
 *
 * The inbox is derived from the indexed domain tables rather than stored
 * separately: a recipient's notifications are the follows of them and the
 * likes and tips on their (non-deleted) posts, excluding their own actions.
 * Read state is the recipient's "mark all as read" watermark in
 * `notification_read_state`; reading a single item is tracked client-side so
 * it never needs a signed request per click.
 *
 * Notification ids are stable and match the ids the web client derives from
 * live WebSocket events, so a page fetched here never duplicates an item that
 * already arrived live:
 *
 *   follow:<follower>            like:<post_id>:<liker>            tip:<tx_hash>
 *
 * Pagination uses the composite `(created_at, id)` keyset cursor from
 * ./cursor.ts, so items sharing a timestamp are never skipped or repeated.
 * Listing is public — follows, likes and tips are public on-chain data — while
 * moving the watermark requires a StellarSig signature from the recipient.
 */

import { Router, Request, Response } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import { stellarAddressSchema } from "@linkora/types/src/schemas";
import { internalError, unauthorizedError, validationError } from "@linkora/types/src/errors";
import { requireStellarAuth } from "../../middleware/stellarAuth";
import { rateLimitWrite } from "../../middleware/rateLimit";
import { validateParams, validateQuery } from "../../middleware/validate";
import { decodeTimestampCursor, encodeCursor } from "./cursor";

const EXCERPT_LENGTH = 60;

const inboxParamsSchema = z.object({ address: stellarAddressSchema });
const inboxQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

interface InboxRow {
  id: string;
  type: "follow" | "like" | "tip";
  actor: string;
  post_id: string | null;
  amount: string | null;
  excerpt: string | null;
  created_at: Date;
  read: boolean;
}

/**
 * Inbox query. $1 recipient, $2/$3 cursor (created_at, id) or NULL, $4 page
 * size + 1 (the extra row only signals `has_more`).
 */
export const INBOX_QUERY = `
  WITH items AS (
    SELECT 'follow:' || f.follower AS id, 'follow' AS type, f.follower AS actor,
           NULL::bigint AS post_id, NULL::bigint AS amount, NULL::text AS excerpt,
           to_timestamp(f.created_at) AS created_at
      FROM follows f
     WHERE f.followee = $1 AND f.follower <> $1
    UNION ALL
    SELECT 'like:' || l.post_id || ':' || l.user_address, 'like', l.user_address,
           l.post_id, NULL::bigint, LEFT(p.content, ${EXCERPT_LENGTH}),
           l.created_at AT TIME ZONE 'UTC'
      FROM likes l
      JOIN posts p ON p.id = l.post_id
     WHERE p.author = $1 AND p.deleted_at IS NULL AND l.user_address <> $1
    UNION ALL
    SELECT 'tip:' || t.tx_hash, 'tip', t.tipper,
           t.post_id, t.amount, LEFT(p.content, ${EXCERPT_LENGTH}),
           t.created_at AT TIME ZONE 'UTC'
      FROM tips t
      JOIN posts p ON p.id = t.post_id
     WHERE p.author = $1 AND p.deleted_at IS NULL AND t.tipper <> $1
  )
  SELECT i.id, i.type, i.actor, i.post_id::text AS post_id, i.amount::text AS amount,
         i.excerpt, i.created_at,
         COALESCE(i.created_at <= rs.read_through, FALSE) AS read
    FROM items i
    LEFT JOIN notification_read_state rs ON rs.address = $1
   WHERE $2::timestamptz IS NULL OR (i.created_at, i.id) < ($2::timestamptz, $3::text)
   ORDER BY i.created_at DESC, i.id DESC
   LIMIT $4
`;

function sendError(req: Request, res: Response, err: ReturnType<typeof internalError>) {
  res.status(err.statusCode).json(err.toJSON(req.context?.requestId));
}

export function createNotificationInboxRouter(pg: Pick<Pool, "query">): Router {
  const router = Router();

  router.post(
    "/read-all",
    requireStellarAuth,
    rateLimitWrite,
    async (req: Request, res: Response): Promise<void> => {
      const address = req.context?.stellarAddress;
      if (!address) {
        sendError(req, res, unauthorizedError("Unauthorized"));
        return;
      }
      try {
        const result = await pg.query<{ read_through: Date }>(
          `INSERT INTO notification_read_state (address, read_through)
           VALUES ($1, NOW())
           ON CONFLICT (address) DO UPDATE
             SET read_through = GREATEST(notification_read_state.read_through, EXCLUDED.read_through),
                 updated_at = NOW()
           RETURNING read_through`,
          [address]
        );
        res.json({ read_through: result.rows[0]?.read_through });
      } catch {
        sendError(req, res, internalError("Failed to mark notifications as read"));
      }
    }
  );

  router.get(
    "/:address",
    validateParams(inboxParamsSchema),
    validateQuery(inboxQuerySchema),
    async (req: Request, res: Response): Promise<void> => {
      const { address } = req.params;
      const { limit, cursor } = req.query as unknown as z.infer<typeof inboxQuerySchema>;

      let after: { value: Date; id: string } | null = null;
      if (cursor !== undefined) {
        after = decodeTimestampCursor(cursor);
        if (!after) {
          sendError(req, res, validationError("Invalid cursor"));
          return;
        }
      }

      try {
        const result = await pg.query<InboxRow>(INBOX_QUERY, [
          address,
          after ? after.value.toISOString() : null,
          after ? after.id : null,
          limit + 1,
        ]);
        const rows = result.rows.slice(0, limit);
        const hasMore = result.rows.length > limit;
        const last = rows[rows.length - 1];
        res.json({
          notifications: rows.map((row) => ({
            id: row.id,
            type: row.type,
            actor: row.actor,
            post_id: row.post_id === null ? null : Number(row.post_id),
            amount: row.amount,
            excerpt: row.excerpt,
            created_at: new Date(row.created_at).toISOString(),
            read: Boolean(row.read),
          })),
          has_more: hasMore,
          next_cursor:
            hasMore && last ? encodeCursor(new Date(last.created_at).toISOString(), last.id) : null,
        });
      } catch {
        sendError(req, res, internalError("Failed to load notifications"));
      }
    }
  );

  return router;
}
