import { TypingRateLimitMap } from "../typing-rate-limit";

describe("TypingRateLimitMap", () => {
  it("get returns undefined for a key that was never touched", () => {
    const map = new TypingRateLimitMap(3000, 10);
    expect(map.get("a:b", 1000)).toBeUndefined();
  });

  it("get returns the last touch time within the TTL window", () => {
    const map = new TypingRateLimitMap(3000, 10);
    map.touch("a:b", 1000);
    expect(map.get("a:b", 1000)).toBe(1000);
    expect(map.get("a:b", 3999)).toBe(1000);
  });

  it("get treats an entry older than the TTL as absent", () => {
    const map = new TypingRateLimitMap(3000, 10);
    map.touch("a:b", 1000);
    expect(map.get("a:b", 4001)).toBeUndefined();
  });

  it("evicts expired entries as new pairs are touched, so the map does not grow forever", () => {
    const map = new TypingRateLimitMap(3000, 10_000);
    for (let i = 0; i < 500; i++) {
      map.touch(`pair-${i}`, i); // each pair "expires" long before the next batch below
    }
    expect(map.size).toBe(500);

    // Far in the future: every prior entry is now expired. A single new touch
    // sweeps them all (insertion order == recency order), not just its own key.
    map.touch("pair-new", 1_000_000);
    expect(map.size).toBe(1);
    expect(map.get("pair-new", 1_000_000)).toBe(1_000_000);
    expect(map.get("pair-0", 1_000_000)).toBeUndefined();
  });

  it("never exceeds maxEntries even when entries have not expired", () => {
    const map = new TypingRateLimitMap(3_600_000, 100); // 1h TTL, so nothing expires below
    for (let i = 0; i < 1000; i++) {
      map.touch(`pair-${i}`, i);
    }
    expect(map.size).toBeLessThanOrEqual(100);
  });

  it("the size cap evicts the least-recently-touched pair first (LRU)", () => {
    const map = new TypingRateLimitMap(3_600_000, 3);
    map.touch("a", 1);
    map.touch("b", 2);
    map.touch("c", 3);
    // Re-touching "a" makes it the most recent, so "b" is now the oldest.
    map.touch("a", 4);
    map.touch("d", 5); // over capacity: evicts the oldest, which is now "b"

    expect(map.size).toBe(3);
    expect(map.get("b", 5)).toBeUndefined();
    expect(map.get("a", 5)).toBe(4);
    expect(map.get("c", 5)).toBe(3);
    expect(map.get("d", 5)).toBe(5);
  });

  it("distinct address pairs never collapse into one entry", () => {
    const map = new TypingRateLimitMap(3000, 10);
    map.touch("GA:GB", 100);
    map.touch("GB:GA", 100); // the reverse pair is a different key
    expect(map.size).toBe(2);
  });
});
