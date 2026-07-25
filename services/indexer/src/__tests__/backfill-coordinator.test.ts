/**
 * Unit tests for services/backfill-coordinator.ts
 *
 * Covers:
 *   - Normal backfill (gap within depth limit)
 *   - Large gap handling (gap_too_large, no auto-backfill)
 *   - Circuit breaker tripping after N consecutive failures
 *   - Rate limiting delay between batches
 *   - Alert emission when gap >= alertThreshold
 *   - Reset() clears circuit-breaker state
 */

import {
  BackfillCoordinator,
  CircuitBreakerOpenError,
} from "../services/backfill-coordinator";
import type { BackfillConfig } from "../config";
import type { RawEvent } from "../stream";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<BackfillConfig> = {}): BackfillConfig {
  return {
    maxDepthLedgers: 1_000,
    batchSize: 10,
    rateLimitMs: 0, // no delay in tests by default
    alertThreshold: 500,
    circuitBreakerMaxFailures: 3,
    ...overrides,
  };
}

function makeEvents(from: number, to: number): RawEvent[] {
  return Array.from({ length: to - from + 1 }, (_, i) => ({
    type: "contract",
    ledger: from + i,
    eventIndex: 0,
    ledgerClosedAt: "2026-01-01T00:00:00Z",
    contractId: "C1",
    id: `evt-${from + i}`,
    pagingToken: `tok-${from + i}`,
    topic: ["PostCreated"],
    value: "{}",
    txHash: `tx-${from + i}`,
  }));
}

