/**
 * Shared deployment-time validation for distributed rate limiting.
 *
 * Every Linkora service that enforces a rate limit can back it with either a
 * Redis store (state shared across replicas) or a process-local in-memory
 * store. The in-memory fallback is convenient for local development but it is
 * *not* a rate limit in any multi-replica deployment: an attacker behind a
 * load balancer gets `limit × replicaCount` effective throughput, because each
 * replica counts only the requests it happened to receive.
 *
 * To stop that from happening silently, `REDIS_URL` is mandatory whenever
 * `NODE_ENV === "production"`. Startup fails with an actionable error rather
 * than booting a deployment whose limiter does nothing.
 *
 * Single-replica production deployments that genuinely do not need Redis can
 * opt out with `ALLOW_IN_MEMORY_RATE_LIMIT=true`. The opt-out is deliberately
 * explicit: it is recorded in the startup log and surfaced on the health
 * endpoint as `rateLimiter: { store: "memory", shared: false }`, so an
 * operator scaling the deployment up can see that limits are per-instance.
 */

/** Which backend the limiter ended up using. */
export type RateLimitStoreKind = "redis" | "memory";

/** Health-endpoint view of the limiter's backing store. */
export interface RateLimitStoreStatus {
  /** The store implementation currently in use. */
  store: RateLimitStoreKind;
  /** True when limit state is shared across every replica of the service. */
  shared: boolean;
}

/** Thrown when the rate-limit environment is unsafe for the target NODE_ENV. */
export class RateLimitConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitConfigError";
  }
}

/** Minimal environment shape — a plain record so callers can pass fixtures. */
export type RateLimitEnv = Record<string, string | undefined>;

/**
 * `process.env` without depending on @types/node — this package is consumed by
 * browser bundles too, so it must not pull Node globals into its type surface.
 */
function ambientEnv(): RateLimitEnv {
  const proc = (globalThis as { process?: { env?: RateLimitEnv } }).process;
  return proc?.env ?? {};
}

export interface ResolvedRateLimitEnv {
  /** The Redis connection string, or undefined when running in-memory. */
  redisUrl: string | undefined;
  /** True when the in-memory fallback was explicitly permitted in production. */
  inMemoryOptOut: boolean;
  /** The store this configuration will produce, before any connection is made. */
  expected: RateLimitStoreStatus;
}

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

/**
 * Validate the rate-limiting environment for `serviceName`.
 *
 * @throws {RateLimitConfigError} when `NODE_ENV=production`, `REDIS_URL` is
 *   unset, and the in-memory fallback has not been explicitly allowed.
 */
export function resolveRateLimitEnv(
  serviceName: string,
  env: RateLimitEnv = ambientEnv()
): ResolvedRateLimitEnv {
  const redisUrl = env["REDIS_URL"]?.trim() || undefined;
  const isProduction = env["NODE_ENV"] === "production";
  const inMemoryOptOut = isTruthyFlag(env["ALLOW_IN_MEMORY_RATE_LIMIT"]);

  if (redisUrl) {
    return { redisUrl, inMemoryOptOut: false, expected: { store: "redis", shared: true } };
  }

  if (isProduction && !inMemoryOptOut) {
    throw new RateLimitConfigError(
      `[${serviceName}] REDIS_URL is required when NODE_ENV=production. ` +
        "Without it each replica keeps its own rate-limit counters, so the effective limit " +
        "becomes RATE_LIMIT × replicaCount and rate limiting provides no real protection. " +
        "Set REDIS_URL to a Redis endpoint shared by every replica (e.g. redis://redis:6379). " +
        "For a deliberately single-replica deployment, set ALLOW_IN_MEMORY_RATE_LIMIT=true to " +
        "acknowledge that limits are per-instance only."
    );
  }

  return { redisUrl: undefined, inMemoryOptOut, expected: { store: "memory", shared: false } };
}

/**
 * Human-readable warning describing why in-memory rate limiting is risky.
 * Returns null when the resolved configuration uses Redis.
 */
export function inMemoryRateLimitWarning(resolved: ResolvedRateLimitEnv): string | null {
  if (resolved.expected.store === "redis") return null;

  const prefix = resolved.inMemoryOptOut
    ? "ALLOW_IN_MEMORY_RATE_LIMIT is set — "
    : "REDIS_URL is not set — ";

  return (
    prefix +
    "rate limiter is using an in-memory store. Rate limit state is NOT shared across " +
    "instances and will reset on restart. Do not scale this deployment beyond one replica " +
    "without setting REDIS_URL."
  );
}
