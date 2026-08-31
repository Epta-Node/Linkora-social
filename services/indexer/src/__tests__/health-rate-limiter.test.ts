/**
 * `/health` must make an unshared rate limiter visible.
 *
 * A per-replica limiter is a silent failure by nature: responses look normal
 * while the documented limits are not being enforced. The only way an operator
 * finds out is if the health endpoint says so.
 */

import request from "supertest";
import type { Pool } from "pg";
import { createApp } from "../api";
import { HealthMonitor } from "../services/health-monitor";
import type { Database } from "../db";

const stubDb = {} as Database;

/** A Pool that answers SELECT 1 and reports empty pool stats. */
function stubPool(): Pool {
  return {
    query: jest.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
    totalCount: 1,
    idleCount: 1,
    waitingCount: 0,
  } as unknown as Pool;
}

describe("GET /health rateLimiter component", () => {
  const originalFetch = global.fetch;

  beforeAll(() => {
    // Keep the Stellar RPC check "up" so readiness turns on the rate limiter.
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("reports a shared Redis store as ok", async () => {
    const monitor = new HealthMonitor(stubPool(), "https://rpc.example", () => ({
      store: "redis",
      shared: true,
    }));
    const app = createApp(stubDb, stubPool(), monitor);

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.rateLimiter).toEqual({ store: "redis", shared: true });
    expect(res.body.checks.rateLimiter).toEqual({ store: "redis", shared: true });
  });

  it("reports degraded — but still 200 — when the limiter is memory-only", async () => {
    const monitor = new HealthMonitor(stubPool(), "https://rpc.example", () => ({
      store: "memory",
      shared: false,
    }));
    const app = createApp(stubDb, stubPool(), monitor);

    const res = await request(app).get("/health");

    // 200, deliberately: the pod is serving correctly, so pulling it out of
    // the load balancer would turn a weak limit into an outage.
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.rateLimiter).toEqual({ store: "memory", shared: false });
  });

  it("surfaces the limiter on /health/ready without failing readiness", async () => {
    const monitor = new HealthMonitor(stubPool(), "https://rpc.example", () => ({
      store: "memory",
      shared: false,
    }));
    const app = createApp(stubDb, stubPool(), monitor);

    const res = await request(app).get("/health/ready");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.degraded).toBe(true);
    expect(res.body.checks.rateLimiter).toEqual({ store: "memory", shared: false });
  });
});
