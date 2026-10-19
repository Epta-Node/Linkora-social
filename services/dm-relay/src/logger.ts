import pino from "pino";

/**
 * Unified logging conventions for dm-relay service (Issue #1660).
 * - Consistent field naming (service, timestamp, level, message)
 * - Structured JSON output with ISO timestamps
 * - Optional pretty-printing in development
 * - Same configuration across all services (indexer, analytics-oracle, dm-relay)
 */

const isDev = process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";

/**
 * Resolve pino transport for the current environment.
 * Development: attempt pino-pretty for human-readable output
 * Production/Test: structured JSON logging
 */
function resolveTransport(): pino.TransportSingleOptions | undefined {
  if (!isDev) return undefined;

  try {
    require.resolve("pino-pretty");
    return {
      target: "pino-pretty",
      options: { colorize: true, ignore: "pid,hostname", translateTime: "SYS:standard" },
    };
  } catch {
    return undefined;
  }
}

const transport = resolveTransport();

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: { service: "dm-relay" },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(transport && { transport }),
});

export default logger;
