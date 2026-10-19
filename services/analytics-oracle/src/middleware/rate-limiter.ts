/**
 * Per-IP rate limiting middleware for the analytics oracle.
 *
 * In-memory sliding window limiter keyed by client IP. Protects the oracle's
 * attestation submission endpoint from being flooded, which could exhaust the
 * oracle signing key, burn Stellar RPC rate limits, or overload the database.
 *
 * Configuration is read from `ORACLE_RATE_LIMIT_*` env vars (see config.ts).
 *
 * Multi-instance behaviour
 * ─────────────────────────
 * When `REDIS_URL` is set the limiter uses a Redis-backed sorted-set store so
 * rate-limit state is shared across all replicas and survives restarts.
 * Without `REDIS_URL` a local in-memory Map is used; entries are automatically
 * evicted after `windowMs` to prevent unbounded memory growth, but each
 * instance maintains its own independent counter.
 *
 * `REDIS_URL` is mandatory when `NODE_ENV=production` — see
 * `@linkora/types/src/rate-limit-env` — so a scaled deployment can never
 * silently fall back to per-replica counters. The active store is reported on
 * `/health` as `rateLimiter: { store, shared }`.
 */

import { Request, Response, NextFunction } from "express";
import {
  inMemoryRateLimitWarning,
  resolveRateLimitEnv,
  type RateLimitStoreStatus,
} from "@linkora/types/src/rate-limit-env.js";
import { logger } from "../logger.js";
import { oracleRateLimitConfig } from "../config.js";

// ── Store abstraction ─────────────────────────────────────────────────────────

/**
 * Pluggable backend for the sliding-window rate limiter.
 *
 * A store holds a sorted set of request timestamps for every key. All
 * timestamps are in milliseconds since the Unix epoch.
 */
export interface RateLimitStore {
  /**
   * Record a new request for `key` at `nowMs`, then count how many requests
   * exist within the window `[nowMs - windowMs, nowMs]`.
   *
   * Implementations MUST atomically prune timestamps older than
   * `nowMs - windowMs` so the count they return is always within-window only.
   *
   * @returns The total number of requests in the window *after* adding `nowMs`.
   */
  addAndCount(key: string, nowMs: number, windowMs: number): Promise<number>;

  /**
   * Return the oldest request timestamp still inside the window, or `null` if
   * there are no requests recorded for `key`.
   */
  oldestInWindow(key: string, nowMs: number, windowMs: number): Promise<number | null>;

  /** Remove all stored state (for tests and graceful shutdown). */
  clear(): Promise<void>;
}

// ── In-memory store ───────────────────────────────────────────────────────────

interface MemoryEntry {
  timestamps: number[];
  /** Wall-clock time after which this entry can be evicted. */
  expiresAt: number;
}

/**
 * In-memory sliding-window store.
 *
 * Entries are created with a TTL of `2 × windowMs` so they are automatically
 * eligible for eviction even if the client stops sending requests — this
 * prevents the unbounded memory growth that existed in the original Map-based
 * implementation.
 *
 * Memory is bounded two ways:
 *   1. A periodic sweep (default every 5 min) evicts entries whose TTL has
 *      elapsed and logs how many were removed / remain.
 *   2. A hard cap on tracked keys (default 100 000). When the cap is reached
 *      the least-recently-used key is evicted; the Map's insertion order is
 *      maintained as an LRU by re-inserting keys on every access.
 *
 * ⚠️  This store does NOT share state across process instances. Use the Redis
 * store in multi-replica deployments.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private entries = new Map<string, MemoryEntry>();
  private sweepInterval: ReturnType<typeof setInterval> | null = null;
  private maxEntries: number;
  private lruEvictions = 0;

  /**
   * @param sweepIntervalMs  How often to run the stale-entry sweep (default 5 min).
   *                         Pass 0 to disable the background sweep (useful in tests).
   * @param maxEntries       Maximum number of tracked keys before LRU eviction.
   */
  constructor(sweepIntervalMs = 5 * 60 * 1000, maxEntries = 100_000) {
    this.maxEntries = maxEntries;
    if (sweepIntervalMs > 0) {
      this.sweepInterval = setInterval(() => this.sweep(), sweepIntervalMs).unref();
    }
  }

  async addAndCount(key: string, nowMs: number, windowMs: number): Promise<number> {
    const cutoff = nowMs - windowMs;
    let entry = this.entries.get(key);

    if (entry) {
      // Re-insert to move the key to the back of the Map's insertion order,
      // making the Map double as an LRU list (front = least recently used).
      this.entries.delete(key);
    } else {
      entry = { timestamps: [], expiresAt: nowMs + windowMs * 2 };
    }
    this.entries.set(key, entry);
    this.evictLeastRecentlyUsed();

    // Prune expired timestamps and refresh TTL. Timestamps are appended in
    // monotonically non-decreasing order, so the array stays sorted.
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    entry.timestamps.push(nowMs);
    entry.expiresAt = nowMs + windowMs * 2;

    return entry.timestamps.length;
  }

  async oldestInWindow(key: string, nowMs: number, windowMs: number): Promise<number | null> {
    const entry = this.entries.get(key);
    if (!entry || entry.timestamps.length === 0) return null;

    const cutoff = nowMs - windowMs;
    const inWindow = entry.timestamps.filter((t) => t > cutoff);
    if (inWindow.length === 0) return null;

    // Timestamps are stored in ascending order, so the first in-window entry
    // is the oldest. Never spread into Math.min — a large window would blow
    // the call-stack argument limit.
    return inWindow[0];
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }

  /** Number of keys currently tracked (for tests and metrics). */
  size(): number {
    return this.entries.size;
  }

  /** Evict LRU keys until the store is within its cap. */
  private evictLeastRecentlyUsed(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
      this.lruEvictions++;
    }
  }

  /** Evict entries whose TTL has elapsed. Called by the background timer. */
  private sweep(): void {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
        removed++;
      }
    }
    logger.info(
      {
        entriesRemoved: removed,
        entriesRemaining: this.entries.size,
        lruEvictionsSinceLastSweep: this.lruEvictions,
        maxEntries: this.maxEntries,
      },
      "Rate limiter cleanup completed"
    );
    this.lruEvictions = 0;
  }

  destroy(): void {
    if (this.sweepInterval !== null) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
  }
}

