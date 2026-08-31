import { Pool } from "pg";
import { HealthMonitor } from "../health-monitor";

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
