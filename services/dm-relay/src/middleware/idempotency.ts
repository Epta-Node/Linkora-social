/**
 * Idempotency middleware for DM message submission.
 *
 * Clients must supply a UUID via the `X-Idempotency-Key` header on message
 * submission requests. A retried request with the same key replays the
 * cached response instead of being reprocessed, preventing duplicate
 * inbox entries, duplicate WebSocket pushes, and duplicate DB rows caused
 * by client retries (network timeout, crash, etc.) or replay attempts.
 */

import { NextFunction, Request, Response } from "express";
import { Database } from "../database";
import { logger } from "../logger";

export const IDEMPOTENCY_KEY_HEADER = "x-idempotency-key";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A concurrent duplicate (same key, still in flight) is polled briefly
// rather than immediately rejected, since the first request is usually
// milliseconds away from finishing.
const CONCURRENT_WAIT_ATTEMPTS = 20;
const CONCURRENT_WAIT_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCompletion(
  database: Database,
  key: string
): Promise<{ responseStatus: number; responseBody: unknown } | null> {
  for (let attempt = 0; attempt < CONCURRENT_WAIT_ATTEMPTS; attempt++) {
    await sleep(CONCURRENT_WAIT_MS);
    const result = await database.getIdempotencyResponse(key);
    if (result) return result;
  }
  return null;
}

/**
 * Enforce idempotent processing for the wrapped route. Must be mounted
 * directly on the message submission route (not as a broad path prefix),
 * since it intercepts and replays the JSON response.
 */
export function idempotencyMiddleware(database: Database) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = req.header(IDEMPOTENCY_KEY_HEADER);

    if (!key) {
      res.status(400).json({
        error: "Bad Request",
        message: `Missing required ${IDEMPOTENCY_KEY_HEADER} header`,
        requestId: req.requestId,
      });
      return;
    }

    if (!UUID_RE.test(key)) {
      res.status(400).json({
        error: "Bad Request",
        message: `${IDEMPOTENCY_KEY_HEADER} must be a valid UUID`,
        requestId: req.requestId,
      });
      return;
    }

    let claim;
    try {
      claim = await database.claimIdempotencyKey(key);
    } catch (error) {
      logger.error({ err: error, key }, "Failed to claim idempotency key");
      res.status(500).json({
        error: "Internal Server Error",
        message: "Failed to process idempotency key",
        requestId: req.requestId,
      });
      return;
    }

    if (claim.status === "cached") {
      res.status(claim.responseStatus).json(claim.responseBody);
      return;
    }

    if (claim.status === "in_progress") {
      const cached = await waitForCompletion(database, key);
      if (cached) {
        res.status(cached.responseStatus).json(cached.responseBody);
      } else {
        res.status(409).json({
          error: "Conflict",
          message: "A request with this idempotency key is still being processed",
          requestId: req.requestId,
        });
      }
      return;
    }

    // claim.status === "claimed" — this request owns processing. Capture
    // whatever response the route handler produces so retries can replay it.
    const originalJson = res.json.bind(res);
    res.json = ((body?: unknown) => {
      database.completeIdempotencyKey(key, res.statusCode, body).catch((error) => {
        logger.error({ err: error, key }, "Failed to persist idempotency response");
      });
      return originalJson(body);
    }) as typeof res.json;

    next();
  };
}
