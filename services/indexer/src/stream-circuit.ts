/**
 * Error-type-aware circuit breaker for the live event stream.
 *
 * The stream loop previously counted every error toward a single hardcoded
 * threshold and terminated permanently once it tripped, so a Soroban RPC
 * rolling restart — which produces a burst of `ECONNREFUSED` for ~10s — was
 * enough to halt the indexer until an operator restarted the process.
 *
 * Two ideas fix that:
 *
 *   - **Classification.** Transient transport faults (connection refused,
 *     reset, timed out; 429 and 5xx from the RPC) are expected in normal
 *     operation and are retried indefinitely without counting toward the
 *     trip threshold. Only unclassified errors — the ones that look like a
 *     genuine defect or a permanently misconfigured endpoint — can trip it.
 *   - **Half-open recovery.** Tripping no longer ends the stream. The
 *     breaker opens, waits a probe interval, then allows a single attempt
 *     through; success closes it and the stream carries on.
 */

/** Structured metric names emitted on breaker state transitions. */
export type StreamCircuitState = "closed" | "open" | "half_open";

export const DEFAULT_CIRCUIT_BREAKER_THRESHOLD = 10;
export const DEFAULT_CIRCUIT_BREAKER_PROBE_INTERVAL_MS = 30_000;

/**
 * Transport-level failures that mean "the endpoint is not reachable right
 * now", as distinct from "the endpoint is wrong". `ENOTFOUND` is deliberately
 * absent: a permanently unresolvable host should trip the breaker rather than
 * retry forever, whereas `EAI_AGAIN` (temporary resolver failure) should not.
 */
const RETRIABLE_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "EAI_AGAIN",
  // undici (Node's fetch) surfaces its own codes for the same conditions.
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

/**
 * `pg` reports pool exhaustion as a plain `Error` with no `code`, so it can
 * only be recognised by message. Matches the pool checkout timeout named in
 * the issue's impact list.
 */
const RETRIABLE_MESSAGE_PATTERNS = [
  /timeout exceeded when trying to connect/i,
  /connection terminated unexpectedly/i,
  /connection terminated due to connection timeout/i,
  /too many clients already/i,
];

/** Walk the `cause` chain — Node's `fetch` wraps transport errors in a `TypeError`. */
function* errorChain(error: unknown, maxDepth = 5): Generator<Record<string, unknown>> {
  let current = error;
  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (current === null || typeof current !== "object") return;
    const record = current as Record<string, unknown>;
    yield record;
    current = record.cause;
  }
}

/**
 * Whether `error` is a transient transport fault that should be retried
 * indefinitely rather than counted toward the trip threshold.
 *
 * HTTP status is consulted for `RpcError`: 429 and 5xx are the RPC saying
 * "not now", while a 4xx other than 429 is a malformed request that will not
 * fix itself and so is treated as persistent.
 */
export function isRetriableStreamError(error: unknown): boolean {
  for (const link of errorChain(error)) {
    const code = link.code;
    if (typeof code === "string" && RETRIABLE_ERROR_CODES.has(code)) return true;

    const status = link.status;
    if (typeof status === "number" && (status === 429 || status >= 500)) return true;

    const message = link.message;
    if (
      typeof message === "string" &&
      RETRIABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))
    ) {
      return true;
    }
  }
  return false;
}

export interface StreamCircuitBreakerOptions {
  /** Consecutive persistent failures required to open the breaker. */
  threshold?: number;
  /** How long the breaker stays open before allowing a probe through. */
  probeIntervalMs?: number;
  /** Emits structured metrics; defaults to a `console` JSON line. */
  emit?: (event: Record<string, unknown>) => void;
}

function defaultEmit(event: Record<string, unknown>): void {
  const line = JSON.stringify(event);
  if (event.metric === "stream_circuit_closed") {
    console.warn(line);
  } else {
    console.error(line);
  }
}

/**
 * Tracks retriable and persistent failures separately and exposes the
 * resulting breaker state. Deliberately holds no timers of its own — the
 * stream loop owns waiting, so the whole thing stays synchronous and
 * testable without fake clocks.
 */
export class StreamCircuitBreaker {
  private _state: StreamCircuitState = "closed";
  private _persistentFailures = 0;
  private _retriableFailures = 0;

  readonly threshold: number;
  readonly probeIntervalMs: number;
  private readonly emit: (event: Record<string, unknown>) => void;

  constructor(options: StreamCircuitBreakerOptions = {}) {
    this.threshold = Math.max(1, Math.floor(options.threshold ?? DEFAULT_CIRCUIT_BREAKER_THRESHOLD));
    this.probeIntervalMs = Math.max(
      0,
      Math.floor(options.probeIntervalMs ?? DEFAULT_CIRCUIT_BREAKER_PROBE_INTERVAL_MS)
    );
    this.emit = options.emit ?? defaultEmit;
  }

  get state(): StreamCircuitState {
    return this._state;
  }

  get persistentFailures(): number {
    return this._persistentFailures;
  }

  get retriableFailures(): number {
    return this._retriableFailures;
  }

  /** A batch completed. Clears both counters and closes a half-open breaker. */
  recordSuccess(): void {
    this._persistentFailures = 0;
    this._retriableFailures = 0;
    if (this._state !== "closed") {
      const previous = this._state;
      this._state = "closed";
      this.emit({
        metric: "stream_circuit_closed",
        previousState: previous,
        message: "Stream circuit breaker closed after a successful probe. Streaming resumed.",
      });
    }
  }

  /**
   * A transient transport fault. Counted for observability only — it never
   * moves the breaker, which is the whole point of #1179.
   */
  recordRetriableFailure(error: unknown): void {
    this._retriableFailures += 1;
    this.emit({
      metric: "stream_retriable_error",
      consecutiveRetriableFailures: this._retriableFailures,
      message: "Transient transport error will not count toward the stream circuit breaker",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  /**
   * An unclassified failure. Opens the breaker once `threshold` of them occur
   * back to back. Returns `true` when this call opened it.
   */
  recordPersistentFailure(error: unknown): boolean {
    this._persistentFailures += 1;
    if (this._state === "half_open") {
      // The probe failed; fall back to open and serve another wait.
      this._state = "open";
      this.emit({
        metric: "stream_circuit_open",
        previousState: "half_open",
        consecutiveFailures: this._persistentFailures,
        probeIntervalMs: this.probeIntervalMs,
        message: "Stream circuit breaker probe failed. Reopening.",
        error: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
    if (this._state === "closed" && this._persistentFailures >= this.threshold) {
      this._state = "open";
      this.emit({
        metric: "stream_circuit_open",
        previousState: "closed",
        consecutiveFailures: this._persistentFailures,
        threshold: this.threshold,
        probeIntervalMs: this.probeIntervalMs,
        message: "Stream circuit breaker tripped. Pausing before probe.",
        error: error instanceof Error ? error.message : String(error),
      });
      return true;
    }
    return false;
  }

  /** Move an open breaker to half-open so the next attempt is a probe. */
  beginProbe(): void {
    if (this._state !== "open") return;
    this._state = "half_open";
    this.emit({
      metric: "stream_circuit_half_open",
      previousState: "open",
      consecutiveFailures: this._persistentFailures,
      message: "Stream circuit breaker half-open. Attempting a single probe.",
    });
  }
}
