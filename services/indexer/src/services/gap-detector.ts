/**
 * Mid-stream ledger gap detection with configurable backfill depth limits.
 *
 * Distinct from startup replay: this catches gaps introduced when an RPC node
 * fails over mid-sequence and the next batch skips ahead. After each batch we
 * assert the first event's ledger is exactly `lastCursor + 1`. If it jumped,
 * the ledgers in between were never seen and must be backfilled before we
 * advance — subject to the configured depth limit.
 *
 * When the detected gap exceeds `maxDepthLedgers`:
 *   - A structured `backfill_alert` log is emitted (metric=backfill_alert).
 *   - `GapResult.exceedsMaxDepth` is set to `true`.
 *   - The caller MUST NOT attempt an automatic backfill; instead it should
 *     surface the alert and require manual intervention.
 */

import { BackfillConfig } from "../config";

export interface GapResult {
  /** True when a gap was detected (batch starts beyond the expected ledger). */
  hasGap: boolean;
  /** First missing ledger sequence (inclusive), when hasGap. */
  fromLedger?: number;
  /** Last missing ledger sequence (inclusive), when hasGap. */
  toLedger?: number;
  /** Gap size in ledgers, when hasGap. */
  gapSize?: number;
  /**
   * True when the gap exceeds the configured maximum backfill depth.
   * An alert has already been emitted; the gap MUST NOT be auto-backfilled.
   */
  exceedsMaxDepth?: boolean;
}

const NO_GAP: GapResult = { hasGap: false };

/**
 * Detect a gap between the last processed cursor and the first event of a new
 * batch, enforcing backfill depth limits from `config`.
 *
 * @param batchFirstLedger  ledger_sequence of the first event in the batch
 * @param lastCursor        last ledger we have fully processed (0 = nothing yet)
 * @param config            backfill configuration (depth limits / alerting thresholds)
 */
export function detectGap(
  batchFirstLedger: number | undefined,
  lastCursor: number,
  config?: Pick<BackfillConfig, "maxDepthLedgers" | "alertThreshold">
): GapResult {
  // Empty batch: nothing to compare.
  if (batchFirstLedger === undefined) return NO_GAP;

  // Nothing processed yet — the first batch defines the baseline, so any
  // start ledger is acceptable (startup replay handles the pre-history).
  if (lastCursor <= 0) return NO_GAP;

  const expected = lastCursor + 1;

  // In-sequence or overlapping (re-delivery) — no gap.
  if (batchFirstLedger <= expected) return NO_GAP;

  const fromLedger = expected;
  const toLedger = batchFirstLedger - 1;
  const gapSize = toLedger - fromLedger + 1;

  const maxDepth = config?.maxDepthLedgers ?? Infinity;
  const alertThreshold = config?.alertThreshold ?? Infinity;

  // Emit structured alert when gap exceeds the alert threshold.
  if (gapSize >= alertThreshold) {
    console.warn(
      JSON.stringify({
        metric: "backfill_alert",
        message: "Gap size exceeds alert threshold",
        fromLedger,
        toLedger,
        gapSize,
        alertThreshold,
      })
    );
  }

  // Gap is too large — do not attempt auto-backfill.
  if (gapSize > maxDepth) {
    console.error(
      JSON.stringify({
        metric: "backfill_gap_too_large",
        message:
          "Gap exceeds maximum backfill depth. Manual intervention required.",
        fromLedger,
        toLedger,
        gapSize,
        maxDepthLedgers: maxDepth,
      })
    );
    return { hasGap: true, fromLedger, toLedger, gapSize, exceedsMaxDepth: true };
  }

  return { hasGap: true, fromLedger, toLedger, gapSize };
}
