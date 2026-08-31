/**
 * Minimal in-process Redis stand-in for the sorted-set commands the rate-limit
 * stores use (ZREMRANGEBYSCORE / ZADD / ZCARD / PEXPIRE / ZRANGEBYSCORE).
 *
 * A single instance is deliberately shared by several service instances in the
 * multi-replica tests: that shared instance is what makes the assertions
 * meaningful, since it models exactly what a real deployment's shared Redis
 * provides. The tests prefer a real Redis when `REDIS_URL` is set; this fake
 * exists so the same assertions still run in a CI job without a Redis daemon.
 */

interface SortedSetMember {
  score: number;
  member: string;
}

/** A queued command plus the resolver that returns its result from exec(). */
type PipelineOp = () => unknown;

export class FakeRedis {
  private sets = new Map<string, SortedSetMember[]>();
  private expiries = new Map<string, number>();

  /** Advanceable clock so TTL expiry can be tested without real waiting. */
  now: () => number = () => Date.now();

  private live(key: string): SortedSetMember[] {
    const expiresAt = this.expiries.get(key);
    if (expiresAt !== undefined && expiresAt <= this.now()) {
      this.sets.delete(key);
      this.expiries.delete(key);
    }
    let set = this.sets.get(key);
    if (!set) {
      set = [];
      this.sets.set(key, set);
    }
    return set;
  }

  pipeline(): FakePipeline {
    return new FakePipeline(this);
  }

  zremrangebyscore(key: string, min: string | number, max: string | number): number {
    const set = this.live(key);
    const lo = min === "-inf" ? -Infinity : Number(min);
    const hi = max === "+inf" ? Infinity : Number(max);
    const kept = set.filter((m) => m.score < lo || m.score > hi);
    const removed = set.length - kept.length;
    this.sets.set(key, kept);
    return removed;
  }

  zadd(key: string, score: number, member: string): number {
    const set = this.live(key);
    const existing = set.find((m) => m.member === member);
    if (existing) {
      existing.score = score;
      return 0;
    }
    set.push({ score, member });
    return 1;
  }

  zcard(key: string): number {
    return this.live(key).length;
  }

  pexpire(key: string, ms: number): number {
    this.expiries.set(key, this.now() + ms);
    return 1;
  }

  incr(key: string): number {
    const set = this.live(key);
    const next = set.length + 1;
    set.push({ score: next, member: String(next) });
    return next;
  }

  async zrangebyscore(
    key: string,
    min: string | number,
    max: string | number,
    ...args: (string | number)[]
  ): Promise<string[]> {
    const set = this.live(key);
    const lo = min === "-inf" ? -Infinity : Number(min);
    const hi = max === "+inf" ? Infinity : Number(max);
    let matches = set
      .filter((m) => m.score >= lo && m.score <= hi)
      .sort((a, b) => a.score - b.score)
      .map((m) => m.member);

    const limitIdx = args.findIndex((a) => String(a).toUpperCase() === "LIMIT");
    if (limitIdx !== -1) {
      const offset = Number(args[limitIdx + 1]);
      const count = Number(args[limitIdx + 2]);
      matches = matches.slice(offset, offset + count);
    }
    return matches;
  }

  async keys(pattern: string): Promise<string[]> {
    const prefix = pattern.replace(/\*$/, "");
    return [...this.sets.keys()].filter((k) => k.startsWith(prefix));
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) {
      if (this.sets.delete(key)) removed++;
      this.expiries.delete(key);
    }
    return removed;
  }

  /** Drop everything (between tests). */
  reset(): void {
    this.sets.clear();
    this.expiries.clear();
  }
}

/**
 * ioredis pipelines queue commands and run them on exec(). Ordering matters
 * here: the stores read `results[2]` for ZCARD, so exec() must return one
 * `[err, value]` tuple per queued command, in order.
 */
export class FakePipeline {
  private ops: PipelineOp[] = [];

  constructor(private redis: FakeRedis) {}

  zremrangebyscore(key: string, min: string | number, max: string | number): FakePipeline {
    this.ops.push(() => this.redis.zremrangebyscore(key, min, max));
    return this;
  }

  zadd(key: string, score: number, member: string): FakePipeline {
    this.ops.push(() => this.redis.zadd(key, score, member));
    return this;
  }

  zcard(key: string): FakePipeline {
    this.ops.push(() => this.redis.zcard(key));
    return this;
  }

  pexpire(key: string, ms: number): FakePipeline {
    this.ops.push(() => this.redis.pexpire(key, ms));
    return this;
  }

  incr(key: string): FakePipeline {
    this.ops.push(() => this.redis.incr(key));
    return this;
  }

  async exec(): Promise<Array<[Error | null, unknown]>> {
    return this.ops.map((op) => {
      try {
        return [null, op()] as [Error | null, unknown];
      } catch (err) {
        return [err as Error, null] as [Error | null, unknown];
      }
    });
  }
}
