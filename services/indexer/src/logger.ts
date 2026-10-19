import pino from "pino";
import { v4 as uuidv4 } from "uuid";
import { Request, Response, NextFunction } from "express";

// ── Logger setup ──────────────────────────────────────────────────────────────

const isDev = process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";

const pinoLogger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { service: "indexer" },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, ignore: "pid,hostname", translateTime: "SYS:standard" },
    },
  }),
});

export const logger = pinoLogger;

// ── Request context with request ID ───────────────────────────────────────────

interface RequestContext {
  requestId: string;
  startTime: number;
  stellarAddress?: string;
  userId?: string;
  ipAddress?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      context?: RequestContext;
    }
  }
}

// ── Abuse tracking (simple in-memory store) ──────────────────────────────────

export interface AbuseEntry {
  count: number;
  windowStart: number;
}

export const MAX_ABUSE_ENTRIES = 1000;
export const ABUSE_THRESHOLD = 5; // 5 429s in 60s = abuse
export const ABUSE_WINDOW_MS = 60_000;

export const abuseTracker = new Map<string, AbuseEntry>();

export function clearAbuseTracker(): void {
  abuseTracker.clear();
}

export function recordAbuseAttempt(ipAddress: string): void {
  const now = Date.now();
  const entry = abuseTracker.get(ipAddress);

  if (!entry || now - entry.windowStart > ABUSE_WINDOW_MS) {
    if (!entry && abuseTracker.size >= MAX_ABUSE_ENTRIES) {
      // First pass: clean up expired entries
      for (const [key, val] of abuseTracker.entries()) {
        if (now - val.windowStart > ABUSE_WINDOW_MS) {
          abuseTracker.delete(key);
        }
      }
      // If still at or over capacity, evict the oldest entry (LRU)
      if (abuseTracker.size >= MAX_ABUSE_ENTRIES) {
        const oldestKey = abuseTracker.keys().next().value;
        if (oldestKey !== undefined) {
          abuseTracker.delete(oldestKey);
        }
      }
    }
    abuseTracker.set(ipAddress, { count: 1, windowStart: now });
  } else {
    entry.count++;
    // Re-insert to keep LRU order updated
    abuseTracker.delete(ipAddress);
    abuseTracker.set(ipAddress, entry);
    if (entry.count > ABUSE_THRESHOLD) {
      logger.error(
        {
          ipAddress,
          count: entry.count,
          windowSeconds: Math.floor(ABUSE_WINDOW_MS / 1000),
        },
        "Abuse pattern detected: excessive 429 responses"
      );
    }
  }
}

import { getClientIP } from "./middleware/rateLimit";

// ── Request logging middleware ────────────────────────────────────────────────

export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = uuidv4();
  const startTime = Date.now();

  const ipAddress = getClientIP(req);

  req.context = { requestId, startTime, ipAddress };

  logger.info({ requestId, method: req.method, path: req.path, ipAddress }, "Incoming request");

  // Capture the response end to log completion
  const originalSend = res.send;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res.send = function (data: any) {
    const duration = Date.now() - startTime;
    const userId = req.context?.stellarAddress ?? req.context?.userId;
    const logData = {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      ipAddress,
      ...(userId && { userId }),
    };

    if (duration > 500) {
      logger.warn(logData, "Slow request");
    } else {
      logger.info(logData, "Request completed");
    }

    if (res.statusCode === 429) {
      recordAbuseAttempt(ipAddress);
    }

    return originalSend.call(this, data);
  };

  next();
}

// ── Health check state ────────────────────────────────────────────────────────

interface HealthState {
  dbConnected: boolean;
  rpcConnected: boolean;
  startTime: number;
}

export const healthState: HealthState = {
  dbConnected: false,
  rpcConnected: false,
  startTime: Date.now(),
};

export function getHealth() {
  const uptime = Math.floor((Date.now() - healthState.startTime) / 1000);
  return {
    status: healthState.dbConnected && healthState.rpcConnected ? "ok" : "degraded",
    uptime,
    dbConnected: healthState.dbConnected,
    rpcConnected: healthState.rpcConnected,
  };
}

export default logger;
