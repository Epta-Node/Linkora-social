import { Pool } from "pg";
import { HealthMonitor, STELLAR_RPC_LATENCY_THRESHOLD_MS } from "../health-monitor";

function mockPool(overrides: Partial<Pool> = {}): Pool {
  return {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    totalCount: 5,
    idleCount: 3,
    waitingCount: 1,
    ...overrides,
  } as unknown as Pool;
}

describe("HealthMonitor: pool metrics", () => {
  it("exposes pool totalCount/idleCount/waitingCount on readiness checks", async () => {
    const pool = mockPool();
    const monitor = new HealthMonitor(pool, "https://rpc.example");

    const result = await monitor.checkReadiness();

    expect(result.checks.pool).toEqual({
      totalCount: 5,
      idleCount: 3,
      waitingCount: 1,
    });
  });

  it("still reports pool stats while shutting down", async () => {
    const pool = mockPool({ totalCount: 2, idleCount: 2, waitingCount: 0 } as Partial<Pool>);
    const monitor = new HealthMonitor(pool, "https://rpc.example");

    monitor.markShuttingDown();
    const result = await monitor.checkReadiness();

    expect(result.ready).toBe(false);
    expect(result.checks.pool).toEqual({
      totalCount: 2,
      idleCount: 2,
      waitingCount: 0,
    });
  });
});

describe("HealthMonitor: Stellar RPC health check (issue #1881)", () => {
  const originalFetch = globalThis.fetch;

  const requiredTables = [
    "raw_events",
    "indexer_cursor",
    "indexer_state",
    "device_tokens",
    "notification_preferences",
    "blocks",
    "dm_keys",
    "posts",
  ];

  /** Pool that satisfies every readiness dependency so RPC alone decides `ready`. */
  function readyPool(): Pool {
    return mockPool({
      query: jest.fn().mockImplementation((sql: string) => {
        if (sql.includes("pg_tables")) {
          return Promise.resolve({ rows: requiredTables.map((tablename) => ({ tablename })) });
        }
        return Promise.resolve({ rows: [{ count: 1 }] });
      }),
    });
  }

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("pings the RPC endpoint and reports its latency on every readiness check", async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const monitor = new HealthMonitor(readyPool(), "https://rpc.example");

    const first = await monitor.checkReadiness();
    const second = await monitor.checkReadiness();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://rpc.example",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"method":"getLatestLedger"'),
      })
    );
    expect(first.checks.stellar_rpc.status).toBe("up");
    expect(second.checks.stellar_rpc.status).toBe("up");
    expect(first.checks.stellar_rpc.latencyMs).toBeGreaterThanOrEqual(0);
    expect(first.ready).toBe(true);
  });

  it("marks the service unhealthy when RPC latency exceeds 5 seconds", async () => {
    let now = 0;
    jest.spyOn(Date, "now").mockImplementation(() => now);
    globalThis.fetch = jest.fn().mockImplementation(async () => {
      now = STELLAR_RPC_LATENCY_THRESHOLD_MS + 100;
      return { ok: true } as Response;
    }) as unknown as typeof fetch;

    const monitor = new HealthMonitor(readyPool(), "https://rpc.example");
    const result = await monitor.checkReadiness();

    expect(result.checks.stellar_rpc).toEqual({
      status: "down",
      latencyMs: STELLAR_RPC_LATENCY_THRESHOLD_MS + 100,
    });
    expect(result.ready).toBe(false);
  });
});