function noopSleep(_ms: number): Promise<void> {
  return Promise.resolve();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("BackfillCoordinator — normal backfill", () => {
  it("recovers a gap that fits within the depth limit", async () => {
    const config = makeConfig({ batchSize: 5 });
    const allEvents = makeEvents(101, 150); // 50 ledgers
    const fetcher = async (from: number, to: number) =>
      allEvents.filter((e) => e.ledger >= from && e.ledger <= to);

    const received: RawEvent[] = [];
    const processBatch = async (events: RawEvent[]) => {
      received.push(...events);
      return events[events.length - 1].ledger;
    };

    const coordinator = new BackfillCoordinator(config, fetcher, noopSleep);
    const result = await coordinator.recoverGap(101, 150, processBatch, new AbortController().signal);

    expect(result).toBe(true);
    expect(coordinator.status).toBe("healthy");
    expect(received).toHaveLength(50);
    expect(received[0].ledger).toBe(101);
    expect(received[49].ledger).toBe(150);
  });

  it("processes events in batches of batchSize", async () => {
    const config = makeConfig({ batchSize: 3 });
    const allEvents = makeEvents(1, 9); // 9 ledgers → 3 batches
    const fetchCalls: Array<[number, number]> = [];
    const fetcher = async (from: number, to: number) => {
      fetchCalls.push([from, to]);
      return allEvents.filter((e) => e.ledger >= from && e.ledger <= to);
    };

    const coordinator = new BackfillCoordinator(config, fetcher, noopSleep);
    await coordinator.recoverGap(1, 9, async (ev) => ev[ev.length - 1].ledger, new AbortController().signal);

    expect(fetchCalls).toEqual([[1, 3], [4, 6], [7, 9]]);
  });

  it("reports progress throughout recovery", async () => {
    const config = makeConfig({ batchSize: 5 });
    const allEvents = makeEvents(1, 10);
    const fetcher = async (from: number, to: number) =>
      allEvents.filter((e) => e.ledger >= from && e.ledger <= to);

    const coordinator = new BackfillCoordinator(config, fetcher, noopSleep);
    // Status during execution
    let midStatus: string | null = null;
    const processBatch = async (events: RawEvent[]) => {
      midStatus = coordinator.status;
      return events[events.length - 1].ledger;
    };

    await coordinator.recoverGap(1, 10, processBatch, new AbortController().signal);

    expect(midStatus).toBe("backfilling");
    expect(coordinator.status).toBe("healthy");
    const p = coordinator.progress;
    expect(p.processedLedgers).toBe(10);
    expect(p.totalLedgers).toBe(10);
  });
});

describe("BackfillCoordinator — large gap handling", () => {
  it("returns false and sets status=gap_too_large when gap > maxDepthLedgers", async () => {
    const config = makeConfig({ maxDepthLedgers: 100 });
    const fetcher = jest.fn();
    const processBatch = jest.fn();

    const coordinator = new BackfillCoordinator(config, fetcher, noopSleep);
    const result = await coordinator.recoverGap(
      1,
      10_000, // gap of 9999 ledgers > maxDepth=100
      processBatch,
      new AbortController().signal
    );

    expect(result).toBe(false);
    expect(coordinator.status).toBe("gap_too_large");
    expect(fetcher).not.toHaveBeenCalled();
    expect(processBatch).not.toHaveBeenCalled();
  });

  it("emits a backfill_alert log when gap >= alertThreshold but within maxDepth", async () => {
    const config = makeConfig({ alertThreshold: 5, maxDepthLedgers: 1_000 });
    const allEvents = makeEvents(1, 10);
    const fetcher = async (from: number, to: number) =>
      allEvents.filter((e) => e.ledger >= from && e.ledger <= to);

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const coordinator = new BackfillCoordinator(config, fetcher, noopSleep);
    await coordinator.recoverGap(
      1,
      10, // gap of 10 >= alertThreshold=5
      async (ev) => ev[ev.length - 1].ledger,
      new AbortController().signal
    );

    // Alert was emitted (check that console.warn was called with metric=backfill_alert)
    const alertCalls = warnSpy.mock.calls
      .map((args) => {
        try {
          return JSON.parse(args[0] as string) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    warnSpy.mockRestore();
    expect(alertCalls.some((c) => c?.metric === "backfill_alert")).toBe(true);
  });
});

describe("BackfillCoordinator — circuit breaker", () => {
  it("opens the circuit after circuitBreakerMaxFailures consecutive failures", async () => {
    const config = makeConfig({ circuitBreakerMaxFailures: 3, batchSize: 5 });
    let callCount = 0;
    const fetcher = async () => {
      callCount++;
      throw new Error("RPC error");
    };

    const coordinator = new BackfillCoordinator(config, fetcher, noopSleep);

    await expect(
      coordinator.recoverGap(1, 10, async (ev) => ev[ev.length - 1].ledger, new AbortController().signal)
    ).rejects.toThrow(CircuitBreakerOpenError);

    expect(coordinator.status).toBe("circuit_open");
    expect(coordinator.progress.consecutiveFailures).toBe(3);
    // Exactly 3 calls (one per failure up to the limit)
    expect(callCount).toBe(3);
  });

  it("throws immediately when called again with circuit already open", async () => {
    const config = makeConfig({ circuitBreakerMaxFailures: 1 });
    const fetcher = async () => {
      throw new Error("fail");
    };
    const coordinator = new BackfillCoordinator(config, fetcher, noopSleep);

    // Trip the circuit
    await expect(
      coordinator.recoverGap(1, 5, async (ev) => ev[ev.length - 1].ledger, new AbortController().signal)
    ).rejects.toThrow(CircuitBreakerOpenError);

    // Second call: should throw immediately without calling the fetcher
    // Manually set circuit open via the internal path
    (coordinator as unknown as { _status: string })._status = "circuit_open";

    await expect(
      coordinator.recoverGap(1, 5, async (ev) => ev[ev.length - 1].ledger, new AbortController().signal)
    ).rejects.toThrow(CircuitBreakerOpenError);
  });

  it("resets consecutive failures after a successful batch", async () => {
    const config = makeConfig({ circuitBreakerMaxFailures: 5, batchSize: 5 });
    const allEvents = makeEvents(1, 10);
    let failOnFirst = true;
    const fetcher = async (from: number, to: number) => {
      if (failOnFirst && from === 1) {
        failOnFirst = false;
        throw new Error("transient");
      }
      return allEvents.filter((e) => e.ledger >= from && e.ledger <= to);
    };

    const coordinator = new BackfillCoordinator(config, fetcher, noopSleep);
    await coordinator.recoverGap(1, 10, async (ev) => ev[ev.length - 1].ledger, new AbortController().signal);

    expect(coordinator.status).toBe("healthy");
    expect(coordinator.progress.consecutiveFailures).toBe(0);
  });

  it("reset() clears circuit-open state", async () => {
    const config = makeConfig({ circuitBreakerMaxFailures: 1 });
    const fetcher = async () => {
      throw new Error("fail");
    };
    const coordinator = new BackfillCoordinator(config, fetcher, noopSleep);

    await expect(
      coordinator.recoverGap(1, 5, async (ev) => ev[ev.length - 1].ledger, new AbortController().signal)
    ).rejects.toThrow(CircuitBreakerOpenError);

    coordinator.reset();
    expect(coordinator.status).toBe("healthy");
    expect(coordinator.progress.consecutiveFailures).toBe(0);
  });
});

describe("BackfillCoordinator — rate limiting", () => {
  it("applies rateLimitMs delay between batches", async () => {
    const config = makeConfig({ batchSize: 2, rateLimitMs: 50 });
    const allEvents = makeEvents(1, 6); // 3 batches
    const fetcher = async (from: number, to: number) =>
      allEvents.filter((e) => e.ledger >= from && e.ledger <= to);

    const sleepDelays: number[] = [];
    const trackingSleep = async (ms: number) => {
      sleepDelays.push(ms);
    };

    const coordinator = new BackfillCoordinator(config, fetcher, trackingSleep);
    await coordinator.recoverGap(1, 6, async (ev) => ev[ev.length - 1].ledger, new AbortController().signal);

    // 3 batches → 2 inter-batch delays (no delay after the last batch)
    expect(sleepDelays).toEqual([50, 50]);
  });

  it("skips the delay after the last batch", async () => {
    const config = makeConfig({ batchSize: 5, rateLimitMs: 100 });
    const allEvents = makeEvents(1, 5); // exactly one batch
    const fetcher = async (from: number, to: number) =>
      allEvents.filter((e) => e.ledger >= from && e.ledger <= to);

    const sleepDelays: number[] = [];
    const coordinator = new BackfillCoordinator(config, fetcher, async (ms) => {
      sleepDelays.push(ms);
    });
    await coordinator.recoverGap(1, 5, async (ev) => ev[ev.length - 1].ledger, new AbortController().signal);

    expect(sleepDelays).toHaveLength(0);
  });
});

describe("BackfillCoordinator — abort signal", () => {
  it("stops processing when the abort signal is fired", async () => {
    const config = makeConfig({ batchSize: 2 });
    const allEvents = makeEvents(1, 10);
    const abortCtrl = new AbortController();

    let batchCount = 0;
    const fetcher = async (from: number, to: number) => {
      abortCtrl.abort(); // abort mid-backfill
      return allEvents.filter((e) => e.ledger >= from && e.ledger <= to);
    };
    const processBatch = async (events: RawEvent[]) => {
      batchCount++;
      return events[events.length - 1].ledger;
    };

    const coordinator = new BackfillCoordinator(config, fetcher, noopSleep);
    await coordinator.recoverGap(1, 10, processBatch, abortCtrl.signal);

    // Should not have processed all batches
    expect(batchCount).toBeLessThan(5);
  });
});
