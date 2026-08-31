/**
 * Per-IP / per-address rate limiting middleware for the indexer API.
 *
 * Multi-instance behaviour
 * ─────────────────────────
 * When `REDIS_URL` is set the limiter uses a Redis-backed sorted-set store so
 * rate-limit state is shared across all replicas and survives restarts.
 * Without `REDIS_URL` a local in-memory Map is used; entries are automatically
 * evicted after `WINDOW_MS * 2` to prevent unbounded memory growth, but each
 * instance maintains its own independent counter.
 *
 * `REDIS_URL` is mandatory when `NODE_ENV=production` — see
 * `@linkora/types/src/rate-limit-env` — so a scaled deployment can never
 * silently fall back to per-replica counters. The active store is reported on
 * `/health` as `rateLimiter: { store, shared }`.
 */

import { Request, Response, NextFunction } from "express";
import { logger } from "../logger";
import { rateLimitedError } from "@linkora/types/src/errors";
import {
  inMemoryRateLimitWarning,
  resolveRateLimitEnv,
  type RateLimitStoreStatus,
} from "@linkora/types/src/rate-limit-env";

const RATE_LIMIT_ANON_RPM = parseInt(process.env.RATE_LIMIT_ANON_RPM || "100", 10);
const RATE_LIMIT_AUTH_RPM = parseInt(process.env.RATE_LIMIT_AUTH_RPM || "300", 10);
const RATE_LIMIT_WRITE_RPM = parseInt(process.env.RATE_LIMIT_WRITE_RPM || "50", 10);
const WINDOW_MS = 60_000;

// ── Store abstraction ─────────────────────────────────────────────────────────

/**
 * Pluggable backend for the sliding-window rate limiter.
 */
export interface RateLimitStore {
  /**
   * Record a new request for `key` at `nowMs`, prune entries older than
   * `windowMs`, and return the count of requests remaining in the window.
   */
  addAndCount(key: string, nowMs: number, windowMs: number): Promise<number>;

  /** Return the oldest timestamp still inside the window, or null. */
  oldestInWindow(key: string, nowMs: number, windowMs: number): Promise<number | null>;

  /** Clear all state (for tests). */
  clear(): Promise<void>;
}

// ── In-memory store ───────────────────────────────────────────────────────────

interface MemoryEntry {
  timestamps: number[];
  /** Wall-clock time after which this entry can be evicted. */
  expiresAt: number;
}

/**
 * In-memory sliding-window store with TTL-based eviction.
 *
 * Entries are evicted after `2 × windowMs` of inactivity so stale IP counters
 * do not accumulate indefinitely — the memory leak present in the original
 * implementation is eliminated.
 *
 * ⚠️  State is NOT shared across process instances. Use the Redis store in
 * multi-replica deployments.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private entries = new Map<string, MemoryEntry>();
  private sweepInterval: ReturnType<typeof setInterval> | null = null;

  constructor(sweepIntervalMs = 5 * 60 * 1000) {
    if (sweepIntervalMs > 0) {
      this.sweepInterval = setInterval(() => this.sweep(), sweepIntervalMs).unref();
    }
  }

  async addAndCount(key: string, nowMs: number, windowMs: number): Promise<number> {
    const cutoff = nowMs - windowMs;
    let entry = this.entries.get(key);

    if (!entry) {
      entry = { timestamps: [], expiresAt: nowMs + windowMs * 2 };
      this.entries.set(key, entry);
    }

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

    return Math.min(...inWindow);
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.sweepInterval !== null) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
  }
}

// ── Redis store ───────────────────────────────────────────────────────────────

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

/**
 * Redis-backed sliding-window store using a sorted set per key.
 *
 * Each operation is executed as a MULTI/EXEC pipeline:
 *   ZREMRANGEBYSCORE — prune timestamps outside the window
 *   ZADD             — record the new request
 *   ZCARD            — count requests in the window
 *   PEXPIRE          — reset the key TTL
 *
 * This ensures no partial state is visible between the prune and the count.
 */
export class RedisRateLimitStore implements RateLimitStore {
  private client: RedisClient;
  private keyPrefix: string;

  constructor(client: RedisClient, keyPrefix = "rl:indexer:") {
    this.client = client;
    this.keyPrefix = keyPrefix;
  }

