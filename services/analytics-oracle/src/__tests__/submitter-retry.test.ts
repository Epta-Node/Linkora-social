import { withRetry, isTransientError, retryMetrics, resetRetryMetrics } from "../submitter.js";

/** Sleep stub that records requested delays instead of waiting. */
function recordingSleep(): { sleep: (ms: number) => Promise<void>; delays: number[] } {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
}

/**
 * Fake async function that fails with the given errors in order, then
 * resolves with `result`. Tracks how many times it was called.
 */
function flakyFn<T>(errors: Error[], result: T): { fn: () => Promise<T>; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    fn: async () => {
      calls++;
      const err = errors.shift();
      if (err) throw err;
      return result;
    },
  };
}

function transientError(): Error {
  const err = new Error("connect ECONNRESET");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (err as any).code = "ECONNRESET";
  return err;
}

beforeEach(() => {
  resetRetryMetrics();
});

describe("isTransientError", () => {
  it("classifies network error codes as transient", () => {
    for (const code of ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"]) {
      const err = new Error("boom");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (err as any).code = code;
      expect(isTransientError(err)).toBe(true);
    }
  });

  it("classifies 5xx responses as transient", () => {
    const err = new Error("Internal Server Error");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (err as any).status = 503;
    expect(isTransientError(err)).toBe(true);
  });

  it("classifies timeouts as transient", () => {
    expect(isTransientError(new Error("request timed out"))).toBe(true);
    expect(isTransientError(new Error("network timeout at: https://rpc"))).toBe(true);
  });

  it("classifies simulation errors as non-transient", () => {
    expect(isTransientError(new Error("Transaction simulation failed: HostError"))).toBe(false);
    expect(isTransientError(new Error("simulateTransaction error: invalid footprint"))).toBe(false);
  });

  it("classifies unknown errors as non-transient", () => {
    expect(isTransientError(new Error("something unexpected"))).toBe(false);
    expect(isTransientError("not even an error")).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns immediately on first-attempt success without sleeping", async () => {
    const { sleep, delays } = recordingSleep();
    const { fn, calls } = flakyFn([], "tx-hash");

    await expect(withRetry(fn, { sleep })).resolves.toBe("tx-hash");
    expect(calls()).toBe(1);
    expect(delays).toEqual([]);
    expect(retryMetrics.attempts).toBe(1);
    expect(retryMetrics.retries).toBe(0);
  });

  it("retries transient errors with exponential backoff (1s, 2s, 4s)", async () => {
    const { sleep, delays } = recordingSleep();
    const { fn, calls } = flakyFn(
      [transientError(), transientError(), transientError()],
      "tx-hash"
    );

    await expect(withRetry(fn, { sleep })).resolves.toBe("tx-hash");
    expect(calls()).toBe(4);
    expect(delays).toEqual([1_000, 2_000, 4_000]);
    expect(retryMetrics.retries).toBe(3);
    expect(retryMetrics.successesAfterRetry).toBe(1);
  });

  it("gives up after max retries and rethrows the last error", async () => {
    const { sleep, delays } = recordingSleep();
    const { fn, calls } = flakyFn(
      [transientError(), transientError(), transientError(), transientError()],
      "unreachable"
    );

    await expect(withRetry(fn, { sleep })).rejects.toThrow("ECONNRESET");
    // 1 initial attempt + 3 retries
    expect(calls()).toBe(4);
    expect(delays).toEqual([1_000, 2_000, 4_000]);
    expect(retryMetrics.exhaustedRetries).toBe(1);
  });

  it("does not retry non-transient (simulation) errors", async () => {
    const { sleep, delays } = recordingSleep();
    const { fn, calls } = flakyFn([new Error("Transaction simulation failed")], "unreachable");

    await expect(withRetry(fn, { sleep })).rejects.toThrow("simulation");
    expect(calls()).toBe(1);
    expect(delays).toEqual([]);
    expect(retryMetrics.retries).toBe(0);
    expect(retryMetrics.nonTransientFailures).toBe(1);
  });

  it("respects a custom maxRetries", async () => {
    const { sleep, delays } = recordingSleep();
    const { fn, calls } = flakyFn([transientError(), transientError()], "unreachable");

    await expect(withRetry(fn, { sleep, maxRetries: 1 })).rejects.toThrow();
    expect(calls()).toBe(2);
    expect(delays).toEqual([1_000]);
  });
});
