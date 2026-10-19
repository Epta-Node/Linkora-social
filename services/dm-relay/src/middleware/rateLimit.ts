/**
 * Rate limiting middleware — global per-sender + per-conversation (#1650)
 *
 * Error codes:
 *   429 { code: "RATE_LIMIT_SENDER" }       — global sender limit
 *   429 { code: "RATE_LIMIT_CONVERSATION" }  — per-(sender,recipient) limit
 */
import { Request, Response, NextFunction } from "express";

interface Bucket { count: number; resetAt: number }

function makeStore() {
  const map = new Map<string, Bucket>();
  return {
    consume(key: string, windowMs: number, max: number): { allowed: boolean; retryAfter?: number } {
      const now = Date.now();
      let b = map.get(key);
      if (!b || now >= b.resetAt) { map.set(key, { count: 1, resetAt: now + windowMs }); return { allowed: true }; }
      b.count++;
      if (b.count > max) return { allowed: false, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
      return { allowed: true };
    },
    prune() { const now = Date.now(); for (const [k, v] of map) if (now >= v.resetAt) map.delete(k); },
  };
}

const senderStore = makeStore();
const convStore   = makeStore();
setInterval(() => { senderStore.prune(); convStore.prune(); }, 10 * 60 * 1000);

export interface RateLimitConfig {
  senderWindowMs: number;
  senderMax: number;
  convWindowMs: number;
  convMax: number;
}

export function buildRateLimitMiddleware(cfg: RateLimitConfig) {
  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const sender: string | undefined = req.body?.sender;
    const recipient: string | undefined = req.body?.recipient;
    if (!sender) { next(); return; }

    const sr = senderStore.consume(sender, cfg.senderWindowMs, cfg.senderMax);
    if (!sr.allowed) {
      res.set("Retry-After", String(sr.retryAfter));
      res.status(429).json({ code: "RATE_LIMIT_SENDER", message: "Too many requests from this sender.", retryAfter: sr.retryAfter });
      return;
    }

    if (recipient) {
      const cr = convStore.consume(`${sender}:${recipient}`, cfg.convWindowMs, cfg.convMax);
      if (!cr.allowed) {
        res.set("Retry-After", String(cr.retryAfter));
        res.status(429).json({ code: "RATE_LIMIT_CONVERSATION", message: "Too many messages in this conversation.", retryAfter: cr.retryAfter });
        return;
      }
    }
    next();
  };
}