  async addAndCount(key: string, nowMs: number, windowMs: number): Promise<number> {
    const rKey = this.keyPrefix + key;
    const cutoff = nowMs - windowMs;
    const member = `${nowMs}-${Math.random().toString(36).slice(2)}`;

    const pipeline = this.client.pipeline();
    pipeline.zremrangebyscore(rKey, "-inf", cutoff);
    pipeline.zadd(rKey, nowMs, member);
    pipeline.zcard(rKey);
    pipeline.pexpire(rKey, windowMs * 2);

    const results = await pipeline.exec();
    const zcardResult = results?.[2];
    if (!zcardResult || zcardResult[0]) {
      throw new Error(`Redis pipeline error: ${zcardResult?.[0]}`);
    }
    return zcardResult[1] as number;
  }

  async oldestInWindow(key: string, nowMs: number, windowMs: number): Promise<number | null> {
    const rKey = this.keyPrefix + key;
    const cutoff = nowMs - windowMs;
    const results: string[] = await this.client.zrangebyscore(rKey, cutoff, "+inf", "LIMIT", 0, 1);
    if (!results || results.length === 0) return null;
    return parseInt(results[0].split("-")[0], 10);
  }

  async clear(): Promise<void> {
    const keys: string[] = await this.client.keys(`${this.keyPrefix}*`);
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }
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
  return { store: new InMemoryRateLimitStore(), status: { store: "memory", shared: false } };
}

// ── RateLimiter class ─────────────────────────────────────────────────────────

interface RateWindow {
  requests: number[];
}

/**
 * Sliding-window rate limiter backed by a RateLimitStore.
 *
 * The synchronous `isAllowed` / `getRemainingTime` / `getRequestCount` methods
 * are kept for backwards compatibility with existing unit tests. They delegate
 * to a synchronous in-memory Map when no async store is injected.
 *
 * Production middleware should use the async variants (`isAllowedAsync`, etc.)
 * which work correctly with both the in-memory and Redis stores.
 */
export class RateLimiter {
  // Legacy synchronous Map — used only when no store is injected (unit tests).
  private windows = new Map<string, RateWindow>();
  private store: RateLimitStore | null;

  constructor(store?: RateLimitStore) {
    this.store = store ?? null;
  }

  // ── Synchronous API (backwards-compatible, in-memory only) ───────────────

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

  // ── Async API (store-backed, supports Redis) ──────────────────────────────

  async isAllowedAsync(key: string, limit: number): Promise<boolean> {
    if (!this.store) {
      return this.isAllowed(key, limit);
    }
    const count = await this.store.addAndCount(key, Date.now(), WINDOW_MS);
    return count <= limit;
  }

  async getRemainingTimeAsync(key: string): Promise<number> {
    if (!this.store) {
      return this.getRemainingTime(key);
    }
    const now = Date.now();
    const oldest = await this.store.oldestInWindow(key, now, WINDOW_MS);
    if (oldest === null) return WINDOW_MS;
    return Math.max(0, WINDOW_MS - (now - oldest));
  }

