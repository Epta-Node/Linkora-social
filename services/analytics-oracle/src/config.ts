/**
 * Shared configuration for the analytics oracle service.
 *
 * Rate limiting
 * ─────────────
 * REDIS_URL                   — Shared Redis endpoint backing the rate limiter.
 *                               REQUIRED when NODE_ENV=production; without it
 *                               every replica keeps its own counters and the
 *                               effective limit becomes
 *                               ORACLE_RATE_LIMIT_MAX_REQUESTS × replicaCount.
 * ALLOW_IN_MEMORY_RATE_LIMIT  — Explicit opt-out allowing the in-memory store
 *                               in production. Only safe for single-replica
 *                               deployments.
 */

import { resolveRateLimitEnv } from "@linkora/types/src/rate-limit-env.js";

export interface OracleRateLimitConfig {
  windowMs: number;
  maxRequests: number;
  bypassIps: string[];
  /** Max unique keys tracked by the in-memory store before LRU eviction. */
  maxEntries: number;
  /** How often the in-memory store sweeps expired entries (ms). */
  cleanupIntervalMs: number;
}

export interface OracleCacheConfig {
  /** Maximum number of attestation entries before LRU eviction. */
  maxSize: number;
  /** Milliseconds before a cached attestation is considered stale (TTL). */
  ttlMs: number;
}

function parseBypassIps(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
}

export const oracleRateLimitConfig: OracleRateLimitConfig = {
  windowMs: parseInt(process.env["ORACLE_RATE_LIMIT_WINDOW_MS"] ?? "60000", 10),
  maxRequests: parseInt(process.env["ORACLE_RATE_LIMIT_MAX_REQUESTS"] ?? "10", 10),
  bypassIps: parseBypassIps(process.env["ORACLE_RATE_LIMIT_BYPASS_IPS"]),
  maxEntries: parseInt(process.env["ORACLE_RATE_LIMIT_MAX_ENTRIES"] ?? "100000", 10),
  cleanupIntervalMs: parseInt(
    process.env["ORACLE_RATE_LIMIT_CLEANUP_INTERVAL_MS"] ?? String(5 * 60 * 1000),
    10
  ),
};

export const oracleCacheConfig: OracleCacheConfig = {
  maxSize: parseInt(process.env["ATTESTATION_CACHE_MAX_SIZE"] ?? "10000", 10),
  ttlMs: parseInt(process.env["ATTESTATION_CACHE_TTL_MS"] ?? "3600000", 10),
};

/**
 * Validate the rate-limiting environment and return the resolved Redis URL.
 *
 * Throws when NODE_ENV=production and no shared store is configured, so a
 * deployment can never silently run with per-replica limits.
 */
export function loadRateLimitConfig() {
  return resolveRateLimitEnv("analytics-oracle");
}
