/**
 * Mid-stream ledger gap detection.
 *
 * This module re-exports from services/gap-detector, which is the canonical
 * implementation with configurable backfill depth limits. The two-argument
 * overload (without BackfillConfig) preserves backward compatibility for
 * existing tests and call sites.
 */
export type { GapResult } from "./services/gap-detector";
export { detectGap } from "./services/gap-detector";
