/**
 * DM relay rate limiting: production env validation, the WebSocket connection
 * limiter's shared store, and the health endpoint's reporting of both.
 *
 * The WebSocket limiter matters as much as the HTTP one here: a socket upgrade
 * never passes through the Express middleware chain, so before this it was the
 * one limiter still counting per replica even when Redis was configured.
 */

import http from "http";
import type { AddressInfo } from "net";
import express from "express";
import {
  InMemoryWsRateLimitStore,
  RedisWsRateLimitStore,
  WS_RATE_LIMIT_MAX,
  WS_RATE_LIMIT_WINDOW_MS,
  isWsIpRateLimited,
  resetWsRateLimit,
  setWsRateLimitStore,
  type WsRateLimitStore,
} from "../middleware/rateLimit";
import { createHealthRouter } from "../routes/health";
import { loadConfig } from "../config";
import type { Database } from "../database";

const CLIENT_IP = "203.0.113.9";
const REPLICAS = 3;

/**
 * Minimal Redis stand-in covering the INCR/PEXPIRE pipeline and KEYS/DEL used
 * by RedisWsRateLimitStore. One instance shared by several stores is what
 * models a real deployment's shared Redis.
 */
class FakeRedis {
  private counters = new Map<string, number>();

  pipeline() {
    const ops: Array<() => unknown> = [];
    const counters = this.counters;
    const chain = {
      incr: (key: string) => {
        ops.push(() => {
          const next = (counters.get(key) ?? 0) + 1;
          counters.set(key, next);
          return next;
        });
        return chain;
      },
      pexpire: (_key: string, _ms: number) => {
        ops.push(() => 1);
        return chain;
      },
      exec: async () => ops.map((op) => [null, op()] as [Error | null, unknown]),
    };
    return chain;
  }

  async keys(pattern: string): Promise<string[]> {
    const prefix = pattern.replace(/\*$/, "");
    return [...this.counters.keys()].filter((k) => k.startsWith(prefix));
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) if (this.counters.delete(key)) removed++;
    return removed;
  }
}

function fakeRedisStore(redis: FakeRedis): RedisWsRateLimitStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new RedisWsRateLimitStore(redis as any, WS_RATE_LIMIT_WINDOW_MS);
}

