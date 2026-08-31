import { TextEncoder, TextDecoder } from "util";

// The SDK's generated client pulls in @stellar/stellar-base which requires the
// global TextEncoder/TextDecoder in a JSDOM environment.
(globalThis as any).TextEncoder = (globalThis as any).TextEncoder || TextEncoder;
(globalThis as any).TextDecoder = (globalThis as any).TextDecoder || TextDecoder;

// api.ts imports the SDK client directly for fetchIsPaused; stub it so the
// heavy @stellar/stellar-base chain isn't loaded in this unit test.
jest.mock("../../../../packages/sdk/src/client", () => ({
  LinkoraClient: jest.fn(),
}));

import { createTtlCache } from "./api";

describe("createTtlCache (creator-token price cache, #1208)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("reuses the cached value for repeated reads within the TTL (single loader call)", async () => {
    const load = jest.fn().mockResolvedValue({ price: "1.25", volume24h: "5000" });
    const cache = createTtlCache<{ price: string; volume24h: string }>({
      load,
      ttlMs: 60_000,
    });

    const first = await cache.get();
    const second = await cache.get();
    const third = await cache.get();

    expect(first).toEqual({ price: "1.25", volume24h: "5000" });
    expect(second).toBe(first); // same cached object, not a fresh call
    expect(third).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("refetches after the TTL expires", async () => {
    const load = jest
      .fn()
      .mockResolvedValueOnce({ price: "1.25", volume24h: "5000" })
      .mockResolvedValueOnce({ price: "1.40", volume24h: "6200" });
    const cache = createTtlCache<{ price: string; volume24h: string }>({
      load,
      ttlMs: 60_000,
    });

    const first = await cache.get();

    jest.advanceTimersByTime(60_001);

    const second = await cache.get();

    expect(first.price).toBe("1.25");
    expect(second.price).toBe("1.40");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("deduplicates concurrent calls into a single in-flight request", async () => {
    const load = jest.fn().mockResolvedValue({ price: "2.00", volume24h: "100" });
    const cache = createTtlCache<{ price: string; volume24h: string }>({
      load,
      ttlMs: 60_000,
    });

    const [a, b] = await Promise.all([cache.get(), cache.get()]);

    expect(a).toBe(b);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("invalidates the cache so the next read refetches", async () => {
    const load = jest
      .fn()
      .mockResolvedValueOnce({ price: "1.00", volume24h: "10" })
      .mockResolvedValueOnce({ price: "3.00", volume24h: "30" });
    const cache = createTtlCache<{ price: string; volume24h: string }>({
      load,
      ttlMs: 60_000,
    });

    await cache.get();
    cache.invalidate();
    const second = await cache.get();

    expect(second.price).toBe("3.00");
    expect(load).toHaveBeenCalledTimes(2);
  });
});
