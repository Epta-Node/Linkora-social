import { EventEmitter } from "events";
import {
  attachPoolMonitoring,
  checkPoolHealth,
  getPoolMetrics,
  type PoolLogger,
} from "../db-pool-monitor";

class FakePool extends EventEmitter {
  totalCount = 5;
  idleCount = 3;
  waitingCount = 0;
  query = jest.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] });
}

function fakeLogger(): PoolLogger & { calls: Record<"info" | "warn" | "error", unknown[][]> } {
  const calls: Record<"info" | "warn" | "error", unknown[][]> = { info: [], warn: [], error: [] };
  return {
    calls,
    info: (...args: unknown[]) => void calls.info.push(args),
    warn: (...args: unknown[]) => void calls.warn.push(args),
    error: (...args: unknown[]) => void calls.error.push(args),
  };
}

describe("getPoolMetrics", () => {
  it("reads totalCount/idleCount/waitingCount off the pool", () => {
    const pool = new FakePool();
    expect(getPoolMetrics(pool)).toEqual({ totalCount: 5, idleCount: 3, waitingCount: 0 });
  });
});

describe("checkPoolHealth", () => {
  it("reports healthy when the query succeeds", async () => {
    const pool = new FakePool();
    const result = await checkPoolHealth(pool as any);
    expect(result.status).toBe("healthy");
    expect(result.error).toBeUndefined();
    expect(result.metrics).toEqual({ totalCount: 5, idleCount: 3, waitingCount: 0 });
    expect(pool.query).toHaveBeenCalledWith("SELECT 1");
  });

  it("reports unhealthy with the error message when the query rejects", async () => {
    const pool = new FakePool();
    pool.query.mockRejectedValue(new Error("connection terminated unexpectedly"));
    const result = await checkPoolHealth(pool as any);
    expect(result.status).toBe("unhealthy");
    expect(result.error).toBe("connection terminated unexpectedly");
  });

  it("reports unhealthy when the query hangs past the timeout", async () => {
    const pool = new FakePool();
    pool.query.mockImplementation(() => new Promise(() => {})); // never resolves
    const result = await checkPoolHealth(pool as any, 20);
    expect(result.status).toBe("unhealthy");
    expect(result.error).toMatch(/timed out after 20ms/);
  });
});

describe("attachPoolMonitoring", () => {
  it("logs and does not throw when the pool emits 'error' (the actual crash this issue fixes)", () => {
    const pool = new FakePool();
    const logger = fakeLogger();
    attachPoolMonitoring(pool as any, { logger, serviceName: "test-service" });

    expect(() => pool.emit("error", new Error("Connection terminated unexpectedly"))).not.toThrow();
    expect(logger.calls.error).toHaveLength(1);
    const [logged, message] = logger.calls.error[0];
    expect(message).toMatch(/idle client/);
    expect((logged as { service: string }).service).toBe("test-service");
  });

  it("logs structured connect and remove events", () => {
    const pool = new FakePool();
    const logger = fakeLogger();
    attachPoolMonitoring(pool as any, { logger, serviceName: "test-service" });

    pool.emit("connect");
    pool.emit("remove");

    expect(logger.calls.info).toHaveLength(2);
    expect(logger.calls.info[0][1]).toMatch(/connected/);
    expect(logger.calls.info[1][1]).toMatch(/removed/);
  });

  it("does not start a stats timer by default", () => {
    const pool = new FakePool();
    const logger = fakeLogger();
    const { stop } = attachPoolMonitoring(pool as any, { logger, serviceName: "test-service" });
    stop(); // must be safe to call even with no timer
    expect(logger.calls.info).toHaveLength(0);
  });

  it("logs pool stats on the configured interval and stop() clears it", () => {
    jest.useFakeTimers();
    try {
      const pool = new FakePool();
      const logger = fakeLogger();
      const { stop } = attachPoolMonitoring(pool as any, {
        logger,
        serviceName: "test-service",
        statsIntervalMs: 1000,
      });

      jest.advanceTimersByTime(3500);
      expect(logger.calls.info).toHaveLength(3);
      expect(logger.calls.info[0][1]).toMatch(/pool stats/);

      stop();
      jest.advanceTimersByTime(10_000);
      expect(logger.calls.info).toHaveLength(3); // no further logs after stop()
    } finally {
      jest.useRealTimers();
    }
  });
});
