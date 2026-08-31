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

  it("does not count serialization conflicts toward the stream circuit breaker", async () => {
    const controller = new AbortController();
    let fetchCalls = 0;
    let processCalls = 0;
    const fetchImpl = (async () => {
      fetchCalls += 1;
      return rpcResult(makeRawEvents(10, 1), 10) as unknown as Response;
    }) as unknown as typeof fetch;

    const process = async (events: RawEvent[]): Promise<number> => {
      processCalls += 1;
      if (processCalls <= 10) {
        const error = new Error("serialization failure") as Error & { code: string };
        error.code = "40001";
        throw error;
      }
      controller.abort();
      return events[events.length - 1].ledger;
    };

    await streamEvents(
      {
        rpcUrl: "http://rpc",
        contractId: "C1",
        startLedger: 10,
        minPollMs: 0,
        maxPollMs: 0,
      },
      process,
      controller.signal,
      { fetchImpl, sleep: async () => {}, rateLimiter: nonBlockingLimiter() }
    );

    expect(processCalls).toBe(11);
    expect(fetchCalls).toBe(11);
  });
});

describe("streamEvents — error-type-aware circuit breaker (#1179)", () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Metric names emitted through the console during the run. */
  function emittedMetrics(): string[] {
    return errorSpy.mock.calls
      .map((call) => call[0])
      .filter((arg): arg is string => typeof arg === "string" && arg.startsWith("{"))
      .map((line) => {
        try {
          return JSON.parse(line).metric as string;
        } catch {
          return "";
        }
      })
      .filter(Boolean);
  }

  it("survives 15 consecutive ECONNREFUSED errors and keeps streaming", async () => {
    // The exact scenario from the issue: an RPC rolling restart. Previously
    // the 10th failure tripped the breaker and ended the stream for good.
    const controller = new AbortController();
    let fetchCalls = 0;
    let processCalls = 0;

    const fetchImpl = (async () => {
      fetchCalls += 1;
      if (fetchCalls <= 15) {
        const err = new Error("connect ECONNREFUSED 127.0.0.1:8000") as Error & { code: string };
        err.code = "ECONNREFUSED";
        throw err;
      }
      return rpcResult(makeRawEvents(10, 1), 10) as unknown as Response;
    }) as unknown as typeof fetch;

    const process = async (events: RawEvent[]): Promise<number> => {
      processCalls += 1;
      controller.abort();
      return events[events.length - 1].ledger;
    };

    await streamEvents(
      {
        rpcUrl: "http://rpc",
        contractId: "C1",
        startLedger: 10,
        minPollMs: 0,
        maxPollMs: 0,
        maxRetries: 0,
      },
      process,
      controller.signal,
      { fetchImpl, sleep: async () => {}, rateLimiter: nonBlockingLimiter() }
    );

    // The stream reached the successful fetch instead of stopping at 10.
    expect(fetchCalls).toBe(16);
    expect(processCalls).toBe(1);
    expect(emittedMetrics()).not.toContain("stream_circuit_open");
  });

  it("opens on persistent unclassified errors at the configured threshold", async () => {
    const controller = new AbortController();
    let fetchCalls = 0;

    const fetchImpl = (async () => {
      fetchCalls += 1;
      if (fetchCalls >= 6) controller.abort();
      throw new TypeError("cannot read properties of undefined");
    }) as unknown as typeof fetch;

    await streamEvents(
      {
        rpcUrl: "http://rpc",
        contractId: "C1",
        startLedger: 10,
        minPollMs: 0,
        maxPollMs: 0,
        maxRetries: 0,
        circuitBreakerThreshold: 3,
        circuitBreakerProbeIntervalMs: 0,
      },
      async (events) => events[events.length - 1].ledger,
      controller.signal,
      { fetchImpl, sleep: async () => {}, rateLimiter: nonBlockingLimiter() }
    );

    const metrics = emittedMetrics();
    expect(metrics).toContain("stream_circuit_open");
    expect(metrics).toContain("stream_circuit_half_open");
  });

  it("recovers through a half-open probe instead of terminating the stream", async () => {
    const controller = new AbortController();
    let fetchCalls = 0;
    let processCalls = 0;

    const fetchImpl = (async () => {
      fetchCalls += 1;
      // Three persistent failures trip the breaker; the probe then succeeds.
      if (fetchCalls <= 3) throw new TypeError("unclassified defect");
      return rpcResult(makeRawEvents(10, 1), 10) as unknown as Response;
    }) as unknown as typeof fetch;

    const process = async (events: RawEvent[]): Promise<number> => {
      processCalls += 1;
      controller.abort();
      return events[events.length - 1].ledger;
    };

    await streamEvents(
      {
        rpcUrl: "http://rpc",
        contractId: "C1",
        startLedger: 10,
        minPollMs: 0,
        maxPollMs: 0,
        maxRetries: 0,
        circuitBreakerThreshold: 3,
        circuitBreakerProbeIntervalMs: 0,
      },
      process,
      controller.signal,
      { fetchImpl, sleep: async () => {}, rateLimiter: nonBlockingLimiter() }
    );

    // The stream carried on past the trip and processed the probe's batch.
    expect(processCalls).toBe(1);
    const metrics = emittedMetrics();
    expect(metrics).toContain("stream_circuit_open");
    expect(metrics).toContain("stream_circuit_half_open");
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
      const body = JSON.parse(opts.body as string) as {
        params?: { startLedger?: number; pagination?: { cursor?: string } };
      };
      const cursor = body.params?.pagination?.cursor;
      let page = gapEvents;
      if (cursor) {
        // Respect cursor-based pagination: only return events after it.
        page = page.filter((e) => e.pagingToken! > cursor);
      } else {
        const startLedger = body.params?.startLedger ?? 0;
        page = page.filter((e) => e.ledger! >= startLedger);
      }
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
