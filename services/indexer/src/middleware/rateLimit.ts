import { Request, Response, NextFunction } from "express";
import { logger } from "../logger";

// ── Configuration ─────────────────────────────────────────────────────────────

const RATE_LIMIT_READ_RPM = parseInt(process.env.RATE_LIMIT_READ_RPM || "60", 10);
const RATE_LIMIT_WRITE_RPM = parseInt(process.env.RATE_LIMIT_WRITE_RPM || "10", 10);
const WINDOW_MS = 60_000; // 1 minute

// ── In-memory sliding window implementation ────────────────────────────────────

interface RateWindow {
  requests: number[];
}

class RateLimiter {
  private windows = new Map<string, RateWindow>();

  isAllowed(key: string, limit: number): boolean {
    const now = Date.now();
    const window = this.windows.get(key);

    if (!window) {
      this.windows.set(key, { requests: [now] });
      return true;
    }

    // Remove expired requests outside the window
    window.requests = window.requests.filter((time) => now - time < WINDOW_MS);

    // Check if we're under the limit
    if (window.requests.length < limit) {
      window.requests.push(now);
      return true;
    }

    return false;
  }

  getRemainingTime(key: string): number {
    const now = Date.now();
    const window = this.windows.get(key);

    if (!window || window.requests.length === 0) {
      return WINDOW_MS;
    }

    const oldestRequest = Math.min(...window.requests);
    return Math.max(0, WINDOW_MS - (now - oldestRequest));
  }

  getRequestCount(key: string): number {
    const now = Date.now();
    const window = this.windows.get(key);

    if (!window) {
      return 0;
    }

    // Clean expired requests
    window.requests = window.requests.filter((time) => now - time < WINDOW_MS);
    return window.requests.length;
  }
}

const limiter = new RateLimiter();

// ── Helper: extract IP address ─────────────────────────────────────────────────

function getClientIP(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || "unknown";
}

// ── Helper: determine if endpoint is write ────────────────────────────────────

function isWriteEndpoint(path: string, method: string): boolean {
  // POST, PUT, DELETE, PATCH are write methods
  return ["POST", "PUT", "DELETE", "PATCH"].includes(method);
}

// ── Rate limit middleware for read endpoints ──────────────────────────────────

export function rateLimitRead(req: Request, res: Response, next: NextFunction): void {
  const ip = getClientIP(req);

  if (limiter.isAllowed(ip, RATE_LIMIT_READ_RPM)) {
    next();
    return;
  }

  const retryAfterMs = limiter.getRemainingTime(ip);
  const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

  logger.warn(
    {
      requestId: req.context?.requestId,
      ipAddress: ip,
      endpoint: req.path,
      limit: RATE_LIMIT_READ_RPM,
    },
    "Rate limit exceeded for read endpoint"
  );

  res.status(429).set("Retry-After", String(retryAfterSeconds)).json({
    error: "Too many requests. Please retry after the indicated delay.",
    code: "RATE_LIMIT_EXCEEDED",
    retryAfterSeconds,
  });
}

// ── Rate limit middleware for write endpoints ──────────────────────────────────

export function rateLimitWrite(req: Request, res: Response, next: NextFunction): void {
  // For write endpoints, use stellar address as key if available, otherwise fall back to IP
  const key = req.context?.stellarAddress || getClientIP(req);

  if (limiter.isAllowed(key, RATE_LIMIT_WRITE_RPM)) {
    next();
    return;
  }

  const retryAfterMs = limiter.getRemainingTime(key);
  const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

  logger.warn(
    {
      requestId: req.context?.requestId,
      identifier: key,
      endpoint: req.path,
      limit: RATE_LIMIT_WRITE_RPM,
    },
    "Rate limit exceeded for write endpoint"
  );

  res.status(429).set("Retry-After", String(retryAfterSeconds)).json({
    error: "Too many requests. Please retry after the indicated delay.",
    code: "RATE_LIMIT_EXCEEDED",
    retryAfterSeconds,
  });
}

// ── Unified rate limit middleware (auto-detects read vs write) ────────────────

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  if (isWriteEndpoint(req.path, req.method)) {
    rateLimitWrite(req, res, next);
  } else {
    rateLimitRead(req, res, next);
  }
}

// ── Reset limiter state (for tests) ──────────────────────────────────────────

export function resetRateLimiter(): void {
  const l = limiter as unknown as { windows: Map<string, RateWindow> };
  l.windows.clear();
}

// ── Export the limiter for testing ─────────────────────────────────────────────

export { RateLimiter };
export const getRateLimiterInstance = () => limiter;