  async clearStore(): Promise<void> {
    if (this.store) {
      await this.store.clear();
    } else {
      this.windows.clear();
    }
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────

// Starts with no store (pure synchronous Map) so existing tests work without
// any setup. Call initRateLimiter() at service startup to upgrade to Redis.
let limiter = new RateLimiter();

// Until initRateLimiter() runs the limiter is the process-local Map, so the
// honest answer for /health is "memory, not shared".
let storeStatus: RateLimitStoreStatus = { store: "memory", shared: false };

/**
 * Call once at service startup (after env is loaded).
 *
 * Validates the rate-limit environment first — this throws when
 * `NODE_ENV=production` and no shared store is configured — then creates the
 * Redis store and replaces the in-memory one.
 */
export async function initRateLimiter(): Promise<void> {
  const resolved = resolveRateLimitEnv("indexer");
  const warning = inMemoryRateLimitWarning(resolved);
  if (warning) logger.warn(warning);

  const { store, status } = await createRateLimitStoreWithStatus(resolved.redisUrl);
  limiter = new RateLimiter(store);
  storeStatus = status;
}

/**
 * Which store currently backs the limiter, for the `/health` endpoint.
 * `shared: false` means limits are enforced per replica, not per deployment.
 */
export function getRateLimitStoreStatus(): RateLimitStoreStatus {
  return { ...storeStatus };
}

// ── Helper functions ──────────────────────────────────────────────────────────

export const DEFAULT_TRUSTED_PROXIES = [
  "127.0.0.1/32",
  "127.0.0.1",
  "::1/128",
  "::1",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
];

export function normalizeIp(ip: string): string {
  if (!ip) return "unknown";
  let cleaned = ip.trim();
  if (cleaned.startsWith("::ffff:")) {
    cleaned = cleaned.substring(7);
  }
  return cleaned;
}

function ipv4ToLong(ip: string): number | null {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return null;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function isIpInCidr(ip: string, cidr: string): boolean {
  const normalizedIp = normalizeIp(ip);
  const normalizedCidr = normalizeIp(cidr);

  if (!normalizedCidr.includes("/")) {
    return normalizedIp === normalizedCidr;
  }

  const [range, bitsStr] = normalizedCidr.split("/");
  const bits = parseInt(bitsStr, 10);

  const ipLong = ipv4ToLong(normalizedIp);
  const rangeLong = ipv4ToLong(range);
  if (ipLong !== null && rangeLong !== null && !isNaN(bits) && bits >= 0 && bits <= 32) {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (ipLong & mask) === (rangeLong & mask);
  }

  if (normalizedIp === range) {
    return true;
  }

  return false;
}

export function getClientIP(
  req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string }; ip?: string },
  customTrustedProxies?: string[]
): string {
  const trustedList =
    customTrustedProxies ??
    (process.env.TRUSTED_PROXIES
      ? process.env.TRUSTED_PROXIES.split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : DEFAULT_TRUSTED_PROXIES);

  const socketIp = normalizeIp(req.socket?.remoteAddress || req.ip || "unknown");

  const isDirectConnectionTrusted = trustedList.some((cidr) => isIpInCidr(socketIp, cidr));

  if (!isDirectConnectionTrusted) {
    return socketIp;
  }

  const rawXff = req.headers["x-forwarded-for"];
  if (!rawXff) {
    return socketIp;
  }

  const xffHeader = Array.isArray(rawXff) ? rawXff.join(",") : String(rawXff);
  const ips = xffHeader
    .split(",")
    .map((ip) => normalizeIp(ip))
    .filter(Boolean);

  if (ips.length === 0) {
    return socketIp;
  }

  for (let i = ips.length - 1; i >= 0; i--) {
    const candidateIp = ips[i];
    const isTrusted = trustedList.some((cidr) => isIpInCidr(candidateIp, cidr));
    if (!isTrusted) {
      return candidateIp;
    }
  }

  return ips[0];
}

function isWriteEndpoint(path: string, method: string): boolean {
  return ["POST", "PUT", "DELETE", "PATCH"].includes(method);
}

// ── Middleware ────────────────────────────────────────────────────────────────

export function rateLimitRead(req: Request, res: Response, next: NextFunction): void {
  const key = req.context?.stellarAddress || getClientIP(req);
  const limit = req.context?.stellarAddress ? RATE_LIMIT_AUTH_RPM : RATE_LIMIT_ANON_RPM;

  limiter
    .isAllowedAsync(key, limit)
    .then(async (allowed) => {
      if (allowed) {
        next();
        return;
      }

      const retryAfterMs = await limiter.getRemainingTimeAsync(key);
      const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

      logger.warn(
        {
          requestId: req.context?.requestId,
          identifier: key,
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
    })
    .catch(next);
}

export function rateLimitWrite(req: Request, res: Response, next: NextFunction): void {
  const key = req.context?.stellarAddress || getClientIP(req);
  const limit = req.context?.stellarAddress ? RATE_LIMIT_AUTH_RPM : RATE_LIMIT_WRITE_RPM;

  limiter
    .isAllowedAsync(key, limit)
    .then(async (allowed) => {
      if (allowed) {
        next();
        return;
      }

      const retryAfterMs = await limiter.getRemainingTimeAsync(key);
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
    })
    .catch(next);
}

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  if (isWriteEndpoint(req.path, req.method)) {
    rateLimitWrite(req, res, next);
  } else {
    rateLimitRead(req, res, next);
  }
}

export function resetRateLimiter(): void {
  // Synchronous reset of the in-memory Map for tests.
  // When a Redis store is active, use resetRateLimiterAsync() instead.
  const l = limiter as unknown as { windows: Map<string, RateWindow> };
  l.windows.clear();
}

export async function resetRateLimiterAsync(): Promise<void> {
  await limiter.clearStore();
}

export const getRateLimiterInstance = () => limiter;
