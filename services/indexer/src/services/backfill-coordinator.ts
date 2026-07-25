/**
 * Configurable backfill coordinator for Soroban event gap recovery.
 *
 * Responsibilities:
 *   - Detect gap size and decide whether auto-backfill is safe.
 *   - Process events in batches with rate limiting.
 *   - Track backfill progress with structured logging.
 *   - Circuit-breaker: stop after N consecutive batch failures and require
 *     manual intervention.
 *   - Expose health status: "healthy" | "backfilling" | "gap_too_large" |
 *     "circuit_open".
 *
 * This coordinator is intentionally decoupled from the raw RPC fetch layer;
 * it receives a `fetchRange` function so it can be unit-tested in isolation.
 */

import { BackfillConfig } from "../config";
import { RawEvent, BatchProcessor } from "./event-stream";

// ── Public types ─────────────────────────────────────────────────────────────

export type BackfillStatus =
  | "healthy"
  | "backfilling"
  | "gap_too_large"
  | "circuit_open";

export interface BackfillProgress {
  status: BackfillStatus;
  fromLedger?: number;
  toLedger?: number;
  processedLedgers: number;
  totalLedgers: number;
  consecutiveFailures: number;
}

/** Fetches all events in the inclusive ledger range [from, to]. */
export type RangeFetcher = (
  fromLedger: number,
  toLedger: number,
  signal: AbortSignal
) => Promise<RawEvent[]>;

// ── Circuit-breaker state ────────────────────────────────────────────────────

export class CircuitBreakerOpenError extends Error {
  constructor(failures: number, maxFailures: number) {
    super(
      `Backfill circuit breaker tripped after ${failures} consecutive failures ` +
        `(max=${maxFailures}). Manual intervention required.`
    );
    this.name = "CircuitBreakerOpenError";
  }
}

// ── Coordinator ──────────────────────────────────────────────────────────────

export class BackfillCoordinator {
  private _status: BackfillStatus = "healthy";
  private _progress: BackfillProgress = {
    status: "healthy",
    processedLedgers: 0,
    totalLedgers: 0,
    consecutiveFailures: 0,
  };

  constructor(
    private readonly config: BackfillConfig,
    private readonly fetchRange: RangeFetcher,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise<void>((r) => setTimeout(r, ms))
  ) {}

  get status(): BackfillStatus {
    return this._status;
  }

  get progress(): Readonly<BackfillProgress> {
    return { ...this._progress };
  }

