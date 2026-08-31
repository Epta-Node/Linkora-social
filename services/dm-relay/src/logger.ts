import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Resolve pino transport options for the current environment.
 *
 * In development we attempt to use pino-pretty for human-readable output.
 * pino-pretty is a devDependency and will not be present in the production
 * image, so we fall back to plain JSON logging if the module cannot be
 * resolved (covers production and any environment where it is not installed).
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
    // pino-pretty is unavailable — fall back to structured JSON logging
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
