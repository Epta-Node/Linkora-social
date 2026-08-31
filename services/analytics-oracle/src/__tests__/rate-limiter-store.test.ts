import { InMemoryRateLimitStore } from "../middleware/rate-limiter.js";

const WINDOW_MS = 60_000;

describe("InMemoryRateLimitStore", () => {
  it("counts requests within the window", async () => {
    const store = new InMemoryRateLimitStore(0);
    const now = 1_000_000;

    expect(await store.addAndCount("ip-1", now, WINDOW_MS)).toBe(1);
    expect(await store.addAndCount("ip-1", now + 10, WINDOW_MS)).toBe(2);
    expect(await store.addAndCount("ip-1", now + 20, WINDOW_MS)).toBe(3);
  });

  it("prunes timestamps outside the window", async () => {
    const store = new InMemoryRateLimitStore(0);
    const now = 1_000_000;

    await store.addAndCount("ip-1", now, WINDOW_MS);
    expect(await store.addAndCount("ip-1", now + WINDOW_MS + 1, WINDOW_MS)).toBe(1);
  });

  it("oldestInWindow returns the oldest in-window timestamp", async () => {
    const store = new InMemoryRateLimitStore(0);
    const now = 1_000_000;

    await store.addAndCount("ip-1", now, WINDOW_MS);
    await store.addAndCount("ip-1", now + 100, WINDOW_MS);
    await store.addAndCount("ip-1", now + 200, WINDOW_MS);

    expect(await store.oldestInWindow("ip-1", now + 200, WINDOW_MS)).toBe(now);
    // Once `now` falls out of the window the next timestamp becomes oldest.
    expect(await store.oldestInWindow("ip-1", now + WINDOW_MS + 50, WINDOW_MS)).toBe(now + 100);
  });

  it("oldestInWindow stays correct under a large request count", async () => {
    const store = new InMemoryRateLimitStore(0);
    const now = 1_000_000;
    const count = 10_000;
    const windowMs = 5_000;

    for (let i = 0; i < count; i++) {
      await store.addAndCount("ip-1", now + i, windowMs);
    }
    // Only the last `windowMs` worth of timestamps remain in-window.
    const queryTime = now + count - 1;
    expect(await store.oldestInWindow("ip-1", queryTime, windowMs)).toBe(queryTime - windowMs + 1);
  });

  it("evicts the least-recently-used key when the max entries cap is reached", async () => {
    const store = new InMemoryRateLimitStore(0, 3);
    const now = 1_000_000;

    await store.addAndCount("ip-1", now, WINDOW_MS);
    await store.addAndCount("ip-2", now, WINDOW_MS);
    await store.addAndCount("ip-3", now, WINDOW_MS);
    // Touch ip-1 so ip-2 becomes the least recently used.
    await store.addAndCount("ip-1", now + 10, WINDOW_MS);

    await store.addAndCount("ip-4", now + 20, WINDOW_MS);

    expect(store.size()).toBe(3);
    // ip-2 was evicted: a new request for it starts a fresh window.
    expect(await store.addAndCount("ip-2", now + 30, WINDOW_MS)).toBe(1);
    // ip-1 survived: its history is intact.
    expect(await store.addAndCount("ip-1", now + 40, WINDOW_MS)).toBe(3);
  });
});
