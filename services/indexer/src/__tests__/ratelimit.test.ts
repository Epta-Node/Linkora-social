/**
 * Token-bucket rate limiter tests, driven by a fake clock so behaviour is
 * deterministic and instant.
 */

import { TokenBucket, wsMaxMessageBytesFromEnv, DEFAULT_WS_MAX_MESSAGE_BYTES } from "../ratelimit";

/** Controllable clock + sleep where sleeping advances the clock. */
function fakeTime() {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("TokenBucket", () => {
  it("allows up to `burst` immediate requests, then throttles", () => {
    const t = fakeTime();
    const bucket = new TokenBucket({ ratePerSec: 10, burst: 3, now: t.now, sleep: t.sleep });

    expect(bucket.tryRemove()).toBe(true);
    expect(bucket.tryRemove()).toBe(true);
    expect(bucket.tryRemove()).toBe(true);
    expect(bucket.tryRemove()).toBe(false); // bucket drained
  });

  it("refills continuously at the configured rate", () => {
    const t = fakeTime();
    const bucket = new TokenBucket({ ratePerSec: 10, burst: 1, now: t.now, sleep: t.sleep });

    expect(bucket.tryRemove()).toBe(true);
    expect(bucket.tryRemove()).toBe(false);

    t.advance(100); // 10 req/s → one token per 100ms
    expect(bucket.tryRemove()).toBe(true);
  });

  it("acquire() waits for the next token instead of failing", async () => {
    const t = fakeTime();
    const bucket = new TokenBucket({ ratePerSec: 10, burst: 1, now: t.now, sleep: t.sleep });

    await bucket.acquire(); // consumes the initial token at t=0
    await bucket.acquire(); // must wait ~100ms for a refill

    expect(t.now()).toBeGreaterThanOrEqual(100);
  });

  it("never issues more than burst + rate*elapsed tokens", async () => {
    const t = fakeTime();
    const rate = 10;
    const burst = 1;
    const bucket = new TokenBucket({ ratePerSec: rate, burst, now: t.now, sleep: t.sleep });

    const n = 20;
    for (let i = 0; i < n; i++) {
      await bucket.acquire();
    }
    // Token-bucket invariant: tokens issued ≤ burst + rate * elapsed. The first
    // `burst` tokens are free; the rest are paced at `rate`, so n tokens take
    // (n - burst)/rate seconds.
    const elapsedSec = t.now() / 1000;
    expect(n).toBeLessThanOrEqual(burst + rate * elapsedSec + 0.001);
    expect(elapsedSec).toBeCloseTo((n - burst) / rate, 5);
  });

  it("reports msUntilNextToken when empty", () => {
    const t = fakeTime();
    const bucket = new TokenBucket({ ratePerSec: 5, burst: 1, now: t.now, sleep: t.sleep });
    bucket.tryRemove();
    expect(bucket.msUntilNextToken()).toBe(200); // 5 req/s → 200ms per token
  });

  it("rejects an invalid rate", () => {
    expect(() => new TokenBucket({ ratePerSec: 0 })).toThrow();
  });
});

describe("wsMaxMessageBytesFromEnv", () => {
  it("returns default when no env var is set", () => {
    expect(wsMaxMessageBytesFromEnv({})).toBe(DEFAULT_WS_MAX_MESSAGE_BYTES);
  });

  it("parses WS_MAX_MESSAGE_BYTES from env", () => {
    expect(wsMaxMessageBytesFromEnv({ WS_MAX_MESSAGE_BYTES: "1024" })).toBe(1024);
  });

  it("parses WS_MAX_PAYLOAD_BYTES from env fallback", () => {
    expect(wsMaxMessageBytesFromEnv({ WS_MAX_PAYLOAD_BYTES: "2048" })).toBe(2048);
  });

  it("falls back to default for invalid number", () => {
    expect(wsMaxMessageBytesFromEnv({ WS_MAX_MESSAGE_BYTES: "abc" })).toBe(DEFAULT_WS_MAX_MESSAGE_BYTES);
    expect(wsMaxMessageBytesFromEnv({ WS_MAX_MESSAGE_BYTES: "-10" })).toBe(DEFAULT_WS_MAX_MESSAGE_BYTES);
  });
});

