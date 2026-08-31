/**
 * Tests for AttestationCache — LRU eviction, TTL eviction, stats, and
 * purgeExpired().
 *
 * Acceptance criteria verified:
 *   ✓ Cache size is bounded (LRU eviction works correctly)
 *   ✓ LRU order is maintained across gets and sets
 *   ✓ Stale entries are evicted via TTL on access and via purgeExpired()
 *   ✓ Cache stats (size, hits, misses, evictions) are accurate
 *   ✓ Memory usage is stable (size never exceeds maxSize)
 */

import { AttestationCache } from "../attestation-cache.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCache(maxSize: number, ttlMs = 0) {
  return new AttestationCache<string>({ maxSize, ttlMs });
}

/** Advance the perceived clock by monkey-patching Date.now for the duration. */
function withFakeTime<T>(offsetMs: number, fn: () => T): T {
  const real = Date.now.bind(Date);
  Date.now = () => real() + offsetMs;
  try {
    return fn();
  } finally {
    Date.now = real;
  }
}

// ── Construction ──────────────────────────────────────────────────────────────

describe("AttestationCache — construction", () => {
  it("rejects maxSize < 1", () => {
    expect(() => makeCache(0)).toThrow(RangeError);
  });

  it("rejects negative ttlMs", () => {
    expect(() => new AttestationCache({ maxSize: 10, ttlMs: -1 })).toThrow(RangeError);
  });

  it("starts empty", () => {
    const c = makeCache(10);
    expect(c.size).toBe(0);
    expect(c.getStats()).toMatchObject({ size: 0, hits: 0, misses: 0, evictions: 0 });
  });
});

// ── Basic get / set / delete ──────────────────────────────────────────────────

describe("AttestationCache — basic operations", () => {
  it("returns undefined for missing keys", () => {
    const c = makeCache(10);
    expect(c.get("missing")).toBeUndefined();
    expect(c.getStats().misses).toBe(1);
  });

  it("stores and retrieves a value", () => {
    const c = makeCache(10);
    c.set("a", "hello");
    expect(c.get("a")).toBe("hello");
    expect(c.getStats().hits).toBe(1);
    expect(c.size).toBe(1);
  });

  it("updates an existing key in-place", () => {
    const c = makeCache(10);
    c.set("k", "v1");
    c.set("k", "v2");
    expect(c.get("k")).toBe("v2");
    expect(c.size).toBe(1); // still one entry
  });

  it("delete removes a key and returns true", () => {
    const c = makeCache(10);
    c.set("x", "val");
    expect(c.delete("x")).toBe(true);
    expect(c.size).toBe(0);
    expect(c.get("x")).toBeUndefined();
  });

  it("delete on missing key returns false", () => {
    const c = makeCache(10);
    expect(c.delete("ghost")).toBe(false);
  });
});

// ── LRU eviction ─────────────────────────────────────────────────────────────

describe("AttestationCache — LRU eviction", () => {
  it("size never exceeds maxSize", () => {
    const c = makeCache(3);
    c.set("a", "1");
    c.set("b", "2");
    c.set("c", "3");
    c.set("d", "4"); // triggers eviction of LRU ("a")
    expect(c.size).toBe(3);
  });

  it("evicts the least-recently-used entry", () => {
    const c = makeCache(3);
    c.set("a", "1");
    c.set("b", "2");
    c.set("c", "3");
    // "a" is now LRU; adding "d" should evict "a"
    c.set("d", "4");
    expect(c.get("a")).toBeUndefined(); // evicted
    expect(c.get("b")).toBe("2");
    expect(c.get("c")).toBe("3");
    expect(c.get("d")).toBe("4");
  });

  it("a get promotes the entry and changes LRU order", () => {
    const c = makeCache(3);
    c.set("a", "1");
    c.set("b", "2");
    c.set("c", "3");
    // Touch "a" — it is now MRU; "b" becomes LRU
    c.get("a");
    c.set("d", "4"); // should evict "b"
    expect(c.get("b")).toBeUndefined(); // evicted
    expect(c.get("a")).toBe("1");
    expect(c.get("c")).toBe("3");
  });

  it("updating an existing key promotes it to MRU", () => {
    const c = makeCache(3);
    c.set("a", "1");
    c.set("b", "2");
    c.set("c", "3");
    // Re-set "a" — it becomes MRU; "b" is now LRU
    c.set("a", "updated");
    c.set("d", "4"); // should evict "b"
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe("updated");
  });

  it("records eviction in stats", () => {
    const c = makeCache(2);
    c.set("a", "1");
    c.set("b", "2");
    c.set("c", "3"); // evicts "a"
    expect(c.getStats().evictions).toBe(1);
  });

  it("can fill and evict many times without growing beyond maxSize", () => {
    const c = makeCache(5);
    for (let i = 0; i < 1000; i++) {
      c.set(`k${i}`, `v${i}`);
      expect(c.size).toBeLessThanOrEqual(5);
    }
  });
});