// ── Redis store ───────────────────────────────────────────────────────────────

/**
 * Redis-backed sliding-window store using a sorted set per key.
 *
 * Each key maps to a Redis sorted set where the score is the request timestamp
 * in milliseconds. On every `addAndCount` call we atomically:
 *   1. Remove members with score < `nowMs - windowMs`  (ZREMRANGEBYSCORE)
 *   2. Add `nowMs` as a new member                     (ZADD)
 *   3. Count remaining members                         (ZCARD)
 *   4. Set the key TTL to `windowMs` ms                (PEXPIRE)
 *
 * Steps 1–4 are executed in a single MULTI/EXEC pipeline so no partial state
 * can be observed between the prune and the add.
 */
export class RedisRateLimitStore implements RateLimitStore {
  // Accept any ioredis-compatible client (Redis | Cluster).
  // Typed as `unknown` to avoid forcing consumers to install @types/ioredis
  // just for this file; we call only the subset we need.
  private client: RedisClient;
  private keyPrefix: string;

  constructor(client: RedisClient, keyPrefix = "rl:oracle:") {
    this.client = client;
    this.keyPrefix = keyPrefix;
  }

  async addAndCount(key: string, nowMs: number, windowMs: number): Promise<number> {
    const rKey = this.keyPrefix + key;
    const cutoff = nowMs - windowMs;
    const member = `${nowMs}-${Math.random().toString(36).slice(2)}`; // unique member

    // Pipeline: ZREMRANGEBYSCORE + ZADD + ZCARD + PEXPIRE
    const pipeline = this.client.pipeline();
    pipeline.zremrangebyscore(rKey, "-inf", cutoff);
    pipeline.zadd(rKey, nowMs, member);
    pipeline.zcard(rKey);
    pipeline.pexpire(rKey, windowMs * 2);

    const results = await pipeline.exec();
    // results[2] is [err, count] from ZCARD
    const zcardResult = results?.[2];
    if (!zcardResult || zcardResult[0]) {
      throw new Error(`Redis pipeline error: ${zcardResult?.[0]}`);
    }
    return zcardResult[1] as number;
  }

  async oldestInWindow(key: string, nowMs: number, windowMs: number): Promise<number | null> {
    const rKey = this.keyPrefix + key;
    const cutoff = nowMs - windowMs;

    // ZRANGEBYSCORE key cutoff +inf LIMIT 0 1
    const results: string[] = await this.client.zrangebyscore(rKey, cutoff, "+inf", "LIMIT", 0, 1);
    if (!results || results.length === 0) return null;

    // Member format: "<timestampMs>-<random>"; score == timestampMs
    return parseInt(results[0].split("-")[0], 10);
  }

  async clear(): Promise<void> {
    // Scan for keys matching the prefix and delete them.
    // Suitable for tests; not intended for production use.
    const keys: string[] = await this.client.keys(`${this.keyPrefix}*`);
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }
}

// Minimal interface covering the ioredis methods we use
interface RedisClient {
  pipeline(): RedisPipeline;
  zrangebyscore(
    key: string,
    min: string | number,
    max: string | number,
    ...args: (string | number)[]
  ): Promise<string[]>;
  keys(pattern: string): Promise<string[]>;
  del(...keys: string[]): Promise<number>;
}

interface RedisPipeline {
  zremrangebyscore(key: string, min: string | number, max: string | number): RedisPipeline;
  zadd(key: string, score: number, member: string): RedisPipeline;
  zcard(key: string): RedisPipeline;
  pexpire(key: string, ms: number): RedisPipeline;
  exec(): Promise<Array<[Error | null, unknown]> | null>;
}

// ── Store factory ─────────────────────────────────────────────────────────────

