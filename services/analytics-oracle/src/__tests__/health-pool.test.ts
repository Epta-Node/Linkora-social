/**
 * GET /health reports pool utilisation alongside the database/RPC checks (#888).
 */

import http from "node:http";
import express from "express";
import { createHealthRouter, HealthDeps } from "../routes/health.js";
import { Pool } from "pg";
import { jest } from "@jest/globals";

// Mock global fetch so checkStellarRpc always succeeds without network,
// matching health.test.ts's pattern — these tests are about pool reporting.
global.fetch = jest.fn(
  async () => ({ ok: true }) as unknown as Response
) as unknown as typeof fetch;

interface PoolHealthResponse {
  checks: { pool: { totalCount: number; idleCount: number; waitingCount: number } };
}

function get(
  server: http.Server,
  path: string
): Promise<{ status: number; body: PoolHealthResponse }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request({ host: "127.0.0.1", port: addr.port, path, method: "GET" }, (res) => {
      let raw = "";
      res.on("data", (chunk: Buffer) => (raw += chunk.toString()));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) }));
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

function poolWithMetrics(totalCount: number, idleCount: number, waitingCount: number): Pool {
  const client = { query: jest.fn(async () => ({ rows: [] })), release: jest.fn() };
  return {
    connect: jest.fn(async () => client),
    totalCount,
    idleCount,
    waitingCount,
  } as unknown as Pool;
}

function makeDeps(db: Pool): HealthDeps {
  return {
    db,
    rpcUrl: "http://localhost:9999/rpc",
    startTime: Date.now() - 5_000,
    isStarted: () => true,
    startedAt: () => new Date().toISOString(),
    isShuttingDown: () => false,
  };
}

describe("GET /health pool reporting", () => {
  it("includes the pool's totalCount/idleCount/waitingCount", async () => {
    const { server, close } = startServer(makeDeps(poolWithMetrics(20, 15, 3)));
    try {
      const { status, body } = await get(server, "/health");
      expect(status).toBe(200);
      expect(body.checks.pool).toEqual({ totalCount: 20, idleCount: 15, waitingCount: 3 });
    } finally {
      await close();
    }
  });

  it("reflects a saturated pool (waitingCount > 0) even while the DB check itself is fast", async () => {
    const { server, close } = startServer(makeDeps(poolWithMetrics(20, 0, 12)));
    try {
      const { body } = await get(server, "/health");
      expect(body.checks.pool.waitingCount).toBe(12);
    } finally {
      await close();
    }
  });
});