describe("WebSocket IP rate limiting", () => {
  describe("shared Redis store", () => {
    it("counts connection attempts across replicas, not per replica", async () => {
      const redis = new FakeRedis();
      // Three replicas, each with its own store object over one Redis.
      const replicas: WsRateLimitStore[] = Array.from({ length: REPLICAS }, () =>
        fakeRedisStore(redis)
      );

      const now = 1_700_000_000_000;
      const counts: number[] = [];
      for (let i = 0; i < REPLICAS * 3; i++) {
        counts.push(await replicas[i % REPLICAS].hit(CLIENT_IP, now));
      }

      // Round-robin over 3 replicas still produces 1,2,3,... not 1,1,1,2,2,2.
      expect(counts).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it("exhausts the deployment-wide budget regardless of which replica is hit", async () => {
      const redis = new FakeRedis();
      const replicas = Array.from({ length: REPLICAS }, () => fakeRedisStore(redis));
      const now = 1_700_000_000_000;

      // Spend the whole budget on replica 0.
      for (let i = 0; i < WS_RATE_LIMIT_MAX; i++) {
        await replicas[0].hit(CLIENT_IP, now);
      }

      // A replica that has seen no traffic still sees the shared count.
      expect(await replicas[2].hit(CLIENT_IP, now)).toBeGreaterThan(WS_RATE_LIMIT_MAX);
    });

    it("starts a fresh bucket in the next window", async () => {
      const redis = new FakeRedis();
      const store = fakeRedisStore(redis);
      const now = 1_700_000_000_000;

      await store.hit(CLIENT_IP, now);
      await store.hit(CLIENT_IP, now);

      expect(await store.hit(CLIENT_IP, now + WS_RATE_LIMIT_WINDOW_MS)).toBe(1);
    });

    it("keeps separate buckets per IP", async () => {
      const redis = new FakeRedis();
      const store = fakeRedisStore(redis);
      const now = 1_700_000_000_000;

      await store.hit("198.51.100.1", now);
      await store.hit("198.51.100.1", now);

      expect(await store.hit("198.51.100.2", now)).toBe(1);
    });
  });

  describe("per-replica in-memory stores (the vulnerable configuration)", () => {
    it("gives each replica its own budget", async () => {
      const replicas = Array.from({ length: REPLICAS }, () => new InMemoryWsRateLimitStore());
      const now = 1_700_000_000_000;

      const counts = [];
      for (let i = 0; i < REPLICAS; i++) {
        counts.push(await replicas[i].hit(CLIENT_IP, now));
      }

      // Every replica thinks this is the client's first connection.
      expect(counts).toEqual([1, 1, 1]);
    });
  });

  describe("isWsIpRateLimited", () => {
    afterEach(async () => {
      await resetWsRateLimit();
      setWsRateLimitStore(new InMemoryWsRateLimitStore());
    });

    it("allows up to the cap and rejects beyond it", async () => {
      const now = 1_700_000_000_000;
      setWsRateLimitStore(new InMemoryWsRateLimitStore());

      for (let i = 0; i < WS_RATE_LIMIT_MAX; i++) {
        expect(await isWsIpRateLimited(CLIENT_IP, now)).toBe(false);
      }
      expect(await isWsIpRateLimited(CLIENT_IP, now)).toBe(true);
    });

    it("fails open when the store errors, rather than dropping every socket", async () => {
      setWsRateLimitStore({
        hit: async () => {
          throw new Error("redis down");
        },
        clear: async () => undefined,
      });

      const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
      expect(await isWsIpRateLimited(CLIENT_IP)).toBe(false);
      expect(errorSpy).toHaveBeenCalled();
      errorSpy.mockRestore();
    });
  });
});

describe("dm-relay loadConfig", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://linkora:linkora@localhost:5432/linkora_dm";
    delete process.env.REDIS_URL;
    delete process.env.ALLOW_IN_MEMORY_RATE_LIMIT;
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("fails startup in production without REDIS_URL", () => {
    process.env.NODE_ENV = "production";
    expect(() => loadConfig()).toThrow(/REDIS_URL is required when NODE_ENV=production/);
  });

  it("starts in production with REDIS_URL", () => {
    process.env.NODE_ENV = "production";
    process.env.REDIS_URL = "redis://redis:6379";
    expect(loadConfig().redisUrl).toBe("redis://redis:6379");
  });

  it("starts without REDIS_URL outside production", () => {
    process.env.NODE_ENV = "development";
    expect(loadConfig().redisUrl).toBeUndefined();
  });
});

describe("dm-relay health endpoints", () => {
  const db = { ping: jest.fn().mockResolvedValue(undefined) } as unknown as Database;

  interface HealthResponse {
    status: string;
    degraded?: boolean;
    rateLimiter?: { store: string; shared: boolean };
    checks?: { rateLimiter?: { store: string; shared: boolean } };
  }

  /** Serve the health router on an ephemeral port and GET one path from it. */
  async function get(
    path: string,
    shared: boolean
  ): Promise<{ status: number; body: HealthResponse }> {
    const app = express();
    app.use(
      createHealthRouter({
        db,
        startTime: Date.now(),
        isStarted: () => true,
        startedAt: () => new Date().toISOString(),
        isShuttingDown: () => false,
        rateLimitStatus: () => ({ store: shared ? "redis" : "memory", shared }),
      })
    );

    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const res = await fetch(`http://127.0.0.1:${port}${path}`);
      return { status: res.status, body: (await res.json()) as HealthResponse };
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it("reports ok with a shared store", async () => {
    const res = await get("/health", true);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.rateLimiter).toEqual({ store: "redis", shared: true });
  });

  it("reports degraded — but still 200 — with a memory-only store", async () => {
    const res = await get("/health", false);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.rateLimiter).toEqual({ store: "memory", shared: false });
  });

  it("surfaces the limiter on /health/ready without failing readiness", async () => {
    const res = await get("/health/ready", false);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.degraded).toBe(true);
    expect(res.body.checks?.rateLimiter).toEqual({ store: "memory", shared: false });
  });
});