/**
 * Build the appropriate store based on the environment.
 *
 * When `REDIS_URL` is present a Redis-backed store is returned. Falls back to
 * the in-memory store and logs a warning so operators know rate limiting is
 * per-instance only. Callers that need the resulting mode for the health
 * endpoint should use {@link createRateLimitStoreWithStatus}.
 */
export async function createRateLimitStore(redisUrl?: string): Promise<RateLimitStore> {
  return (await createRateLimitStoreWithStatus(redisUrl)).store;
}

/** Same as {@link createRateLimitStore} but also reports which backend was used. */
export async function createRateLimitStoreWithStatus(
  redisUrl?: string
): Promise<{ store: RateLimitStore; status: RateLimitStoreStatus }> {
  if (redisUrl) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Redis = (await import("ioredis")) as any;
    const RedisClass = Redis.default ?? Redis;
    const client = new RedisClass(redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    await client.connect();
    logger.info("Rate limiter using Redis store (shared across instances)");
    return {
      store: new RedisRateLimitStore(client as unknown as RedisClient),
      status: { store: "redis", shared: true },
    };
  }

  logger.warn(
    "REDIS_URL is not set — rate limiter is using an in-memory store. " +
      "Rate limit state is NOT shared across instances and will reset on restart. " +
      "Set REDIS_URL to enable cross-instance rate limiting."
  );
  return {
    store: new InMemoryRateLimitStore(
      oracleRateLimitConfig.cleanupIntervalMs,
      oracleRateLimitConfig.maxEntries
    ),
    status: { store: "memory", shared: false },
  };
}

// ── RateLimiter (store-backed) ────────────────────────────────────────────────

export class RateLimiter {
  private store: RateLimitStore;
  private windowMs: number;
  private maxRequests: number;

  constructor(windowMs: number, maxRequests: number, store?: RateLimitStore) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    // Default to synchronous-compatible in-memory store for backwards
    // compatibility with tests that call reset() / inspect internals.
    this.store = store ?? new InMemoryRateLimitStore(0 /* no sweep timer */);
  }

  /** Async variant — preferred for production middleware. */
  async isAllowedAsync(key: string): Promise<boolean> {
    const count = await this.store.addAndCount(key, Date.now(), this.windowMs);
    return count <= this.maxRequests;
  }

  /** Async variant of getRetryAfterSeconds. */
  async getRetryAfterSecondsAsync(key: string): Promise<number> {
    const now = Date.now();
    const oldest = await this.store.oldestInWindow(key, now, this.windowMs);
    if (oldest === null) return Math.ceil(this.windowMs / 1000);
    const remainingMs = Math.max(0, this.windowMs - (now - oldest));
    return Math.ceil(remainingMs / 1000);
  }

  async reset(): Promise<void> {
    await this.store.clear();
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────

// Starts with the in-memory store; call initRateLimiter() at startup to
// upgrade to Redis when REDIS_URL is available.
let limiter = new RateLimiter(oracleRateLimitConfig.windowMs, oracleRateLimitConfig.maxRequests);

// Until initRateLimiter() runs the limiter is process-local, so the honest
// answer for /health is "memory, not shared".
let storeStatus: RateLimitStoreStatus = { store: "memory", shared: false };

/**
 * Call once at service startup (after env is loaded).
 *
 * Validates the rate-limit environment first — this throws when
 * `NODE_ENV=production` and no shared store is configured — then creates the
 * Redis store and replaces the in-memory one.
 */
export async function initRateLimiter(): Promise<void> {
  const resolved = resolveRateLimitEnv("analytics-oracle");
  const warning = inMemoryRateLimitWarning(resolved);
  if (warning) logger.warn(warning);

  const { store, status } = await createRateLimitStoreWithStatus(resolved.redisUrl);
  limiter = new RateLimiter(
    oracleRateLimitConfig.windowMs,
    oracleRateLimitConfig.maxRequests,
    store
  );
  storeStatus = status;
}

/**
 * Which store currently backs the limiter, for the `/health` endpoint.
 * `shared: false` means limits are enforced per replica, not per deployment.
 */
export function getRateLimitStoreStatus(): RateLimitStoreStatus {
  return { ...storeStatus };
}

import { getClientIP } from "../ip.js";

/** Per-IP rate limiting middleware. Bypasses IPs configured in ORACLE_RATE_LIMIT_BYPASS_IPS. */
export function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const key = (req as { stellarAddress?: string }).stellarAddress || getClientIP(req);

  if (oracleRateLimitConfig.bypassIps.includes(key)) {
    next();
    return;
  }

  limiter
    .isAllowedAsync(key)
    .then(async (allowed) => {
      if (allowed) {
        next();
        return;
      }

      const retryAfterSeconds = await limiter.getRetryAfterSecondsAsync(key);

      logger.warn(
        { identifier: key, endpoint: req.path, limit: oracleRateLimitConfig.maxRequests },
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
    })
    .catch(next);
}

/** Reset limiter state (for tests). */
export async function resetRateLimiter(): Promise<void> {
  await limiter.reset();
}

export function getRateLimiterInstance(): RateLimiter {
  return limiter;
}
