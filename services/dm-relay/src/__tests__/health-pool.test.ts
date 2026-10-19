/**
 * /health reports pool status alongside the existing database ping (#888).
 */

import http from "http";
import express from "express";
import { createHealthRouter } from "../routes/health";
import { Database } from "../database";
import type { PoolHealthResult } from "../db-pool-monitor";

function fakeDatabase(overrides: Partial<Database> = {}): Database {
  return {
    ping: jest.fn().mockResolvedValue(undefined),
    getPoolHealth: jest.fn().mockResolvedValue({
      status: "healthy",
      latencyMs: 1,
      metrics: { totalCount: 5, idleCount: 4, waitingCount: 0 },
    } satisfies PoolHealthResult),
    ...overrides,
  } as unknown as Database;
}

async function startServer(db: Database): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(
    createHealthRouter({
      db,
      startTime: Date.now(),
      isStarted: () => true,
      startedAt: () => new Date().toISOString(),
      isShuttingDown: () => false,
      rateLimitStatus: () => ({ store: "redis", shared: true }),
    })
  );

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as { port: number };

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("GET /health pool reporting", () => {
  it("includes pool status and metrics alongside the database check", async () => {
    const { url, close } = await startServer(fakeDatabase());
    try {
      const res = await fetch(`${url}/health`);
      const body = (await res.json()) as any;

      expect(res.status).toBe(200);
      expect(body.checks.pool).toEqual({
        status: "healthy",
        totalCount: 5,
        idleCount: 4,
        waitingCount: 0,
      });
    } finally {
      await close();
    }
  });

  it("is degraded (503) when the pool is unhealthy even though ping() succeeds", async () => {
    const db = fakeDatabase({
      getPoolHealth: jest.fn().mockResolvedValue({
        status: "unhealthy",
        latencyMs: 2000,
        error: "Pool health check timed out after 2000ms",
        metrics: { totalCount: 20, idleCount: 0, waitingCount: 12 },
      } satisfies PoolHealthResult),
    });
    const { url, close } = await startServer(db);
    try {
      const res = await fetch(`${url}/health`);
      const body = (await res.json()) as any;

      expect(res.status).toBe(503);
      expect(body.status).toBe("degraded");
      expect(body.checks.pool.status).toBe("unhealthy");
      expect(body.checks.database.status).toBe("up"); // ping() alone would have looked fine
    } finally {
      await close();
    }
  });

  it("is degraded when ping() fails even though the pool metrics look healthy", async () => {
    const db = fakeDatabase({ ping: jest.fn().mockRejectedValue(new Error("down")) });
    const { url, close } = await startServer(db);
    try {
      const res = await fetch(`${url}/health`);
      const body = (await res.json()) as any;

      expect(res.status).toBe(503);
      expect(body.checks.database.status).toBe("down");
      expect(body.checks.pool.status).toBe("healthy");
    } finally {
      await close();
    }
  });
});
