import pino from "pino";
import { v4 as uuidv4 } from "uuid";
import { Request, Response, NextFunction } from "express";

// ── Logger setup ──────────────────────────────────────────────────────────────

const isDev = process.env.NODE_ENV !== "production";

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

interface AbuseEntry {
  count: number;
  windowStart: number;
}

const abuseTracker = new Map<string, AbuseEntry>();
const ABUSE_THRESHOLD = 5; // 5 429s in 60s = abuse
const ABUSE_WINDOW_MS = 60_000;

function recordAbuseAttempt(ipAddress: string): void {
  const now = Date.now();
  const entry = abuseTracker.get(ipAddress);

  if (!entry || now - entry.windowStart > ABUSE_WINDOW_MS) {
    abuseTracker.set(ipAddress, { count: 1, windowStart: now });
  } else {
    entry.count++;
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

// ── Request logging middleware ────────────────────────────────────────────────

export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = uuidv4();
  const startTime = Date.now();

  // Determine IP address (respect X-Forwarded-For behind proxy)
  let ipAddress = req.ip || "unknown";
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    ipAddress = forwarded.split(",")[0].trim();
  }

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
