/**
 * Soroban event streaming via Horizon/Soroban RPC.
 *
 * Polls `getEvents` on the configured RPC endpoint and feeds batches of raw
 * contract events to a processor. Production concerns handled here:
 *
 *   - Backpressure: a token-bucket rate limiter caps outbound RPC rate, and an
 *     adaptive poll interval backs off when idle / speeds up under load.
 *   - 429 resilience: rate-limit responses trigger exponential backoff with
 *     retries; no events are dropped — the same window is re-fetched.
 *   - Gap detection: after each batch the first event's ledger is compared to
 *     `cursor + 1`; a jump triggers a structured `gap_detected` log and a
 *     targeted backfill of the missing range before the batch is processed.
 *
 * The clock, sleep, fetch implementation and rate limiter are all injectable so
 * the loop can be driven deterministically in tests.
 */

import { TokenBucket } from "./ratelimit";
import { AdaptivePoll } from "./poller";
import { detectGap } from "./gap";

export interface RawEvent {
  type: string;
  ledger: number;
  /** Index of this event within its ledger (parsed from the RPC event id). */
  eventIndex: number;
  ledgerClosedAt: string;
  contractId: string;
  id: string;
  pagingToken: string;
  topic: string[];
  value: string;
  txHash: string;
}

export interface StreamConfig {
  rpcUrl: string;
  contractId: string;
  startLedger: number;
  /** Cursor (last fully processed ledger) to resume gap detection from. */
  initialCursor?: number;
  /** Adaptive poll bounds. */
  minPollMs?: number;
  maxPollMs?: number;
  /** Token-bucket sustained rate (req/s). */
  ratePerSec?: number;
  /** 429 / network backoff tuning. */
  maxRetries?: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
}

/**
 * Processes a batch of events and returns the new cursor (the highest ledger
 * fully processed). Implemented by the ingest pipeline. MUST be exactly-once.
 */
export type BatchProcessor = (events: RawEvent[]) => Promise<number>;

export interface StreamDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  rateLimiter?: TokenBucket;
}

const DEFAULT_MIN_POLL_MS = 100;
const DEFAULT_MAX_POLL_MS = 5_000;
const DEFAULT_RATE_PER_SEC = 10;
const DEFAULT_MAX_RETRIES = 6;
const DEFAULT_BACKOFF_BASE_MS = 250;
const DEFAULT_BACKOFF_MAX_MS = 10_000;
const MAX_EVENTS_PER_PAGE = 100;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Error carrying the HTTP status of a failed RPC call (e.g. 429). */
export class RpcError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RpcError";
  }
}

/**
 * Parse the event index out of a Soroban event id of the form
 * "<toid>-<index>" (e.g. "0004023007-0000000003"). Falls back to `ordinal`
 * (the event's position in the batch) when the id is malformed.
 */
export function parseEventIndex(id: string, ordinal: number): number {
  const dash = id.lastIndexOf("-");
  if (dash >= 0) {
    const parsed = Number(id.slice(dash + 1));
    if (Number.isFinite(parsed)) return parsed;
  }
  return ordinal;
}

interface RawRpcEvent {
  type: string;
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  id: string;
  pagingToken: string;
  topic: string[];
  value: string;
  txHash: string;
}

/** A single getEvents RPC call. Throws RpcError on non-2xx / RPC error. */
async function fetchEventsOnce(
  fetchImpl: typeof fetch,
  rpcUrl: string,
  contractId: string,
  startLedger: number,
  cursor: string | undefined
): Promise<{ events: RawEvent[]; latestLedger: number }> {
  const body: Record<string, unknown> = {
    jsonrpc: "2.0",
    id: 1,
    method: "getEvents",
    params: {
      startLedger,
      filters: [{ type: "contract", contractIds: [contractId] }],
      pagination: { limit: MAX_EVENTS_PER_PAGE, ...(cursor ? { cursor } : {}) },
    },
  };

  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new RpcError(
      `RPC request failed: ${response.status} ${response.statusText}`,
      response.status
    );
  }

  const json = (await response.json()) as {
    result?: { events: RawRpcEvent[]; latestLedger: number };
    error?: { message: string };
  };

  if (json.error) {
    throw new RpcError(`RPC error: ${json.error.message}`, 0);
  }

  const rawEvents = json.result?.events ?? [];
  const events: RawEvent[] = rawEvents.map((e, ordinal) => ({
    ...e,
    eventIndex: parseEventIndex(e.id, ordinal),
  }));

  return { events, latestLedger: json.result?.latestLedger ?? startLedger };
}

/**
 * getEvents with backpressure and 429 resilience: acquires a rate-limit token
 * first, then retries on 429 (and transient errors) with exponential backoff.
 * The fetched window is never abandoned, so no events are dropped.
 */
async function fetchEventsResilient(
  deps: Required<Pick<StreamDeps, "fetchImpl" | "sleep" | "rateLimiter">>,
  cfg: Required<Pick<StreamConfig, "maxRetries" | "backoffBaseMs" | "backoffMaxMs">>,
  rpcUrl: string,
  contractId: string,
  startLedger: number,
  cursor: string | undefined,
  signal: AbortSignal
): Promise<{ events: RawEvent[]; latestLedger: number }> {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (signal.aborted) return { events: [], latestLedger: startLedger };
    await deps.rateLimiter.acquire();
    try {
      return await fetchEventsOnce(deps.fetchImpl, rpcUrl, contractId, startLedger, cursor);
    } catch (err) {
      const status = err instanceof RpcError ? err.status : -1;
      attempt += 1;
      if (attempt > cfg.maxRetries) throw err;

      const backoff = Math.min(
        cfg.backoffMaxMs,
        cfg.backoffBaseMs * 2 ** (attempt - 1)
      );
      if (status === 429) {
        console.warn(
          `[stream] 429 rate-limited (attempt ${attempt}/${cfg.maxRetries}), backing off ${backoff}ms`
        );
      } else {
        console.warn(
          `[stream] RPC error (attempt ${attempt}/${cfg.maxRetries}), backing off ${backoff}ms:`,
          err instanceof Error ? err.message : err
        );
      }
      await deps.sleep(backoff);
    }
  }
}