  /**
   * Attempt to recover a detected gap.
   *
   * - If `gapSize > maxDepthLedgers` → marks status as `gap_too_large`, emits
   *   alert, and returns without backfilling.
   * - If the circuit breaker is already open → throws `CircuitBreakerOpenError`.
   * - Otherwise processes the gap in batches of `batchSize` ledgers with
   *   `rateLimitMs` delay between each batch.
   *
   * @returns true when the gap was fully recovered, false when it was skipped
   *          due to depth limit.
   * @throws  CircuitBreakerOpenError when the circuit breaker is open.
   */
  async recoverGap(
    fromLedger: number,
    toLedger: number,
    processBatch: BatchProcessor,
    signal: AbortSignal
  ): Promise<boolean> {
    if (this._status === "circuit_open") {
      throw new CircuitBreakerOpenError(
        this._progress.consecutiveFailures,
        this.config.circuitBreakerMaxFailures
      );
    }

    const gapSize = toLedger - fromLedger + 1;

    // Gap too large — alert and skip.
    if (gapSize > this.config.maxDepthLedgers) {
      this._status = "gap_too_large";
      this._progress = {
        ...this._progress,
        status: "gap_too_large",
        fromLedger,
        toLedger,
        processedLedgers: 0,
        totalLedgers: gapSize,
      };
      console.error(
        JSON.stringify({
          metric: "backfill_gap_too_large",
          message: "Gap exceeds maximum backfill depth. Manual intervention required.",
          fromLedger,
          toLedger,
          gapSize,
          maxDepthLedgers: this.config.maxDepthLedgers,
        })
      );
      return false;
    }

    // Emit alert if gap exceeds alert threshold (but is still within max depth).
    if (gapSize >= this.config.alertThreshold) {
      console.warn(
        JSON.stringify({
          metric: "backfill_alert",
          message: "Gap size exceeds alert threshold",
          fromLedger,
          toLedger,
          gapSize,
          alertThreshold: this.config.alertThreshold,
        })
      );
    }

    this._status = "backfilling";
    this._progress = {
      status: "backfilling",
      fromLedger,
      toLedger,
      processedLedgers: 0,
      totalLedgers: gapSize,
      consecutiveFailures: this._progress.consecutiveFailures,
    };

    console.log(
      JSON.stringify({
        metric: "backfill_begin",
        fromLedger,
        toLedger,
        gapSize,
        batchSize: this.config.batchSize,
        rateLimitMs: this.config.rateLimitMs,
      })
    );

    let current = fromLedger;
    while (current <= toLedger && !signal.aborted) {
      const batchTo = Math.min(current + this.config.batchSize - 1, toLedger);

      try {
        const events = await this.fetchRange(current, batchTo, signal);

        if (signal.aborted) break;

        if (events.length > 0) {
          await processBatch(events);
        }

        // Reset consecutive failure counter on success.
        this._progress.consecutiveFailures = 0;

        const processedSoFar = batchTo - fromLedger + 1;
        this._progress = {
          ...this._progress,
          processedLedgers: processedSoFar,
          consecutiveFailures: 0,
        };

        console.log(
          JSON.stringify({
            metric: "backfill_progress",
            fromLedger,
            toLedger,
            batchFrom: current,
            batchTo,
            processedLedgers: processedSoFar,
            totalLedgers: gapSize,
            progressPct: Math.round((processedSoFar / gapSize) * 100),
          })
        );
      } catch (err) {
        const failures = this._progress.consecutiveFailures + 1;
        this._progress = { ...this._progress, consecutiveFailures: failures };

        console.error(
          JSON.stringify({
            metric: "backfill_batch_failure",
            fromLedger,
            toLedger,
            batchFrom: current,
            batchTo,
            consecutiveFailures: failures,
            maxFailures: this.config.circuitBreakerMaxFailures,
            error: err instanceof Error ? err.message : String(err),
          })
        );

        if (failures >= this.config.circuitBreakerMaxFailures) {
          this._status = "circuit_open";
          this._progress = { ...this._progress, status: "circuit_open" };
          console.error(
            JSON.stringify({
              metric: "backfill_circuit_open",
              message:
                "Backfill circuit breaker tripped. Manual intervention required.",
              consecutiveFailures: failures,
              maxFailures: this.config.circuitBreakerMaxFailures,
            })
          );
          throw new CircuitBreakerOpenError(failures, this.config.circuitBreakerMaxFailures);
        }
        // Don't advance — retry the same batch on the next iteration.
        continue;
      }

      current = batchTo + 1;

      // Rate-limit delay between batches (skip on the last one or when aborted).
      if (current <= toLedger && !signal.aborted && this.config.rateLimitMs > 0) {
        await this.sleep(this.config.rateLimitMs);
      }
    }

    if (!signal.aborted) {
      this._status = "healthy";
      this._progress = {
        ...this._progress,
        status: "healthy",
        processedLedgers: gapSize,
      };
      console.log(
        JSON.stringify({
          metric: "backfill_complete",
          fromLedger,
          toLedger,
          gapSize,
        })
      );
    }

    return true;
  }

  /** Reset status to healthy (e.g. after manual intervention). */
  reset(): void {
    this._status = "healthy";
    this._progress = {
      status: "healthy",
      processedLedgers: 0,
      totalLedgers: 0,
      consecutiveFailures: 0,
    };
  }
}
