import { Router, Request, Response } from "express";
import { Pool } from "pg";
import { z } from "zod";
import { Database } from "../../db";
import { validateQuery } from "../../middleware/validate";
import { getClientIP } from "../../middleware/rateLimit";
import { cursorPaginationSchema } from "@linkora/types/src/schemas";
import { internalError } from "@linkora/types/src/errors";

const replayQuerySchema = z.object({
  fromLedger: z.coerce.number().int().positive(),
  toLedger: z.coerce.number().int().positive(),
  types: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      if (Array.isArray(val)) return val;
      return [val];
    }),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

// Simple in-memory rate limiter for replay (1 req/min per IP)
const replayRateLimit = new Map<string, number>();

export function createEventsReplayRouter(pg: Pool): Router {
  const router = Router();

  router.get(
    "/replay",
    validateQuery(replayQuerySchema),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const clientIp = getClientIP(req);
        const now = Date.now();
        const lastRequest = replayRateLimit.get(clientIp);
        if (lastRequest && now - lastRequest < 60000) {
          res.status(429).json({ error: "Rate limit exceeded. 1 request per minute allowed." });
          return;
        }
        replayRateLimit.set(clientIp, now);

        const { fromLedger, toLedger, types, cursor, limit } = req.query as unknown as z.infer<
          typeof replayQuerySchema
        >;

        if (fromLedger > toLedger) {
          res.status(400).json({ error: "fromLedger must be <= toLedger" });
          return;
        }

        let query = `
          SELECT id, ledger_sequence, event_index, contract_id, topic, data, processed_at
          FROM raw_events
          WHERE ledger_sequence >= $1 AND ledger_sequence <= $2
        `;
        const params: any[] = [fromLedger, toLedger];
        let paramIndex = 3;

        if (types && types.length > 0) {
          query += ` AND topic && $${paramIndex}::text[]`;
          params.push(types);
          paramIndex++;
        }

        if (cursor) {
          // Simple cursor implementation
          try {
            const decoded = Buffer.from(cursor, "base64").toString();
            const [cursorLedger, cursorIndex] = decoded.split(":");
            query += ` AND (ledger_sequence > $${paramIndex} OR (ledger_sequence = $${paramIndex + 1} AND event_index > $${paramIndex + 2}))`;
            params.push(cursorLedger, cursorLedger, cursorIndex);
            paramIndex += 3;
          } catch (e) {
            // ignore invalid cursor
          }
        }

        query += ` ORDER BY ledger_sequence ASC, event_index ASC LIMIT $${paramIndex}`;
        params.push(limit + 1);

        const result = await pg.query(query, params);
        const events = result.rows.slice(0, limit);
        const hasMore = result.rows.length > limit;

        // Stream as NDJSON
        res.setHeader("Content-Type", "application/x-ndjson");
        res.setHeader("Transfer-Encoding", "chunked");

        for (let i = 0; i < events.length; i++) {
          const event = events[i];
          const eventObj = {
            id: event.id,
            ledger_sequence: event.ledger_sequence,
            event_index: event.event_index,
            contract_id: event.contract_id,
            topic: event.topic,
            data: event.data,
            processed_at: event.processed_at,
          };
          res.write(JSON.stringify(eventObj) + "\n");
        }

        if (hasMore && events.length > 0) {
          const lastEvent = events[events.length - 1];
          const nextCursor = Buffer.from(
            `${lastEvent.ledger_sequence}:${lastEvent.event_index}`
          ).toString("base64");
          // Send cursor as a final line with metadata
          res.write(JSON.stringify({ _cursor: nextCursor, _has_more: true }) + "\n");
        }

        res.end();
      } catch (error) {
        res.status(500).json({ error: "Failed to replay events" });
      }
    }
  );

  return router;
}

const listEventsQuerySchema = cursorPaginationSchema.extend({
  contract_id: z.string().min(1).optional(),
  topic: z.string().min(1).optional(),
});

export function createEventsRouter(db: Database): Router {
  const router = Router();

  /**
   * GET /api/events
   *
   * Returns a cursor-paginated list of raw on-chain events from `raw_events`,
   * sorted newest-first by (ledger_sequence DESC, event_index DESC).
   *
   * Query params:
   *   limit       — 1–100, default 20
   *   cursor      — opaque base64 token from a previous response's `next_cursor`
   *   contract_id — filter to a single contract address
   *   topic       — filter by first topic value (exact match)
   *
   * The composite keyset cursor `(ledger_sequence, event_index)` guarantees no
   * skipped or duplicated rows when new events are ingested between requests.
   */
  router.get(
    "/",
    validateQuery(listEventsQuerySchema),
    async (req: Request, res: Response): Promise<void> => {
      const { limit, cursor, contract_id, topic } = req.query as unknown as z.infer<
        typeof listEventsQuerySchema
      >;

      try {
        const { events, nextCursor } = await db.listEventsCursor({
          limit,
          cursor: cursor || undefined,
          contract_id: contract_id || undefined,
          topic: topic || undefined,
        });

        res.json({
          events: events.map((e) => ({
            ...e,
            id: e.id.toString(),
          })),
          limit,
          cursor: cursor ?? null,
          next_cursor: nextCursor,
          has_more: nextCursor !== null,
        });
      } catch {
        const err = internalError("Failed to fetch events");
        res.status(err.statusCode).json(err.toJSON(req.context?.requestId));
      }
    }
  );

  return router;
}
