/**
 * Unit tests for services/analytics-oracle/src/routes/health.ts
 *
 * Covers:
 *  - /health/live always returns 200
 *  - /health/ready returns 200 when DB and RPC are up
 *  - /health/ready returns 503 when DB connection fails
 *  - /health/ready returns 503 with error:timeout when DB hangs past 5 s
 *  - /health/ready returns 503 while shutting down (DB not touched)
 *  - /health/startup returns 200 once started, 503 while starting
 */

import http from "node:http";
import express from "express";
import { createHealthRouter, HealthDeps } from "../routes/health.js";
import { Pool } from "pg";
import { jest } from "@jest/globals";

// ── helpers ───────────────────────────────────────────────────────────────────

/** Send a GET request to the given server and return { status, body }. */
function get(server: http.Server, path: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request({ host: "127.0.0.1", port: addr.port, path, method: "GET" }, (res) => {
      let raw = "";
      res.on("data", (chunk: Buffer) => {
        raw += chunk.toString();
      });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode ?? 0, body: raw });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

/** Start a temporary express server and return it along with a cleanup fn. */
function startServer(deps: HealthDeps): { server: http.Server; close: () => Promise<void> } {
  const app = express();
  app.use(createHealthRouter(deps));
  const server = app.listen(0); // port 0 → OS assigns a free port
  const close = (): Promise<void> =>
    new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  return { server, close };
}

function makeDeps(overrides: Partial<HealthDeps> = {}): HealthDeps {
  return {
    db: okPool(),
    rpcUrl: "http://localhost:9999/rpc",
    startTime: Date.now() - 5_000,
    isStarted: () => true,
    startedAt: () => new Date().toISOString(),
    isShuttingDown: () => false,
    ...overrides,
  };
}

/** Pool whose queries resolve immediately. */
function okPool(): Pool {
  const client = {
    query: jest.fn(async () => ({ rows: [] })),
    release: jest.fn(),
  };
  return { connect: jest.fn(async () => client) } as unknown as Pool;
}

/** Pool whose connect() rejects — simulates a refused connection. */
function errorPool(msg = "connection refused"): Pool {
  return {
    connect: jest.fn(async () => {
      throw new Error(msg);
    }),
  } as unknown as Pool;
}

/**
 * Pool whose connect() resolves but whose query() hangs forever for SELECT 1.
 * The SET statement_timeout query resolves instantly so the driver initialisation
 * succeeds; only the actual health-check query blocks.
 */
function hangingPool(hangMs = 30_000): Pool {
  const client = {
    query: jest.fn(async (sql: string) => {
      if (typeof sql === "string" && sql.startsWith("SET statement_timeout")) {
        return { rows: [] };
      }
      return await new Promise((_res) => setTimeout(_res, hangMs));
    }),
    release: jest.fn(),
  };
  return { connect: jest.fn(async () => client) } as unknown as Pool;
}

// Silence logger output during tests
jest.mock("../logger.js", () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
  default: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

// Mock global fetch so checkStellarRpc always succeeds without network
global.fetch = jest.fn(
  async () => ({ ok: true }) as unknown as Response
) as unknown as typeof fetch;

// ── tests ─────────────────────────────────────────────────────────────────────

describe("GET /health/live", () => {
  it("returns 200 with status:alive", async () => {
    const { server, close } = startServer(makeDeps());
    try {
      const { status, body } = await get(server, "/health/live");
      expect(status).toBe(200);
      expect((body as Record<string, unknown>).status).toBe("alive");
      expect(typeof (body as Record<string, unknown>).uptime).toBe("number");
    } finally {
      await close();
    }
  });
});

describe("GET /health/ready", () => {
  it("returns 200 when DB and RPC are healthy", async () => {
    const { server, close } = startServer(makeDeps());
    try {
      const { status, body } = await get(server, "/health/ready");
      const b = body as Record<string, unknown>;
      expect(status).toBe(200);
      expect(b.status).toBe("ready");
      expect((b.checks as Record<string, unknown>).database).toMatchObject({ status: "up" });
    } finally {
      await close();
    }
  });

  it("returns 503 when DB connection fails", async () => {
    const { server, close } = startServer(makeDeps({ db: errorPool() }));
    try {
      const { status, body } = await get(server, "/health/ready");
      const b = body as Record<string, unknown>;
      expect(status).toBe(503);
      expect(b.status).toBe("not_ready");
      expect((b.checks as Record<string, unknown>).database).toMatchObject({ status: "down" });
    } finally {
      await close();
    }
  });

  it("returns 503 with error:timeout when DB hangs past 5 s", async () => {
    const { server, close } = startServer(makeDeps({ db: hangingPool(60_000) }));
    try {
      // Use real timers: the handler's 5s abort timer fires naturally even
      // though the mocked SELECT 1 never resolves.
      const { status, body } = await get(server, "/health/ready");
      const checks = (body as Record<string, unknown>).checks as Record<string, unknown>;
      expect(status).toBe(503);
      expect(checks.database).toMatchObject({ status: "down", error: "timeout" });
    } finally {
      await close();
    }
  }, 15_000);

  it("returns 503 immediately while shutting down and does not touch DB", async () => {
    const pool = okPool();
    const { server, close } = startServer(makeDeps({ db: pool, isShuttingDown: () => true }));
    try {
      const { status, body } = await get(server, "/health/ready");
      expect(status).toBe(503);
      expect((body as Record<string, unknown>).status).toBe("not_ready");
      // Pool.connect must never be called during the shutdown fast-path
      expect((pool.connect as unknown as jest.Mock).mock.calls.length).toBe(0);
    } finally {
      await close();
    }
  });
});

describe("GET /health/startup", () => {
  it("returns 200 with status:started when bootstrap is done", async () => {
    const { server, close } = startServer(makeDeps({ isStarted: () => true }));
    try {
      const { status, body } = await get(server, "/health/startup");
      expect(status).toBe(200);
      expect((body as Record<string, unknown>).status).toBe("started");
    } finally {
      await close();
    }
  });

  it("returns 503 with status:starting while bootstrap is in progress", async () => {
    const { server, close } = startServer(makeDeps({ isStarted: () => false }));
    try {
      const { status, body } = await get(server, "/health/startup");
      expect(status).toBe(503);
      expect((body as Record<string, unknown>).status).toBe("starting");
    } finally {
      await close();
    }
  });
});
