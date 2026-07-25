/**
 * Unit tests for services/gap-detector.ts
 *
 * Covers: in-sequence, gap detection, depth limits, alert threshold,
 * overlap/re-delivery, and empty-batch edge cases.
 */

import { detectGap } from "../services/gap-detector";
import type { BackfillConfig } from "../config";

const defaultConfig: Pick<BackfillConfig, "maxDepthLedgers" | "alertThreshold"> = {
  maxDepthLedgers: 10_000,
  alertThreshold: 5_000,
};

describe("detectGap (gap-detector)", () => {
  it("reports no gap when batch continues the sequence", () => {
    expect(detectGap(101, 100, defaultConfig)).toEqual({ hasGap: false });
  });

  it("reports a gap when the batch skips ahead", () => {
    const result = detectGap(105, 100, defaultConfig);
    expect(result.hasGap).toBe(true);
    expect(result.fromLedger).toBe(101);
    expect(result.toLedger).toBe(104);
    expect(result.gapSize).toBe(4);
    expect(result.exceedsMaxDepth).toBeFalsy();
  });

  it("treats a single skipped ledger as a one-ledger gap", () => {
    const result = detectGap(103, 101, defaultConfig);
    expect(result).toMatchObject({ hasGap: true, fromLedger: 102, toLedger: 102, gapSize: 1 });
  });

  it("reports no gap on re-delivery / overlap", () => {
    expect(detectGap(98, 100, defaultConfig)).toEqual({ hasGap: false });
    expect(detectGap(100, 100, defaultConfig)).toEqual({ hasGap: false });
  });

  it("reports no gap on an empty batch", () => {
    expect(detectGap(undefined, 100, defaultConfig)).toEqual({ hasGap: false });
  });

  it("reports no gap before the first batch (cursor 0)", () => {
    expect(detectGap(500000, 0, defaultConfig)).toEqual({ hasGap: false });
  });

  it("sets exceedsMaxDepth when gap exceeds maxDepthLedgers", () => {
    const smallDepthCfg = { maxDepthLedgers: 10, alertThreshold: 5 };
    // Cursor at 100, batch starts at 200 → gap of 99 ledgers > maxDepth=10
    const result = detectGap(200, 100, smallDepthCfg);
    expect(result.hasGap).toBe(true);
    expect(result.exceedsMaxDepth).toBe(true);
    expect(result.gapSize).toBe(99);
  });

  it("does NOT set exceedsMaxDepth for gaps within the depth limit", () => {
    const cfg = { maxDepthLedgers: 100, alertThreshold: 50 };
    const result = detectGap(150, 100, cfg);
    expect(result.hasGap).toBe(true);
    expect(result.exceedsMaxDepth).toBeFalsy();
    expect(result.gapSize).toBe(49);
  });

  it("works without config (backward-compat — no depth limit)", () => {
    const result = detectGap(10_000, 1, undefined);
    expect(result.hasGap).toBe(true);
    expect(result.exceedsMaxDepth).toBeFalsy();
  });
});
