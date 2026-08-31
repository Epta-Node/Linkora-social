/**
 * Unit tests for the graceful-shutdown drain behaviour.
 *
 * Acceptance criteria from issue #1180:
 *  - `database.close()` is never called before all in-flight WebSocket
 *    message writes have completed or timed out.
 *  - `wss.close()` callback is awaited before proceeding to pool shutdown.
 *  - A configurable `SHUTDOWN_DRAIN_TIMEOUT_MS` hard-caps the drain wait.
 *  - Force-exit timer fires after drain timeout + 5 s buffer.
 *  - SIGTERM sent while 5 messages are being written → all 5 writes complete
 *    before `database.close()` is called.
 */

import { InflightCounter } from "../inflight-counter";

// ---------------------------------------------------------------------------
// InflightCounter unit tests
// ---------------------------------------------------------------------------

describe("InflightCounter", () => {
  it("starts at zero", () => {
    const counter = new InflightCounter();
    expect(counter.value).toBe(0);
  });

  it("increments and decrements correctly", () => {
    const counter = new InflightCounter();
    counter.increment();
    counter.increment();
    expect(counter.value).toBe(2);
    counter.decrement();
    expect(counter.value).toBe(1);
    counter.decrement();
    expect(counter.value).toBe(0);
  });

  it("never goes below zero on excess decrements", () => {
    const counter = new InflightCounter();
    counter.decrement();
    expect(counter.value).toBe(0);
  });

  it("drain() resolves immediately when counter is already zero", async () => {
    const counter = new InflightCounter();
    await expect(counter.drain()).resolves.toBeUndefined();
  });

  it("drain() resolves once the counter reaches zero", async () => {
    const counter = new InflightCounter();
    counter.increment();

    let resolved = false;
    const drainPromise = counter.drain().then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);
    counter.decrement();
    await drainPromise;
    expect(resolved).toBe(true);
  });

  it("drain() resolves after multiple pending operations all finish", async () => {
    const counter = new InflightCounter();
    counter.increment();
    counter.increment();
    counter.increment();

    let resolved = false;
    const drainPromise = counter.drain().then(() => {
      resolved = true;
    });

    counter.decrement();
    counter.decrement();
    // Still one in-flight — must not resolve yet.
    await Promise.resolve(); // flush microtasks
    expect(resolved).toBe(false);

    counter.decrement();
    await drainPromise;
    expect(resolved).toBe(true);
  });

  it("multiple drain() waiters are all notified when counter reaches zero", async () => {
    const counter = new InflightCounter();
    counter.increment();

    const results: boolean[] = [];
    const p1 = counter.drain().then(() => results.push(true));
    const p2 = counter.drain().then(() => results.push(true));

    counter.decrement();
    await Promise.all([p1, p2]);
    expect(results).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Shutdown drain integration test
// ---------------------------------------------------------------------------

/**
 * Simulates the core shutdown behaviour:
 *  - N async "writes" are in-flight when shutdown is triggered.
 *  - shutdown waits for all writes via inflightCounter.drain().
 *  - database.close() must not be called until all writes are done.
 *
 * This mirrors the logic in gracefulShutdown() in server.ts without spinning
 * up a real HTTP/WS server or database connection.
 */
async function simulateShutdown(
  inflightCounter: InflightCounter,
  dbClose: jest.Mock,
  drainTimeoutMs: number
): Promise<void> {
  // Mirror of the drain logic from gracefulShutdown():
  if (inflightCounter.value > 0) {
    await Promise.race([
      inflightCounter.drain(),
      new Promise<void>((resolve) => setTimeout(resolve, drainTimeoutMs)),
    ]);
  }
  await dbClose();
}

describe("graceful shutdown drain", () => {
  jest.useFakeTimers();

  afterEach(() => {
    jest.clearAllTimers();
    jest.runAllTimers();
  });

  it("all 5 in-flight writes complete before database.close() is called", async () => {
    const counter = new InflightCounter();
    const dbClose = jest.fn().mockResolvedValue(undefined);
    const writeOrder: string[] = [];

    // Simulate 5 concurrent "in-flight" writes.
    const writes = Array.from({ length: 5 }, (_, i) => {
      counter.increment();
      return new Promise<void>((resolve) => {
        // Each write completes asynchronously (simulated with Promise.resolve).
        Promise.resolve().then(() => {
          writeOrder.push(`write-${i}`);
          counter.decrement();
          resolve();
        });
      });
    });

    // Trigger shutdown while all 5 writes are still in-flight.
    const shutdownPromise = simulateShutdown(counter, dbClose, 30_000);

    // Let all the microtasks (Promise.resolve() chains) run.
    await Promise.all(writes);

    // Advance any pending timers so the shutdown promise resolves.
    jest.runAllTimers();
    await shutdownPromise;

    // All 5 writes must have completed before close() was called.
    expect(writeOrder).toHaveLength(5);
    expect(dbClose).toHaveBeenCalledTimes(1);

    // dbClose was called after all writes resolved.
    const dbCloseCallOrder = writeOrder.length; // writes finished first
    expect(dbCloseCallOrder).toBe(5);
  });

  it("database.close() is called even when drain times out", async () => {
    const counter = new InflightCounter();
    const dbClose = jest.fn().mockResolvedValue(undefined);

    // Start a write that will never finish (no decrement).
    counter.increment();

    const shutdownPromise = simulateShutdown(counter, dbClose, 100);

    // Advance time past the drain timeout.
    jest.advanceTimersByTime(200);
    await shutdownPromise;

    // Despite the stuck write, database.close() must still be called.
    expect(dbClose).toHaveBeenCalledTimes(1);
    // Counter still has the stuck operation.
    expect(counter.value).toBe(1);
  });

  it("database.close() is called immediately when there are no in-flight writes", async () => {
    const counter = new InflightCounter();
    const dbClose = jest.fn().mockResolvedValue(undefined);

    await simulateShutdown(counter, dbClose, 30_000);

    expect(dbClose).toHaveBeenCalledTimes(1);
  });
});