// ── TTL eviction ──────────────────────────────────────────────────────────────

describe("AttestationCache — TTL eviction", () => {
  it("returns value before TTL expires", () => {
    const c = new AttestationCache<string>({ maxSize: 10, ttlMs: 1000 });
    c.set("k", "fresh");
    expect(c.get("k")).toBe("fresh");
  });

  it("returns undefined and evicts after TTL expires on get", () => {
    const c = new AttestationCache<string>({ maxSize: 10, ttlMs: 500 });
    c.set("k", "stale");
    // Simulate time past TTL
    const result = withFakeTime(600, () => c.get("k"));
    expect(result).toBeUndefined();
    expect(c.size).toBe(0);
    expect(c.getStats().evictions).toBe(1);
    expect(c.getStats().misses).toBe(1);
  });

  it("purgeExpired removes all stale entries and returns count", () => {
    const c = new AttestationCache<string>({ maxSize: 10, ttlMs: 500 });
    c.set("a", "1");
    c.set("b", "2");
    c.set("c", "3");
    const evicted = withFakeTime(600, () => c.purgeExpired());
    expect(evicted).toBe(3);
    expect(c.size).toBe(0);
    expect(c.getStats().evictions).toBe(3);
  });

  it("purgeExpired leaves live entries intact", () => {
    const c = new AttestationCache<string>({ maxSize: 10, ttlMs: 1000 });
    c.set("stale", "old");
    // Add a "newer" entry by using fake time so it has a later insertedAt
    withFakeTime(800, () => c.set("fresh", "new"));
    // At +1100ms: "stale" (inserted at t=0) is expired; "fresh" (inserted at t=800) is not
    const evicted = withFakeTime(1100, () => c.purgeExpired());
    expect(evicted).toBe(1);
    expect(c.get("stale")).toBeUndefined();
    // "fresh" was inserted at real+800, checked at real+1100 → skew = 300ms < 1000ms ttl
    // but we need to read "fresh" at the same offset
    const freshVal = withFakeTime(1100, () => c.get("fresh"));
    expect(freshVal).toBe("new");
  });

  it("TTL=0 means entries never expire", () => {
    const c = new AttestationCache<string>({ maxSize: 10, ttlMs: 0 });
    c.set("k", "val");
    const result = withFakeTime(99_999_999, () => c.get("k"));
    expect(result).toBe("val");
  });

  it("set refreshes TTL on update — re-inserted entry lives longer", () => {
    const c = new AttestationCache<string>({ maxSize: 10, ttlMs: 500 });
    c.set("k", "v1");
    // Re-set at +400ms — TTL is now measured from +400ms
    withFakeTime(400, () => c.set("k", "v2"));
    // At +600ms original would have expired, but re-set refreshed TTL
    const result = withFakeTime(600, () => c.get("k"));
    expect(result).toBe("v2"); // still alive
  });
});

