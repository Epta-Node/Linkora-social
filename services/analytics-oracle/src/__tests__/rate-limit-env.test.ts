/**
 * Analytics-oracle rate-limiting configuration and reporting.
 *
 * Covers:
 *  - startup fails in production when no shared rate-limit store is configured
 *  - the single-replica escape hatch
 *  - /health reporting the limiter's store and degraded status
 */

import http from "node:http";
import express from "express";
import { jest } from "@jest/globals";
import { Pool } from "pg";
import { RateLimitConfigError } from "@linkora/types/src/rate-limit-env.js";
import { loadRateLimitConfig } from "../config.js";
import { createHealthRouter, HealthDeps } from "../routes/health.js";

// Silence logger output during tests
jest.mock("../logger.js", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

// Mock global fetch so checkStellarRpc always succeeds without network
global.fetch = jest.fn(
  async () => ({ ok: true }) as unknown as Response
) as unknown as typeof fetch;

/** Pool whose queries resolve immediately. */
function okPool(): Pool {
  const client = {
    query: jest.fn(async () => ({ rows: [] })),
    release: jest.fn(),
  };
  return { connect: jest.fn(async () => client) } as unknown as Pool;
}

interface HealthResponse {
  status: string;
  degraded?: boolean;
  rateLimiter?: { store: string; shared: boolean };
  checks?: { rateLimiter?: { store: string; shared: boolean } };
}

function get(server: http.Server, path: string): Promise<{ status: number; body: HealthResponse }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request({ host: "127.0.0.1", port: addr.port, path, method: "GET" }, (res) => {
      let raw = "";
      res.on("data", (chunk: Buffer) => {
        raw += chunk.toString();
      });
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) as HealthResponse })
      );
    });
    req.on("error", reject);
    req.end();
  });
}

function startServer(deps: HealthDeps): { server: http.Server; close: () => Promise<void> } {
  const app = express();
  app.use(createHealthRouter(deps));
  const server = app.listen(0);
  const close = (): Promise<void> =>
    new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  return { server, close };
}

function makeDeps(shared: boolean): HealthDeps {
  return {
    db: okPool(),
    rpcUrl: "http://localhost:9999/rpc",
    startTime: Date.now() - 5_000,
    isStarted: () => true,
    startedAt: () => new Date().toISOString(),
    isShuttingDown: () => false,
    rateLimitStatus: () => ({ store: shared ? "redis" : "memory", shared }),
  };
}

describe("loadRateLimitConfig", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env["REDIS_URL"];
    delete process.env["ALLOW_IN_MEMORY_RATE_LIMIT"];
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("fails startup in production without REDIS_URL", () => {
    process.env["NODE_ENV"] = "production";
    expect(() => loadRateLimitConfig()).toThrow(RateLimitConfigError);
    expect(() => loadRateLimitConfig()).toThrow(/\[analytics-oracle\]/);
  });

  it("starts in production with REDIS_URL", () => {
    process.env["NODE_ENV"] = "production";
    process.env["REDIS_URL"] = "redis://redis:6379";

    const resolved = loadRateLimitConfig();
    expect(resolved.redisUrl).toBe("redis://redis:6379");
    expect(resolved.expected).toEqual({ store: "redis", shared: true });
  });

  it("allows the single-replica escape hatch in production", () => {
    process.env["NODE_ENV"] = "production";
    process.env["ALLOW_IN_MEMORY_RATE_LIMIT"] = "true";

    const resolved = loadRateLimitConfig();
    expect(resolved.inMemoryOptOut).toBe(true);
    expect(resolved.expected).toEqual({ store: "memory", shared: false });
  });

  it("starts without REDIS_URL outside production", () => {
    process.env["NODE_ENV"] = "development";
    expect(loadRateLimitConfig().redisUrl).toBeUndefined();
  });
});

describe("oracle health rate limiter reporting", () => {
  it("reports ok with a shared store", async () => {
    const { server, close } = startServer(makeDeps(true));
    try {
      const res = await get(server, "/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.rateLimiter).toEqual({ store: "redis", shared: true });
    } finally {
      await close();
    }
  });

  it("reports degraded — but still 200 — with a memory-only store", async () => {
    const { server, close } = startServer(makeDeps(false));
    try {
      const res = await get(server, "/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("degraded");
      expect(res.body.rateLimiter).toEqual({ store: "memory", shared: false });
    } finally {
      await close();
    }
  });

  it("surfaces the limiter on /health/ready without failing readiness", async () => {
    const { server, close } = startServer(makeDeps(false));
    try {
      const res = await get(server, "/health/ready");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ready");
      expect(res.body.degraded).toBe(true);
      expect(res.body.checks?.rateLimiter).toEqual({ store: "memory", shared: false });
    } finally {
      await close();
    }
  });
});
