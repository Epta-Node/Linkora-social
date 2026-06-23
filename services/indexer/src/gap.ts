/**
 * Mid-stream ledger gap detection.
 *
 * Distinct from startup replay: this catches gaps introduced when an RPC node
 * fails over mid-sequence and the next batch skips ahead. After each batch we
 * assert the first event's ledger is exactly `lastCursor + 1`. If it jumped,
 * the ledgers in between were never seen and must be backfilled before we
 * advance.
 */

export interface GapResult {
  /** True when a gap was detected (batch starts beyond the expected ledger). */
  hasGap: boolean;
  /** First missing ledger sequence (inclusive), when hasGap. */
  fromLedger?: number;
  /** Last missing ledger sequence (inclusive), when hasGap. */
  toLedger?: number;
}

const NO_GAP: GapResult = { hasGap: false };

/**
 * Detect a gap between the last processed cursor and the first event of a new
 * batch.
 *
 * @param batchFirstLedger ledger_sequence of the first event in the batch
 * @param lastCursor       last ledger we have fully processed (0 = nothing yet)
 */
export function detectGap(
  batchFirstLedger: number | undefined,
  lastCursor: number
): GapResult {
  // Empty batch: nothing to compare.
  if (batchFirstLedger === undefined) return NO_GAP;

  // Nothing processed yet — the first batch defines the baseline, so any
  // start ledger is acceptable (startup replay handles the pre-history).
  if (lastCursor <= 0) return NO_GAP;

  const expected = lastCursor + 1;

  // In-sequence or overlapping (re-delivery) — no gap.
  if (batchFirstLedger <= expected) return NO_GAP;

  return {
    hasGap: true,
    fromLedger: expected,
    toLedger: batchFirstLedger - 1,
  };
}
