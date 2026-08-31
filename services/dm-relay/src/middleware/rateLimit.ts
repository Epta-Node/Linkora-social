/**
 * Rate limiting for the DM relay.
 *
 * Two limiters live here:
 *   - the HTTP limiters (`anonLimiter` / `authLimiter`), built on
 *     express-rate-limit with a `rate-limit-redis` store, and
 *   - the WebSocket per-IP connection limiter, a fixed-window counter used by
 *     `server.ts` before a socket is accepted.
 *
 * Multi-instance behaviour
 * ─────────────────────────
 * Both limiters share the same Redis client, so every counter is consistent
 * across replicas. Without Redis each replica keeps its own counters and the
 * effective limit becomes `limit × replicaCount` — which is why `REDIS_URL` is
 * mandatory when `NODE_ENV=production` (see
 * `@linkora/types/src/rate-limit-env`). The active store is reported on
 * `/health` as `rateLimiter: { store, shared }`.
 */

import { rateLimit, Options as RateLimitOptions } from "express-rate-limit";
import { NextFunction, Request, Response } from "express";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import type { Redis } from "ioredis";
import { rateLimitedError } from "@linkora/types/src/errors";
import {
  inMemoryRateLimitWarning,
  resolveRateLimitEnv,
  type RateLimitStoreStatus,
} from "@linkora/types/src/rate-limit-env";

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

const RATE_LIMIT_ANON_RPM = parseInt(process.env.RATE_LIMIT_ANON_RPM || "100", 10);
const RATE_LIMIT_AUTH_RPM = parseInt(process.env.RATE_LIMIT_AUTH_RPM || "300", 10);

// ── WebSocket connection limiter ──────────────────────────────────────────────

/** Default window and cap for WebSocket connection attempts per IP. */
export const WS_RATE_LIMIT_WINDOW_MS = 60_000;
export const WS_RATE_LIMIT_MAX = parseInt(process.env.WS_RATE_LIMIT_MAX || "30", 10);

/**
 * Fixed-window counter for WebSocket connection attempts.
 *
 * Deliberately separate from the express-rate-limit stores: a WebSocket
 * upgrade is not an Express request, so it cannot pass through the HTTP
 * middleware chain.
 */
export interface WsRateLimitStore {
  /**
   * Record one connection attempt for `ip` and return the number of attempts
   * recorded in the current window (including this one).
   */
  hit(ip: string, nowMs: number): Promise<number>;
  /** Drop all state (tests). */
  clear(): Promise<void>;
}

/** Per-process fallback — counters are NOT shared across replicas. */
export class InMemoryWsRateLimitStore implements WsRateLimitStore {
  private entries = new Map<string, { count: number; resetAt: number }>();

  constructor(private windowMs: number = WS_RATE_LIMIT_WINDOW_MS) {}

  async hit(ip: string, nowMs: number = Date.now()): Promise<number> {
    const entry = this.entries.get(ip);
    if (!entry || nowMs > entry.resetAt) {
      this.entries.set(ip, { count: 1, resetAt: nowMs + this.windowMs });
      return 1;
    }
    entry.count++;
    return entry.count;
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}

/**
 * Redis-backed fixed-window counter.
 *
 * The window is derived from the timestamp (`floor(now / windowMs)`) so every
 * replica agrees on the current bucket without any coordination. INCR is
 * atomic, so concurrent upgrades across replicas cannot both read a stale
 * count, and PEXPIRE bounds the key's lifetime to two windows.
 */
export class RedisWsRateLimitStore implements WsRateLimitStore {
  constructor(
    private client: Redis,
    private windowMs: number = WS_RATE_LIMIT_WINDOW_MS,
    private keyPrefix = "rl:dm-relay:ws:"
  ) {}

  async hit(ip: string, nowMs: number = Date.now()): Promise<number> {
    const bucket = Math.floor(nowMs / this.windowMs);
    const key = `${this.keyPrefix}${ip}:${bucket}`;

    const results = await this.client
      .pipeline()
      .incr(key)
      .pexpire(key, this.windowMs * 2)
      .exec();

    const incrResult = results?.[0];
    if (!incrResult || incrResult[0]) {
      throw new Error(`Redis pipeline error: ${incrResult?.[0]}`);
    }
    return Number(incrResult[1]);
  }

  async clear(): Promise<void> {
    const keys = await this.client.keys(`${this.keyPrefix}*`);
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }
}

// ── Module state ──────────────────────────────────────────────────────────────

let redisClient: Redis | null = null;
let wsStore: WsRateLimitStore = new InMemoryWsRateLimitStore();
let storeStatus: RateLimitStoreStatus = { store: "memory", shared: false };

/**
 * Connect the shared Redis client used by both the HTTP and WebSocket
 * limiters. Returns null (and logs) when the connection cannot be established,
 * so a Redis outage degrades to per-instance limiting rather than refusing to
 * boot a running service.
 */
async function connectRedis(redisUrl: string): Promise<Redis | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const { default: Redis } = await import("ioredis");
    const client = new Redis(redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    await client.connect();
    return client;
  } catch (err) {
    console.error("[rate-limiter] Failed to connect Redis, falling back to in-memory:", err);
    return null;
  }
}