// ── Stats ─────────────────────────────────────────────────────────────────────

describe("AttestationCache — stats", () => {
  it("getStats returns correct maxSize and ttlMs", () => {
    const c = new AttestationCache<string>({ maxSize: 42, ttlMs: 9999 });
    expect(c.getStats()).toMatchObject({ maxSize: 42, ttlMs: 9999 });
  });

  it("tracks hits and misses independently", () => {
    const c = makeCache(10);
    c.set("a", "x");
    c.get("a"); // hit
    c.get("a"); // hit
    c.get("b"); // miss
    expect(c.getStats()).toMatchObject({ hits: 2, misses: 1 });
  });

  it("eviction count covers both LRU and TTL evictions", () => {
    const c = new AttestationCache<string>({ maxSize: 2, ttlMs: 100 });
    c.set("a", "1");
    c.set("b", "2");
    c.set("c", "3"); // LRU eviction of "a"
    withFakeTime(200, () => c.purgeExpired()); // TTL eviction of "b" and "c"
    expect(c.getStats().evictions).toBe(3);
  });

  it("size in stats matches actual entry count", () => {
    const c = makeCache(10);
    c.set("x", "1");
    c.set("y", "2");
    c.set("z", "3");
    c.delete("y");
    const stats = c.getStats();
    expect(stats.size).toBe(2);
    expect(stats.size).toBe(c.size);
  });
});

// ── Whole-cache invalidation (signer rotation / window advancement) ─────────

describe("AttestationCache — invalidation", () => {
  it("clear() drops every entry regardless of TTL", () => {
    const c = makeCache(10);
    c.set("a", "1");
    c.set("b", "2");
    c.clear();
    expect(c.size).toBe(0);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBeUndefined();
  });

  it("clear() resets the linked list so cached entries cannot resurface", () => {
    const c = makeCache(10);
    c.set("a", "1");
    c.set("b", "2");
    c.clear();
    // Re-insert and read — the list must be intact after the resize.
    c.set("c", "3");
    expect(c.get("c")).toBe("3");
    expect(c.size).toBe(1);
  });

  it("setSignerId clears the cache when the signer key rotates", () => {
    const c = makeCache(10);
    c.setSignerId("signer-v1");
    c.set("creatorA", "att-v1");
    c.set("creatorB", "att-v2");

    // Key rotation: same identity must not clear, a different one must.
    c.setSignerId("signer-v1");
    expect(c.size).toBe(2);

    c.setSignerId("signer-v2");
    expect(c.size).toBe(0);
    expect(c.get("creatorA")).toBeUndefined();
    expect(c.get("creatorB")).toBeUndefined();
  });

  it("setSignerId(null) — moving from a known signer to none clears the cache", () => {
    const c = makeCache(10);
    c.setSignerId("signer");
    c.set("k", "v");
    c.setSignerId(null);
    expect(c.size).toBe(0);
    // And stays cleared rather than re-clearing on every null call.
    c.set("k2", "v2");
    c.setSignerId(null);
    expect(c.size).toBe(1);
  });

  it("beginWindow clears the cache once the report window advances", () => {
    const c = makeCache(10);
    c.beginWindow(1n, 1000n);
    c.set("creatorA", "att-window-1000");
    c.set("creatorB", "att-window-1000");

    // Same window — entries survive.
    c.beginWindow(1n, 1000n);
    expect(c.size).toBe(2);

    // Window advances — closed-window attestations are dropped.
    c.beginWindow(1001n, 2000n);
    expect(c.size).toBe(0);
    expect(c.get("creatorA")).toBeUndefined();
  });

  it("beginWindow then a fresh window stores and serves only current-window entries", () => {
    const c = makeCache(10);
    c.beginWindow(1n, 1000n);
    c.set("creatorA", "stale");
    c.beginWindow(1001n, 2000n);
    c.set("creatorA", "current");
    expect(c.get("creatorA")).toBe("current");
    expect(c.size).toBe(1);
  });
});
