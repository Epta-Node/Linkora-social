/**
 * Mid-stream ledger gap detection tests.
 */

import { detectGap } from "../gap";

describe("detectGap", () => {
  it("reports no gap when the batch continues the sequence", () => {
    expect(detectGap(101, 100)).toEqual({ hasGap: false });
  });

  it("reports a gap when the batch skips ahead (RPC failover)", () => {
    // cursor=100, expected 101, but the batch starts at 105 → 101..104 missing.
    expect(detectGap(105, 100)).toEqual({
      hasGap: true,
      fromLedger: 101,
      toLedger: 104,
    });
  });

  it("treats a single skipped ledger as a one-ledger gap", () => {
    expect(detectGap(103, 101)).toEqual({
      hasGap: true,
      fromLedger: 102,
      toLedger: 102,
    });
  });

  it("reports no gap on re-delivery / overlap", () => {
    expect(detectGap(98, 100)).toEqual({ hasGap: false });
    expect(detectGap(100, 100)).toEqual({ hasGap: false });
  });

  it("reports no gap on an empty batch", () => {
    expect(detectGap(undefined, 100)).toEqual({ hasGap: false });
  });

  it("reports no gap before the first batch (cursor 0)", () => {
    expect(detectGap(500000, 0)).toEqual({ hasGap: false });
  });
});