/** Build the express-rate-limit store on top of an existing Redis client. */
async function buildRedisStore(client: Redis): Promise<RateLimitOptions["store"] | undefined> {
  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const { RedisStore } = await import("rate-limit-redis");
    return new RedisStore({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendCommand: (...args: string[]) => (client as any).call(...args),
      prefix: "rl:dm-relay:",
    });
  } catch (err) {
    console.error("[rate-limiter] Failed to build Redis store, falling back to in-memory:", err);
    return undefined;
  }
}

// Module-level limiters; rebuilt by initRateLimiters() once Redis is available.
let anonLimiter: ReturnType<typeof rateLimit>;
let authLimiter: ReturnType<typeof rateLimit>;

function buildLimiters(store?: RateLimitOptions["store"]): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shared: any = {
    windowMs: 60_000,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    ...(store ? { store } : {}),
  };

  anonLimiter = rateLimit({
    ...shared,
    limit: RATE_LIMIT_ANON_RPM,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    keyGenerator: (req: any) => getClientIP(req),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (_req: any, res: any) => {
      const err = rateLimitedError(`Max ${RATE_LIMIT_ANON_RPM} requests per minute per IP`);
      res.status(err.statusCode).json(err.toJSON(_req.requestId));
    },
  });

  authLimiter = rateLimit({
    ...shared,
    limit: RATE_LIMIT_AUTH_RPM,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    keyGenerator: (req: any) => req.stellarAddress || getClientIP(req),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (_req: any, res: any) => {
      const err = rateLimitedError(
        `Max ${RATE_LIMIT_AUTH_RPM} requests per minute per authenticated user`
      );
      res.status(err.statusCode).json(err.toJSON(_req.requestId));
    },
  });
}

/**
 * Call once during server startup (before any requests are handled).
 *
 * Validates the rate-limit environment first — this throws when
 * `NODE_ENV=production` and no shared store is configured — then connects to
 * Redis and rebuilds both the HTTP and WebSocket limiters on top of it.
 */
export async function initRateLimiters(): Promise<void> {
  const resolved = resolveRateLimitEnv("dm-relay");
  const warning = inMemoryRateLimitWarning(resolved);
  if (warning) console.warn(`[rate-limiter] ${warning}`);

  if (resolved.redisUrl) {
    const client = await connectRedis(resolved.redisUrl);
    const store = client ? await buildRedisStore(client) : undefined;

    if (client && store) {
      redisClient = client;
      wsStore = new RedisWsRateLimitStore(client);
      storeStatus = { store: "redis", shared: true };
      console.info("[rate-limiter] Using Redis store (shared across instances)");
      buildLimiters(store);
      return;
    }
    // connectRedis / buildRedisStore already logged; fall through to in-memory.
    if (client) await client.quit().catch(() => undefined);
  }

  wsStore = new InMemoryWsRateLimitStore();
  storeStatus = { store: "memory", shared: false };
  buildLimiters();
}

/** Close the shared Redis client during graceful shutdown. */
export async function closeRateLimiters(): Promise<void> {
  if (redisClient) {
    await redisClient.quit().catch(() => undefined);
    redisClient = null;
  }
}

/**
 * Which store currently backs the limiters, for the `/health` endpoint.
 * `shared: false` means limits are enforced per replica, not per deployment.
 */
export function getRateLimitStoreStatus(): RateLimitStoreStatus {
  return { ...storeStatus };
}

/**
 * True when `ip` has exceeded the WebSocket connection limit for the current
 * window. Backed by Redis when configured, so the cap applies to the
 * deployment as a whole rather than to each replica independently.
 */
export async function isWsIpRateLimited(ip: string, nowMs: number = Date.now()): Promise<boolean> {
  try {
    const count = await wsStore.hit(ip, nowMs);
    return count > WS_RATE_LIMIT_MAX;
  } catch (err) {
    // Fail open rather than dropping every socket if Redis blips — the HTTP
    // limiters still apply, and a hard failure here would be a self-inflicted
    // outage.
    console.error("[rate-limiter] WebSocket rate-limit check failed, allowing connection:", err);
    return false;
  }
}

/** Replace the WebSocket store (tests). */
export function setWsRateLimitStore(store: WsRateLimitStore): void {
  wsStore = store;
}

/** Reset WebSocket counters (tests). */
export async function resetWsRateLimit(): Promise<void> {
  await wsStore.clear();
}

// ── Synchronous fallback so the middleware can be used before initRateLimiters
// completes (e.g. in tests that don't call init). ─────────────────────────────
buildLimiters(); // initialises with in-memory store

// ── Exported middleware ───────────────────────────────────────────────────────

export { anonLimiter, authLimiter };

export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  if ((req as Request & { stellarAddress?: string }).stellarAddress) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (authLimiter as any)(req, res, next);
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (anonLimiter as any)(req, res, next);
}
