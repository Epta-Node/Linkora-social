/**
 * Stream backpressure / 429 resilience tests.
 *
 * Drives streamEvents with an injected fetch, sleep, and rate limiter so the
 * loop runs instantly and deterministically. Verifies that 429 responses cause
 * exponential backoff and that no events are dropped.
 */

import { streamEvents, backfillStartupGap, RawEvent, parseEventIndex, RpcError } from "../stream";
import { TokenBucket } from "../ratelimit";

interface FakeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
}

function rpcResult(events: Array<Partial<RawEvent>>, latestLedger: number): FakeResponse {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ result: { events, latestLedger } }),
  };
}

function rpc429(): FakeResponse {
  return {
    ok: false,
    status: 429,
    statusText: "Too Many Requests",
    json: async () => ({}),
  };
}

function makeRawEvents(ledger: number, count: number): Array<Partial<RawEvent>> {
  return Array.from({ length: count }, (_, i) => ({
    type: "contract",
    ledger,
    ledgerClosedAt: "2026-06-22T00:00:00Z",
    contractId: "C1",
    id: `00000000${ledger}-000000000${i}`,
    pagingToken: `tok-${ledger}-${i}`,
    topic: ["PostCreated"],
    value: "v",
    txHash: `tx-${i}`,
  }));
}

/** A rate limiter that never blocks (fast clock + instant sleep). */
function nonBlockingLimiter(): TokenBucket {
  return new TokenBucket({ ratePerSec: 1e6, burst: 1e6, now: () => 0, sleep: async () => {} });
}

describe("parseEventIndex", () => {
  it("parses the index suffix from a Soroban event id", () => {
    expect(parseEventIndex("0004023007-0000000003", 9)).toBe(3);
  });
  it("falls back to the ordinal for a malformed id", () => {
    expect(parseEventIndex("no-dash-here-xyz", 7)).toBe(7);
    expect(parseEventIndex("", 4)).toBe(4);
  });
});

describe("streamEvents — 429 backpressure", () => {
  it("backs off exponentially on 429 and drops no events", async () => {
    const controller = new AbortController();
    const backoffs: number[] = [];
    const sleep = async (ms: number) => {
      backoffs.push(ms);
    };

    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      // Three consecutive 429s, then a partial page of 3 events.
      if (call <= 3) return rpc429() as unknown as Response;
      if (call === 4) return rpcResult(makeRawEvents(10, 3), 10) as unknown as Response;
      return rpcResult([], 10) as unknown as Response;
    }) as unknown as typeof fetch;

    const processed: RawEvent[] = [];
    const process = async (events: RawEvent[]): Promise<number> => {
      processed.push(...events);
      controller.abort(); // stop after the first real batch
      return events[events.length - 1].ledger;
    };

    await streamEvents(
      {
        rpcUrl: "http://rpc",
        contractId: "C1",
        startLedger: 10,
        backoffBaseMs: 100,
        maxRetries: 6,
        minPollMs: 1,
        maxPollMs: 5,
      },
      process,
      controller.signal,
      { fetchImpl, sleep, rateLimiter: nonBlockingLimiter() }
    );

    // Exponential backoff: 100, 200, 400 for the three 429s.
    expect(backoffs).toEqual([100, 200, 400]);

    // All three events delivered exactly once — nothing dropped.
    expect(processed).toHaveLength(3);
    expect(processed.map((e) => e.eventIndex)).toEqual([0, 1, 2]);
  });

  it("gives up after maxRetries and surfaces the error without crashing the loop", async () => {
    const controller = new AbortController();
    const sleep = async () => {};

    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      if (call <= 2) return rpc429() as unknown as Response;
      // After the exhausted-retry error is logged, the loop retries the window
      // and we let it succeed so we can abort cleanly.
      return rpcResult(makeRawEvents(10, 1), 10) as unknown as Response;
    }) as unknown as typeof fetch;

    const process = async (events: RawEvent[]): Promise<number> => {
      controller.abort();
      return events[events.length - 1].ledger;
    };

    await expect(
      streamEvents(
        {
          rpcUrl: "http://rpc",
          contractId: "C1",
          startLedger: 10,
          backoffBaseMs: 1,
          maxRetries: 1, // exhausted after the 2nd 429
          minPollMs: 1,
          maxPollMs: 2,
        },
        process,
        controller.signal,
        { fetchImpl, sleep, rateLimiter: nonBlockingLimiter() }
      )
    ).resolves.toBeUndefined();
  });
});

describe("RpcError", () => {
  it("carries the HTTP status", () => {
    const err = new RpcError("boom", 429);
    expect(err.status).toBe(429);
    expect(err.name).toBe("RpcError");
  });
});

describe("backfillStartupGap — 100-ledger gap recovery", () => {
  it("fetches and delivers all events across a 100-ledger gap", async () => {
    // 100 ledgers (1001–1100), one event per ledger
    const gapEvents: Array<Partial<RawEvent>> = Array.from({ length: 100 }, (_, i) => ({
      type: "contract",
      ledger: 1001 + i,
      ledgerClosedAt: "2026-06-22T00:00:00Z",
      contractId: "C1",
      id: `00000000${1001 + i}-0000000000`,
      pagingToken: `tok-${1001 + i}`,
      topic: ["PostCreated"],
      value: "v",
      txHash: `tx-${i}`,
    }));

    let fetchCalls = 0;
    const fetchImpl = (async (_url: string, opts: RequestInit) => {
      fetchCalls++;
      const body = JSON.parse(opts.body as string) as { params?: { startLedger?: number; pagination?: { cursor?: string } } };
      const startLedger = body.params?.startLedger ?? 0;
      // Return events for the requested range (max 100 per page)
      const page = gapEvents.filter((e) => e.ledger! >= startLedger);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ result: { events: page, latestLedger: 1200 } }),
      };
    }) as unknown as typeof fetch;

    const recovered: RawEvent[] = [];
    const processBatch = async (events: RawEvent[]): Promise<number> => {
      recovered.push(...events);
      return events[events.length - 1].ledger;
    };

    await backfillStartupGap(
      {
        rpcUrl: "http://rpc",
        contractId: "C1",
        maxRetries: 3,
        backoffBaseMs: 1,
        backoffMaxMs: 10,
      },
      1001,
      1100,
      processBatch,
      new AbortController().signal, // separate signal so backfill runs to completion
      { fetchImpl, sleep: async () => {}, rateLimiter: nonBlockingLimiter() }
    );

    // All 100 ledgers must be recovered
    expect(recovered).toHaveLength(100);
    expect(recovered[0].ledger).toBe(1001);
    expect(recovered[99].ledger).toBe(1100);
    // No duplicates
    const ledgers = recovered.map((e) => e.ledger);
    expect(new Set(ledgers).size).toBe(100);
    expect(fetchCalls).toBeGreaterThan(0);
  });
});
