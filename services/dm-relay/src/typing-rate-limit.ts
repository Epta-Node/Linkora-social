/**
 * Bounded store for the typing-notification rate limit (issue #1330).
 *
 * `routes.ts` throttles typing events per `${sender}:${recipient}` pair. A
 * plain `Map` keyed this way never shrinks: every new pair that ever types
 * adds an entry that lives forever, so a long-running relay's memory grows
 * without bound as distinct pairs accumulate.
 *
 * This wraps a `Map<string, number>` (pair -> last-sent timestamp) with:
 *
 * - **TTL eviction**: an entry older than `ttlMs` (the same window used to
 *   throttle, so an expired entry could not affect the next check anyway) is
 *   dropped. `Map` iterates in insertion order, and `touch` re-inserts a key
 *   it updates, so the oldest entries always sit at the front — pruning stops
 *   at the first still-live entry instead of scanning the whole map.
 * - **A hard size cap** as a backstop against timestamps that never expire
 *   (a stalled clock, `ttlMs = Infinity`, or the eviction sweep skipped by
 *   packed rapid-fire calls): once at the cap, the single oldest entry is
 *   evicted before the new one is added, keeping the map bounded regardless.
 */
export class TypingRateLimitMap {
  private readonly map = new Map<string, number>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number
  ) {}

  get size(): number {
    return this.map.size;
  }

  /** Removes every entry last touched more than `ttlMs` ago. */
  private evictExpired(now: number): void {
    for (const [key, lastSent] of this.map) {
      if (now - lastSent > this.ttlMs) {
        this.map.delete(key);
      } else {
        // Insertion order == recency order (touch() re-inserts on update),
        // so the first non-expired entry means everything after it is too.
        break;
      }
    }
  }

  /**
   * Returns the last-touch timestamp for `key`, or `undefined` if it has none
   * or its entry has expired. Does not itself evict or record anything.
   */
  get(key: string, now: number = Date.now()): number | undefined {
    const lastSent = this.map.get(key);
    if (lastSent === undefined || now - lastSent > this.ttlMs) return undefined;
    return lastSent;
  }

  /** Records `key` as touched at `now`, pruning expired entries first. */
  touch(key: string, now: number = Date.now()): void {
    this.evictExpired(now);
    // Re-inserting an existing key moves it to the end (most recent),
    // keeping insertion order equal to recency order for evictExpired above.
    this.map.delete(key);
    if (this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) this.map.delete(oldestKey);
    }
    this.map.set(key, now);
  }
}
