/**
 * DM relay configuration.
 *
 * Rate limiting
 * ─────────────
 * REDIS_URL                   — Shared Redis endpoint backing the HTTP and
 *                               WebSocket rate limiters. REQUIRED when
 *                               NODE_ENV=production; without it every replica
 *                               keeps its own counters and the effective limit
 *                               becomes RATE_LIMIT × replicaCount.
 * ALLOW_IN_MEMORY_RATE_LIMIT  — Explicit opt-out allowing the in-memory store
 *                               in production. Only safe for single-replica
 *                               deployments.
 */

import { resolveRateLimitEnv } from "@linkora/types/src/rate-limit-env";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function optionalInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  if (isNaN(parsed)) throw new Error(`Invalid integer for ${name}: ${raw}`);
  return parsed;
}

export function loadConfig() {
  // Throws when NODE_ENV=production and no shared rate-limit store is
  // configured, so a deployment can never silently run with per-replica limits.
  const rateLimitEnv = resolveRateLimitEnv("dm-relay");

  return {
    port: optionalInt("PORT", 3001),
    redisUrl: rateLimitEnv.redisUrl,
    nodeEnv: process.env.NODE_ENV || "development",
    databaseUrl: requireEnv("DATABASE_URL"),
    corsOrigin: process.env.CORS_ORIGIN?.split(",") || ["http://localhost:3000"],
    messageTtlDays: optionalInt("MESSAGE_TTL_DAYS", 7),
    maxTimestampSkew: optionalInt("MAX_TIMESTAMP_SKEW", 300),
    maxMessageBytes: optionalInt("MAX_MESSAGE_BYTES", 64 * 1024),
    stellarNetwork: process.env.STELLAR_NETWORK || "Testnet",
    idempotencyTtlHours: optionalInt("IDEMPOTENCY_TTL_HOURS", 24),
  };
}
