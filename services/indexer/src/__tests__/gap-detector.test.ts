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

const confirmationConfig: Pick<
  BackfillConfig,
  "maxDepthLedgers" | "alertThreshold" | "gapConfirmationLedgers"
> = {
  maxDepthLedgers: 10_000,
  alertThreshold: 5_000,
  gapConfirmationLedgers: 10,
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

// ── Gap confirmation window (RPC lag vs durable gap) ────────────────────────

describe("detectGap (gap confirmation window)", () => {
  it("reports stillCatchingUp when the latest ledger has not advanced past the hole", () => {
    // Cursor=100, batch starts at 105 → hole is 101..104 (toLedger=104).
    // With gapConfirmationLedgers=10, durability requires latestLedger ≥ 114.
    const result = detectGap(105, 100, confirmationConfig, 110);
    expect(result.hasGap).toBe(false);
    expect(result.stillCatchingUp).toBe(true);
    expect(result.fromLedger).toBe(101);
    expect(result.toLedger).toBe(104);
    expect(result.gapSize).toBe(4);
  });

  it("declares a durable gap once the latest ledger advances past the hole", () => {
    const result = detectGap(105, 100, confirmationConfig, 115);
    expect(result.stillCatchingUp).toBeFalsy();
    expect(result.hasGap).toBe(true);
    expect(result.gapSize).toBe(4);
    expect(result.exceedsMaxDepth).toBeFalsy();
  });

  it("requires the latest ledger to be exactly N ahead of the hole, not just equal", () => {
    // toLedger=104, N=10 → need latestLedger ≥ 114.
    const confirmed = detectGap(105, 100, confirmationConfig, 114);
    expect(confirmed.hasGap).toBe(true);

    const stillLagging = detectGap(105, 100, confirmationConfig, 113);
    expect(stillLagging.hasGap).toBe(false);
    expect(stillLagging.stillCatchingUp).toBe(true);
  });

  it("handles lag-then-fill across calls: benign lag is never alerted", () => {
    const first = detectGap(105, 100, confirmationConfig, 108);
    expect(first.hasGap).toBe(false);
    expect(first.stillCatchingUp).toBe(true);

    // RPC advances; a normal batch now arrives in sequence — no gap at all.
    const second = detectGap(101, 100, confirmationConfig, 115);
    expect(second).toEqual({ hasGap: false });
  });

  it("does not apply the confirmation window when latestLedger is omitted", () => {
    // Backward compatibility: no latest ledger means the hole is judged immediately.
    const result = detectGap(105, 100, confirmationConfig);
    expect(result.stillCatchingUp).toBeFalsy();
    expect(result.hasGap).toBe(true);
    expect(result.gapSize).toBe(4);
  });

  it("still sets exceedsMaxDepth for confirmed durable gaps beyond the limit", () => {
    const cfg = { maxDepthLedgers: 10, alertThreshold: 5, gapConfirmationLedgers: 5 };
    // Cursor=100, batch starts at 200 → hole 101..199 (toLedger=199), N=5 → latest ≥ 204.
    const result = detectGap(200, 100, cfg, 300);
    expect(result.hasGap).toBe(true);
    expect(result.stillCatchingUp).toBeFalsy();
    expect(result.exceedsMaxDepth).toBe(true);
    expect(result.gapSize).toBe(99);
  });
});
