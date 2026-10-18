/**
 * Rate limiting middleware — global per-sender and per-conversation (#1650).
 *
 * Two layers:
 *  1. globalSenderLimit  — existing limit: N requests per sender per window
 *  2. conversationLimit  — new: N messages per (sender, recipient) per window
 *
 * Both limits use in-process Maps so no extra infra is needed.
 * Swap for Redis if horizontal scaling is required.
 *
 * Error codes:
 *   429 + { code: "RATE_LIMIT_SENDER" }       — global sender limit hit
 *   429 + { code: "RATE_LIMIT_CONVERSATION" }  — per-conversation limit hit
 */

import { Request, Response, NextFunction } from "express";

interface BucketEntry {
  count: number;
  resetAt: number;
}

function makeStore() {
  const map = new Map<string, BucketEntry>();

  return {
    /**
     * Increment the counter for `key`.
     * Returns { allowed: true } when under the limit,
     * or { allowed: false, retryAfter } when over.
     */
    consume(key: string, windowMs: number, max: number): { allowed: boolean; retryAfter?: number } {
      const now = Date.now();
      let entry = map.get(key);

      if (!entry || now >= entry.resetAt) {
        entry = { count: 1, resetAt: now + windowMs };
        map.set(key, entry);
        return { allowed: true };
      }

      entry.count += 1;

      if (entry.count > max) {
        return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
      }

      return { allowed: true };
    },

    /** Remove expired entries to prevent unbounded memory growth. */
    prune() {
      const now = Date.now();
      for (const [k, v] of map.entries()) {
        if (now >= v.resetAt) map.delete(k);
      }
    },
  };
}

const senderStore = makeStore();
const conversationStore = makeStore();

// Prune stale buckets every 10 minutes
setInterval(() => {
  senderStore.prune();
  conversationStore.prune();
}, 10 * 60 * 1000);

export interface RateLimitConfig {
  /** Window duration in ms for the global per-sender limit */
  senderWindowMs: number;
  /** Max requests per sender per window */
  senderMax: number;
  /** Window duration in ms for the per-conversation limit */
  convWindowMs: number;
  /** Max messages per (sender, recipient) per window */
  convMax: number;
}

/**
 * Build the combined rate-limit middleware.
 *
 * Expects:
 *   req.body.sender    — Stellar address of the message sender
 *   req.body.recipient — Stellar address of the recipient
 */
export function buildRateLimitMiddleware(cfg: RateLimitConfig) {
  return function rateLimitMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const sender: string | undefined = req.body?.sender;
    const recipient: string | undefined = req.body?.recipient;

    if (!sender) {
      // Let the route handler deal with validation
      next();
      return;
    }

    // 1. Global per-sender limit
    const senderResult = senderStore.consume(
      sender,
      cfg.senderWindowMs,
      cfg.senderMax
    );

    if (!senderResult.allowed) {
      res.set("Retry-After", String(senderResult.retryAfter));
      res.status(429).json({
        code: "RATE_LIMIT_SENDER",
        message: "Too many requests from this sender.",
        retryAfter: senderResult.retryAfter,
      });
      return;
    }

    // 2. Per-conversation limit (only when recipient is present)
    if (recipient) {
      const convKey = `${sender}:${recipient}`;
      const convResult = conversationStore.consume(
        convKey,
        cfg.convWindowMs,
        cfg.convMax
      );

      if (!convResult.allowed) {
        res.set("Retry-After", String(convResult.retryAfter));
        res.status(429).json({
          code: "RATE_LIMIT_CONVERSATION",
          message: "Too many messages in this conversation.",
          retryAfter: convResult.retryAfter,
        });
        return;
      }
    }

    next();
  };
}
