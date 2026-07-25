/**
 * Integration test — gap recovery with simulated missed events.
 *
 * Drives the full gap-detection → backfill-coordinator → processBatch flow
 * without a live RPC or database, verifying that:
 *
 *   1. A mid-stream gap is detected correctly.
 *   2. All missing events are recovered and delivered to the processor.
 *   3. The coordinator health status transitions correctly.
 *   4. A gap larger than maxDepthLedgers is NOT auto-backfilled.
 */

import { detectGap } from "../services/gap-detector";
import { BackfillCoordinator, CircuitBreakerOpenError } from "../services/backfill-coordinator";
import type { BackfillConfig } from "../config";
import type { RawEvent } from "../stream";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<BackfillConfig> = {}): BackfillConfig {
  return {
    maxDepthLedgers: 200,
    batchSize: 20,
    rateLimitMs: 0,
    alertThreshold: 100,
    circuitBreakerMaxFailures: 3,
    ...overrides,
  };
}

function buildEvent(ledger: number): RawEvent {
  return {
    type: "contract",
    ledger,
    eventIndex: 0,
    ledgerClosedAt: "2026-01-01T00:00:00Z",
    contractId: "C1",
    id: `evt-${ledger}`,
    pagingToken: `tok-${ledger}`,
    topic: ["PostCreated"],
    value: `{"ledger":${ledger}}`,
    txHash: `tx-${ledger}`,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Integration — gap recovery with simulated missed events", () => {
  it("detects gap and recovers all missing ledgers via the coordinator", async () => {
    const config = makeConfig();

    // Simulate: processed up to ledger 1000, then RPC jumps to 1051
    const lastCursor = 1000;
    const batchFirstLedger = 1051;

    // Step 1: detect the gap
    const gap = detectGap(batchFirstLedger, lastCursor, config);
    expect(gap.hasGap).toBe(true);
    expect(gap.fromLedger).toBe(1001);
    expect(gap.toLedger).toBe(1050);
    expect(gap.gapSize).toBe(50);
    expect(gap.exceedsMaxDepth).toBeFalsy();

    // Step 2: build the missing events
    const missingEvents = Array.from({ length: 50 }, (_, i) => buildEvent(1001 + i));

    const fetcher = async (from: number, to: number) =>
      missingEvents.filter((e) => e.ledger >= from && e.ledger <= to);

    // Step 3: run the coordinator
    const recovered: RawEvent[] = [];
    const processBatch = async (events: RawEvent[]) => {
      recovered.push(...events);
      return events[events.length - 1].ledger;
    };

    const coordinator = new BackfillCoordinator(config, fetcher);
    const success = await coordinator.recoverGap(
      gap.fromLedger!,
      gap.toLedger!,
      processBatch,
      new AbortController().signal
    );

    expect(success).toBe(true);
    expect(coordinator.status).toBe("healthy");
    expect(recovered).toHaveLength(50);
    expect(recovered[0].ledger).toBe(1001);
    expect(recovered[49].ledger).toBe(1050);

    // No duplicates
    const ledgers = new Set(recovered.map((e) => e.ledger));
    expect(ledgers.size).toBe(50);
  });

  it("does NOT recover a gap that exceeds maxDepthLedgers", async () => {
    const config = makeConfig({ maxDepthLedgers: 50 });

    const lastCursor = 1000;
    const batchFirstLedger = 1200; // gap of 199 > maxDepth=50

    const gap = detectGap(batchFirstLedger, lastCursor, config);
    expect(gap.hasGap).toBe(true);
    expect(gap.exceedsMaxDepth).toBe(true);

    const fetcher = jest.fn();
    const processBatch = jest.fn();

    const coordinator = new BackfillCoordinator(config, fetcher);
    const result = await coordinator.recoverGap(
      gap.fromLedger!,
      gap.toLedger!,
      processBatch,
      new AbortController().signal
    );

    expect(result).toBe(false);
    expect(coordinator.status).toBe("gap_too_large");
    expect(fetcher).not.toHaveBeenCalled();
    expect(processBatch).not.toHaveBeenCalled();
  });

  it("correctly handles a one-ledger gap", async () => {
    const config = makeConfig();

    const gap = detectGap(103, 101, config);
    expect(gap.fromLedger).toBe(102);
    expect(gap.toLedger).toBe(102);
    expect(gap.gapSize).toBe(1);

    const missingEvent = buildEvent(102);
    const fetcher = async (from: number, to: number) =>
      [missingEvent].filter((e) => e.ledger >= from && e.ledger <= to);

    const received: RawEvent[] = [];
    const coordinator = new BackfillCoordinator(config, fetcher);
    await coordinator.recoverGap(
      gap.fromLedger!,
      gap.toLedger!,
      async (events) => {
        received.push(...events);
        return events[events.length - 1].ledger;
      },
      new AbortController().signal
    );

    expect(received).toHaveLength(1);
    expect(received[0].ledger).toBe(102);
  });

  it("status transitions: healthy → backfilling → healthy", async () => {
    const config = makeConfig();
    const events = Array.from({ length: 10 }, (_, i) => buildEvent(1 + i));
    const fetcher = async (from: number, to: number) =>
      events.filter((e) => e.ledger >= from && e.ledger <= to);

    const statusLog: string[] = [];
    const coordinator = new BackfillCoordinator(config, fetcher);

    statusLog.push(coordinator.status); // healthy before start

    const processBatch = async (evts: RawEvent[]) => {
      statusLog.push(coordinator.status); // backfilling during
      return evts[evts.length - 1].ledger;
    };

    await coordinator.recoverGap(1, 10, processBatch, new AbortController().signal);
    statusLog.push(coordinator.status); // healthy after complete

    expect(statusLog[0]).toBe("healthy");
    // At least one "backfilling" status logged during recovery
    expect(statusLog.slice(1, -1).every((s) => s === "backfilling")).toBe(true);
    expect(statusLog[statusLog.length - 1]).toBe("healthy");
  });

  it("circuit breaker stops recovery and requires manual reset", async () => {
    const config = makeConfig({ circuitBreakerMaxFailures: 2, maxDepthLedgers: 500 });
    const fetcher = async (): Promise<RawEvent[]> => {
      throw new Error("network error");
    };

    const coordinator = new BackfillCoordinator(config, fetcher);

    await expect(
      coordinator.recoverGap(1, 50, async (ev) => ev[ev.length - 1].ledger, new AbortController().signal)
    ).rejects.toThrow(CircuitBreakerOpenError);

    expect(coordinator.status).toBe("circuit_open");

    // Reset should re-enable
    coordinator.reset();
    expect(coordinator.status).toBe("healthy");
  });
});
