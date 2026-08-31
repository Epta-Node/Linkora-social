/**
 * Adaptive poll-interval controller.
 *
 * Backpressure for the polling loop: when the stream is idle we back off to
 * avoid hammering the RPC node; when it's busy (a full page came back) we
 * speed up to keep latency low.
 *
 *   - empty batch (0 events)      → double the interval, capped at `maxMs`
 *   - full page (>= pageSize)     → halve the interval, floored at `minMs`
 *   - partial batch (1..pageSize) → keep the current interval
 */

export interface AdaptivePollOptions {
  /** Lower bound on the interval. Default 100ms. */
  minMs?: number;
  /** Upper bound on the interval. Default 5000ms. */
  maxMs?: number;
  /** Page size that counts as a "full" page. */
  pageSize: number;
  /** Starting interval. Defaults to maxMs (start slow, speed up under load). */
  startMs?: number;
}

export class AdaptivePoll {
  readonly minMs: number;
  readonly maxMs: number;
  private readonly pageSize: number;
  private current: number;

  constructor(opts: AdaptivePollOptions) {
    this.minMs = opts.minMs ?? 100;
    this.maxMs = opts.maxMs ?? 5_000;
    this.pageSize = opts.pageSize;
    this.current = this.clamp(opts.startMs ?? this.maxMs);
  }

  /** Current poll interval in milliseconds. */
  get intervalMs(): number {
    return this.current;
  }

  /**
   * Record the size of the batch just returned and return the next interval.
   */
  next(batchSize: number): number {
    if (batchSize <= 0) {
      this.current = this.clamp(this.current * 2);
    } else if (batchSize >= this.pageSize) {
      this.current = this.clamp(this.current / 2);
    }
    // partial batch: hold steady
    return this.current;
  }

  private clamp(ms: number): number {
    return Math.min(this.maxMs, Math.max(this.minMs, Math.round(ms)));
  }
}