/**
 * Fetch every event in the inclusive ledger range [fromLedger, toLedger],
 * paginating as needed. Used to backfill a detected gap.
 */
async function fetchRange(
  deps: Required<Pick<StreamDeps, "fetchImpl" | "sleep" | "rateLimiter">>,
  cfg: Required<Pick<StreamConfig, "maxRetries" | "backoffBaseMs" | "backoffMaxMs">>,
  rpcUrl: string,
  contractId: string,
  fromLedger: number,
  toLedger: number,
  signal: AbortSignal
): Promise<RawEvent[]> {
  const collected: RawEvent[] = [];
  let cursor: string | undefined;
  while (!signal.aborted) {
    const { events } = await fetchEventsResilient(
      deps,
      cfg,
      rpcUrl,
      contractId,
      fromLedger,
      cursor,
      signal
    );
    const inRange = events.filter((e) => e.ledger <= toLedger);
    collected.push(...inRange);

    const lastEvent = events[events.length - 1];
    const moreToFetch =
      events.length === MAX_EVENTS_PER_PAGE &&
      lastEvent !== undefined &&
      lastEvent.ledger <= toLedger;
    if (!moreToFetch) break;
    cursor = lastEvent.pagingToken;
  }
  return collected;
}

function waitWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted || ms <= 0) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });
}

/**
 * Stream Soroban contract events, invoking `processBatch` for each batch.
 *
 * Runs until `signal` is aborted. Maintains a cursor (last fully processed
 * ledger) returned by the processor so restarts resume cleanly, and applies
 * rate limiting, adaptive polling, 429 backoff and gap backfill along the way.
 */
export async function streamEvents(
  config: StreamConfig,
  processBatch: BatchProcessor,
  signal: AbortSignal,
  deps: StreamDeps = {}
): Promise<void> {
  const resolved = {
    fetchImpl: deps.fetchImpl ?? fetch,
    sleep: deps.sleep ?? defaultSleep,
    rateLimiter:
      deps.rateLimiter ??
      new TokenBucket({ ratePerSec: config.ratePerSec ?? DEFAULT_RATE_PER_SEC }),
  };
  const backoffCfg = {
    maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
    backoffBaseMs: config.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS,
    backoffMaxMs: config.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS,
  };
  const poll = new AdaptivePoll({
    minMs: config.minPollMs ?? DEFAULT_MIN_POLL_MS,
    maxMs: config.maxPollMs ?? DEFAULT_MAX_POLL_MS,
    pageSize: MAX_EVENTS_PER_PAGE,
  });

  let cursor = config.initialCursor ?? 0;
  let startLedger = config.startLedger;
  let pagingCursor: string | undefined;

  console.log(
    `[stream] Starting from ledger ${startLedger} (cursor ${cursor}), contract=${config.contractId}`
  );

  while (!signal.aborted) {
    try {
      const { events, latestLedger } = await fetchEventsResilient(
        resolved,
        backoffCfg,
        config.rpcUrl,
        config.contractId,
        startLedger,
        pagingCursor,
        signal
      );

      if (signal.aborted) break;

      // ── Gap detection ────────────────────────────────────────────────────
      const firstLedger = events[0]?.ledger;
      const gap = detectGap(firstLedger, cursor);
      if (gap.hasGap && gap.fromLedger !== undefined && gap.toLedger !== undefined) {
        console.warn(
          JSON.stringify({
            metric: "gap_detected",
            stream: config.contractId,
            expectedLedger: gap.fromLedger,
            receivedLedger: firstLedger,
            missingFrom: gap.fromLedger,
            missingTo: gap.toLedger,
          })
        );
        const backfilled = await fetchRange(
          resolved,
          backoffCfg,
          config.rpcUrl,
          config.contractId,
          gap.fromLedger,
          gap.toLedger,
          signal
        );
        if (backfilled.length > 0) {
          cursor = await processBatch(backfilled);
        }
      }

      // ── Process the current batch ─────────────────────────────────────────
      if (events.length > 0) {
        cursor = await processBatch(events);
      }

      if (events.length === MAX_EVENTS_PER_PAGE) {
        // Full page: page through the rest of the window immediately (no wait),
        // recording the speed-up.
        pagingCursor = events[events.length - 1].pagingToken;
        poll.next(events.length);
        continue;
      }

      // Window drained: reset paging, advance startLedger, and apply the
      // adaptive wait (empty → back off, partial → hold steady).
      pagingCursor = undefined;
      startLedger = Math.max(latestLedger, cursor + 1);
      await waitWithAbort(poll.next(events.length), signal);
    } catch (err) {
      console.error("[stream] Error processing batch:", err);
      await waitWithAbort(poll.intervalMs, signal);
    }
  }

  console.log("[stream] Stopped.");
}
