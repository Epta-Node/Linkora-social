/**
 * Per-IP rate limiting middleware for the analytics oracle.
 *
 * In-memory sliding window limiter keyed by client IP. Protects the oracle's
 * attestation submission endpoint from being flooded, which could exhaust the
 * oracle signing key, burn Stellar RPC rate limits, or overload the database.
 *
 * Configuration is read from `ORACLE_RATE_LIMIT_*` env vars (see config.ts).
 */

import { Request, Response, NextFunction } from "express";
import { logger } from "../logger.js";
import { oracleRateLimitConfig } from "../config.js";

interface RateWindow {
  requests: number[];
}

export class RateLimiter {
  private windows = new Map<string, RateWindow>();

  constructor(
    private windowMs: number,
    private maxRequests: number
  ) {}

  isAllowed(key: string): boolean {
    const now = Date.now();
    const window = this.windows.get(key);

    if (!window) {
      this.windows.set(key, { requests: [now] });
      return true;
    }

    window.requests = window.requests.filter((time) => now - time < this.windowMs);

    if (window.requests.length < this.maxRequests) {
      window.requests.push(now);
      return true;
    }

    return false;
  }

  getRetryAfterSeconds(key: string): number {
    const now = Date.now();
    const window = this.windows.get(key);

    if (!window || window.requests.length === 0) {
      return Math.ceil(this.windowMs / 1000);
    }

    const oldestRequest = Math.min(...window.requests);
    const remainingMs = Math.max(0, this.windowMs - (now - oldestRequest));
    return Math.ceil(remainingMs / 1000);
  }

  reset(): void {
    this.windows.clear();
  }
}

function getClientIP(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || "unknown";
}

const limiter = new RateLimiter(oracleRateLimitConfig.windowMs, oracleRateLimitConfig.maxRequests);

/** Per-IP rate limiting middleware. Bypasses IPs configured in ORACLE_RATE_LIMIT_BYPASS_IPS. */
export function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const ip = getClientIP(req);

  if (oracleRateLimitConfig.bypassIps.includes(ip)) {
    next();
    return;
  }

  if (limiter.isAllowed(ip)) {
    next();
    return;
  }

  const retryAfterSeconds = limiter.getRetryAfterSeconds(ip);

  logger.warn(
    { ipAddress: ip, endpoint: req.path, limit: oracleRateLimitConfig.maxRequests },
    "Rate limit exceeded for oracle endpoint"
  );

  res
    .status(429)
    .set("Retry-After", String(retryAfterSeconds))
    .json({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests",
        details: { retryAfterSeconds },
      },
    });
}

/** Reset limiter state (for tests). */
export function resetRateLimiter(): void {
  limiter.reset();
}

export function getRateLimiterInstance(): RateLimiter {
  return limiter;
}
