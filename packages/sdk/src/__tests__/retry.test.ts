import {
  backoffWithJitter,
  parseRetryAfter,
  getRetryAfterMs,
  isRateLimited,
  CircuitBreaker,
  withRetry,
  type RetryAttemptInfo,
} from "../utils/retry";
import { CircuitBreakerError } from "../errors";
import { DEFAULT_RETRY_CONFIG, type RetryConfig } from "../config";

const noJitterConfig: RetryConfig = {
  ...DEFAULT_RETRY_CONFIG,
  baseDelayMs: 10,
  maxDelayMs: 1000,
  jitterFactor: 0,
  maxAttempts: 4,
  circuitBreakerThreshold: 100,
};

describe("backoffWithJitter", () => {
  it("increases exponentially with each attempt", () => {
    const noJitter = () => 0;
    expect(backoffWithJitter(0, 100, 100_000, 0.5, noJitter)).toBe(100);
    expect(backoffWithJitter(1, 100, 100_000, 0.5, noJitter)).toBe(200);
    expect(backoffWithJitter(2, 100, 100_000, 0.5, noJitter)).toBe(400);
    expect(backoffWithJitter(3, 100, 100_000, 0.5, noJitter)).toBe(800);
  });

  it("caps the exponential term at maxDelayMs", () => {
    const noJitter = () => 0;
    expect(backoffWithJitter(20, 100, 5000, 0.5, noJitter)).toBe(5000);
  });

  it("adds up to jitterFactor * delay of jitter", () => {
    // random() === 1 → maximum jitter of jitterFactor * exponential
    expect(backoffWithJitter(0, 100, 100_000, 0.5, () => 1)).toBe(150);
    // random() === 0 → no jitter
    expect(backoffWithJitter(0, 100, 100_000, 0.5, () => 0)).toBe(100);
  });

  it("spreads delays across the jitter window (de-synchronizes retriers)", () => {
    const samples = Array.from({ length: 500 }, () =>
      backoffWithJitter(2, 100, 100_000, 0.5, Math.random)
    );
    const base = 400; // 100 * 2^2
    const maxWithJitter = base + base * 0.5; // 600
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(base);
      expect(s).toBeLessThanOrEqual(maxWithJitter);
    }
    const unique = new Set(samples);
    // With real randomness, delays should be well spread, not synchronized.
    expect(unique.size).toBeGreaterThan(100);
  });
});

describe("parseRetryAfter", () => {
  it("parses delta-seconds", () => {
    expect(parseRetryAfter("120")).toBe(120_000);
    expect(parseRetryAfter(30)).toBe(30_000);
  });

  it("parses HTTP-date form relative to now", () => {
    const now = 1_000_000_000_000;
    const future = new Date(now + 5000).toUTCString();
    expect(parseRetryAfter(future, now)).toBe(5000);
  });

  it("never returns a negative delay for past dates", () => {
    const now = 1_000_000_000_000;
    const past = new Date(now - 5000).toUTCString();
    expect(parseRetryAfter(past, now)).toBe(0);
  });

  it("returns undefined for missing or malformed values", () => {
    expect(parseRetryAfter(undefined)).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("")).toBeUndefined();
    expect(parseRetryAfter("not-a-date")).toBeUndefined();
  });
});

describe("getRetryAfterMs / isRateLimited", () => {
  it("reads retryAfterMs directly", () => {
    expect(getRetryAfterMs({ retryAfterMs: 2500 })).toBe(2500);
  });

  it("reads a retry-after header (seconds)", () => {
    expect(getRetryAfterMs({ status: 429, headers: { "retry-after": "3" } })).toBe(3000);
  });

  it("detects 429 responses", () => {
    expect(isRateLimited({ status: 429 })).toBe(true);
    expect(isRateLimited({ statusCode: 429 })).toBe(true);
    expect(isRateLimited({ headers: { "retry-after": "1" } })).toBe(true);
    expect(isRateLimited(new Error("boom"))).toBe(false);
  });
});

describe("CircuitBreaker", () => {
  it("opens after the configured number of consecutive failures", () => {
    const cb = new CircuitBreaker(3);
    expect(cb.isOpen).toBe(false);
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.isOpen).toBe(false);
    cb.recordFailure();
    expect(cb.isOpen).toBe(true);
    expect(cb.failures).toBe(3);
  });

  it("resets consecutive failures on success", () => {
    const cb = new CircuitBreaker(3);
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    expect(cb.failures).toBe(0);
    expect(cb.isOpen).toBe(false);
  });

  it("rejects an invalid threshold", () => {
    expect(() => new CircuitBreaker(0)).toThrow(RangeError);
  });
});

describe("withRetry", () => {
  const instantSleep = () => Promise.resolve();

  it("returns immediately on first success without retrying", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { config: noJitterConfig, sleep: instantSleep });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a transient failure then succeeds", async () => {
    let calls = 0;
    const fn = jest.fn(async () => {
      calls++;
      if (calls < 3) throw new Error("transient");
      return "recovered";
    });
    const attempts: RetryAttemptInfo[] = [];
    const result = await withRetry(fn, {
      config: noJitterConfig,
      sleep: instantSleep,
      onRetry: (i) => attempts.push(i),
    });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(attempts.map((a) => a.reason)).toEqual(["error", "error"]);
    expect(attempts[0].delayMs).toBe(10); // base * 2^0, no jitter
    expect(attempts[1].delayMs).toBe(20); // base * 2^1, no jitter
  });

  it("does not retry a non-retryable error", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("permanent"));
    await expect(
      withRetry(fn, { config: noJitterConfig, sleep: instantSleep, isRetryable: () => false })
    ).rejects.toThrow("permanent");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws the last error after exhausting attempts", async () => {
    const fn = jest.fn().mockRejectedValue(new Error("still failing"));
    const attempts: RetryAttemptInfo[] = [];
    await expect(
      withRetry(fn, {
        config: { ...noJitterConfig, maxAttempts: 3 },
        sleep: instantSleep,
        onRetry: (i) => attempts.push(i),
      })
    ).rejects.toThrow("still failing");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(attempts.at(-1)?.reason).toBe("exhausted");
  });

  it("honors a Retry-After delay over the computed backoff", async () => {
    let calls = 0;
    const fn = jest.fn(async () => {
      calls++;
      if (calls === 1) throw { status: 429, headers: { "retry-after": "2" } };
      return "ok";
    });
    const attempts: RetryAttemptInfo[] = [];
    const result = await withRetry(fn, {
      config: { ...noJitterConfig, maxDelayMs: 5000 },
      sleep: instantSleep,
      onRetry: (i) => attempts.push(i),
      now: () => 0,
    });
    expect(result).toBe("ok");
    expect(attempts[0].reason).toBe("rate-limited");
    expect(attempts[0].delayMs).toBe(2000);
  });

  it("opens the circuit breaker and pauses after the failure threshold", async () => {
    const cb = new CircuitBreaker(2);
    const fn = jest.fn().mockRejectedValue(new Error("down"));
    const attempts: RetryAttemptInfo[] = [];
    await expect(
      withRetry(fn, {
        config: { ...noJitterConfig, maxAttempts: 10, circuitBreakerThreshold: 2 },
        circuitBreaker: cb,
        sleep: instantSleep,
        onRetry: (i) => attempts.push(i),
      })
    ).rejects.toBeInstanceOf(CircuitBreakerError);
    // Two failures trip the breaker; it never reaches maxAttempts.
    expect(fn).toHaveBeenCalledTimes(2);
    expect(cb.isOpen).toBe(true);
    expect(attempts.at(-1)?.reason).toBe("circuit-open");
  });
});
