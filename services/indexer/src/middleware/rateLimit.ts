import { Request, Response, NextFunction } from "express";
import { logger } from "../logger";
import { rateLimitedError } from "@linkora/types/src/errors";

const RATE_LIMIT_ANON_RPM = parseInt(process.env.RATE_LIMIT_ANON_RPM || "100", 10);
const RATE_LIMIT_AUTH_RPM = parseInt(process.env.RATE_LIMIT_AUTH_RPM || "300", 10);
const RATE_LIMIT_WRITE_RPM = parseInt(process.env.RATE_LIMIT_WRITE_RPM || "50", 10);
const WINDOW_MS = 60_000;

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

    window.requests = window.requests.filter((time) => now - time < WINDOW_MS);

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

    window.requests = window.requests.filter((time) => now - time < WINDOW_MS);
    return window.requests.length;
  }
}

const limiter = new RateLimiter();

function getClientIP(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || "unknown";
}

function isWriteEndpoint(path: string, method: string): boolean {
  return ["POST", "PUT", "DELETE", "PATCH"].includes(method);
}

export function rateLimitRead(req: Request, res: Response, next: NextFunction): void {
  const ip = getClientIP(req);
  const limit = req.context?.stellarAddress ? RATE_LIMIT_AUTH_RPM : RATE_LIMIT_ANON_RPM;

  if (limiter.isAllowed(ip, limit)) {
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
      limit,
    },
    "Rate limit exceeded for read endpoint"
  );

  const err = rateLimitedError("Too many requests. Please retry after the indicated delay.");
  res
    .status(err.statusCode)
    .set("Retry-After", String(retryAfterSeconds))
    .json({
      error: {
        ...err.toJSON(req.context?.requestId).error,
        retryAfterSeconds,
      },
    });
}

export function rateLimitWrite(req: Request, res: Response, next: NextFunction): void {
  const key = req.context?.stellarAddress || getClientIP(req);
  const limit = req.context?.stellarAddress ? RATE_LIMIT_AUTH_RPM : RATE_LIMIT_WRITE_RPM;

  if (limiter.isAllowed(key, limit)) {
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
      limit,
    },
    "Rate limit exceeded for write endpoint"
  );

  const err = rateLimitedError("Too many requests. Please retry after the indicated delay.");
  res
    .status(err.statusCode)
    .set("Retry-After", String(retryAfterSeconds))
    .json({
      error: {
        ...err.toJSON(req.context?.requestId).error,
        retryAfterSeconds,
      },
    });
}

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  if (isWriteEndpoint(req.path, req.method)) {
    rateLimitWrite(req, res, next);
  } else {
    rateLimitRead(req, res, next);
  }
}

export function resetRateLimiter(): void {
  const l = limiter as unknown as { windows: Map<string, RateWindow> };
  l.windows.clear();
}

export { RateLimiter };
export const getRateLimiterInstance = () => limiter;
