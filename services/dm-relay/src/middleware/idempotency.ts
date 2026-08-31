/**
 * Idempotency middleware for DM message submission.
 *
 * Clients must supply a UUID via the `X-Idempotency-Key` header on message
 * submission requests. A retried request with the same key replays the
 * cached response instead of being reprocessed, preventing duplicate
 * inbox entries, duplicate WebSocket pushes, and duplicate DB rows caused
 * by client retries (network timeout, crash, etc.) or replay attempts.
 *
 * The key is scoped to the authenticated sender address (set on `req` by
 * `messageAuthMiddleware`, which runs before this middleware). Without that
 * scoping, two different senders reusing the same client-generated key would
 * collide and one message would be silently dropped.
 */

import { createHash } from "crypto";
import { NextFunction, Request, Response } from "express";
import { Database } from "../database";
import { logger } from "../logger";

export const IDEMPOTENCY_KEY_HEADER = "x-idempotency-key";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A concurrent duplicate (same sender + key, still in flight) is polled
// briefly rather than immediately rejected, since the first request is
// usually milliseconds away from finishing.
const CONCURRENT_WAIT_ATTEMPTS = 20;
const CONCURRENT_WAIT_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Deterministically order object keys so payload equality doesn't depend on key order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b)
    );
    const result: Record<string, unknown> = {};
    for (const [k, v] of entries) result[k] = canonicalize(v);
    return result;
  }
  return value;
}

/** Fingerprint the request body so a reused (sender, key) pair with a different payload is detectable. */
function fingerprintRequestBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(body ?? {}))).digest("hex");
}

async function waitForCompletion(
  database: Database,
  senderAddress: string,
  key: string
): Promise<{ responseStatus: number; responseBody: unknown } | null> {
  for (let attempt = 0; attempt < CONCURRENT_WAIT_ATTEMPTS; attempt++) {
    await sleep(CONCURRENT_WAIT_MS);
    const result = await database.getIdempotencyResponse(senderAddress, key);
    if (result) return result;
  }
  return null;
}

/**
 * Enforce idempotent processing for the wrapped route. Must be mounted
 * directly on the message submission route (not as a broad path prefix),
 * since it intercepts and replays the JSON response. Must also be mounted
 * after `messageAuthMiddleware` so `req.stellarAddress` is set.
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const senderAddress = (req as any).stellarAddress as string | undefined;
    if (!senderAddress) {
      res.status(401).json({
        error: "Unauthorized",
        message: "Sender must be authenticated before an idempotency key can be claimed",
        requestId: req.requestId,
      });
      return;
    }

    const requestFingerprint = fingerprintRequestBody(req.body);

    let claim;
    try {
      claim = await database.claimIdempotencyKey(senderAddress, key, requestFingerprint);
    } catch (error) {
      logger.error({ err: error, senderAddress, key }, "Failed to claim idempotency key");
      res.status(500).json({
        error: "Internal Server Error",
        message: "Failed to process idempotency key",
        requestId: req.requestId,
      });
      return;
    }

    if (claim.status === "conflict") {
      res.status(409).json({
        error: "Conflict",
        message: `${IDEMPOTENCY_KEY_HEADER} was already used by this sender with a different request payload`,
        requestId: req.requestId,
      });
      return;
    }

    if (claim.status === "cached") {
      res.status(claim.responseStatus).json(claim.responseBody);
      return;
    }

    if (claim.status === "in_progress") {
      const cached = await waitForCompletion(database, senderAddress, key);
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
      database.completeIdempotencyKey(senderAddress, key, res.statusCode, body).catch((error) => {
        logger.error({ err: error, senderAddress, key }, "Failed to persist idempotency response");
      });
      return originalJson(body);
    }) as typeof res.json;

    next();
  };
}
