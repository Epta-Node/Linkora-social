/**
 * Token-bucket rate limiter for outbound RPC calls.
 *
 * Smooths request bursts to a sustainable rate (default 10 req/s) so the
 * indexer doesn't trip RPC-side 429s under high event volume. The bucket
 * refills continuously at `ratePerSec` and holds at most `burst` tokens.
 *
 * The clock and sleep functions are injectable so the limiter can be tested
 * deterministically without real timers.
 */

export interface TokenBucketOptions {
  /** Sustained refill rate in tokens per second. */
  ratePerSec: number;
  /** Maximum tokens the bucket can hold (burst capacity). Defaults to ratePerSec. */
  burst?: number;
  /** Monotonic clock in milliseconds. Defaults to Date.now. */
  now?: () => number;
  /** Async sleep used when waiting for a token. Defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class TokenBucket {
  private readonly ratePerSec: number;
  private readonly capacity: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  private tokens: number;
  private lastRefill: number;

  constructor(opts: TokenBucketOptions) {
    if (opts.ratePerSec <= 0) {
      throw new Error("TokenBucket ratePerSec must be > 0");
    }
    this.ratePerSec = opts.ratePerSec;
    this.capacity = opts.burst ?? opts.ratePerSec;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
    this.tokens = this.capacity;
    this.lastRefill = this.now();
  }

  /** Refill the bucket based on elapsed wall-clock time. */
  private refill(): void {
    const ts = this.now();
    const elapsedSec = (ts - this.lastRefill) / 1000;
    if (elapsedSec <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.ratePerSec);
    this.lastRefill = ts;
  }

  /**
   * Try to take a token without waiting. Returns true if a token was
   * available (and consumed), false otherwise.
   */
  tryRemove(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Milliseconds until at least one token is available. */
  msUntilNextToken(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    const deficit = 1 - this.tokens;
    return Math.ceil((deficit / this.ratePerSec) * 1000);
  }

  /**
   * Acquire a token, waiting (sleeping) as long as necessary. Resolves once a
   * token has been consumed.
   */
  async acquire(): Promise<void> {
    // Loop because, after sleeping, a competing acquirer may have taken the
    // refilled token first.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.tryRemove()) return;
      await this.sleep(this.msUntilNextToken());
    }
  }
}

/**
 * Build a token bucket from env, with sane defaults.
 *   RPC_RATE_LIMIT_PER_SEC  — sustained rate (default 10)
 *   RPC_RATE_LIMIT_BURST    — burst capacity (default = rate)
 */
export function rateLimiterFromEnv(env: NodeJS.ProcessEnv = process.env): TokenBucket {
  const ratePerSec = env.RPC_RATE_LIMIT_PER_SEC ? Number(env.RPC_RATE_LIMIT_PER_SEC) : 10;
  const burst = env.RPC_RATE_LIMIT_BURST ? Number(env.RPC_RATE_LIMIT_BURST) : undefined;
  return new TokenBucket({ ratePerSec, burst });
}
