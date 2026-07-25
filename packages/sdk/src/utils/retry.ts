/**
 * Retry primitives — exponential backoff with jitter, a circuit breaker, and
 * `Retry-After` parsing, plus a {@link withRetry} driver that ties them
 * together. Extracted so the retry policy can be unit-tested in isolation from
 * any particular RPC client.
 */

import { CircuitBreakerError } from "../errors";
import type { RetryConfig } from "../config";

/**
 * Compute a backoff delay in ms for a given zero-based attempt index.
 *
 * The delay grows exponentially (`baseDelayMs * 2^attempt`), is capped at
 * `maxDelayMs`, and has up to `jitterFactor * delay` of random jitter added on
 * top to de-synchronize concurrent retriers (avoiding a thundering herd).
 *
 * @param attempt Zero-based attempt index (0 for the first retry).
 * @param baseDelayMs Base multiplier for the exponential term.
 * @param maxDelayMs Upper bound applied to the exponential term before jitter.
 * @param jitterFactor Fraction of the delay used as the jitter window, in [0, 1].
 * @param random Injectable RNG (defaults to `Math.random`) for deterministic tests.
 */
export function backoffWithJitter(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterFactor = 0.5,
  random: () => number = Math.random
): number {
  const exponential = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  const jitter = exponential * jitterFactor * random();
  return exponential + jitter;
}

/**
 * Parse a `Retry-After` header value into milliseconds.
 *
 * Supports both delta-seconds (e.g. `"120"`) and an HTTP date
 * (e.g. `"Wed, 21 Oct 2015 07:28:00 GMT"`). Returns `undefined` for missing or
 * unparseable input.
 *
 * @param value Raw header value (string or number of seconds).
 * @param nowMs Reference "now" in ms for HTTP-date math (defaults to `Date.now()`).
 */
export function parseRetryAfter(
  value: string | number | undefined | null,
  nowMs: number = Date.now()
): number | undefined {
  if (value === undefined || value === null) return undefined;

  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value * 1000 : undefined;
  }

  const trimmed = value.trim();
  if (trimmed === "") return undefined;

  // Delta-seconds form.
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10) * 1000;
  }

  // HTTP-date form.
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, dateMs - nowMs);
}

/**
 * Extract a retry-after delay (ms) from a thrown error, if it carries one.
 *
 * Recognizes a numeric `retryAfterMs`, a `retryAfter` (seconds), an HTTP
 * `status`/`statusCode` of 429 with a `headers["retry-after"]`, or a plain
 * `headers["retry-after"]`.
 */
export function getRetryAfterMs(err: unknown, nowMs: number = Date.now()): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as Record<string, unknown>;

  if (typeof e.retryAfterMs === "number" && Number.isFinite(e.retryAfterMs)) {
    return Math.max(0, e.retryAfterMs);
  }
  if (typeof e.retryAfter === "number" || typeof e.retryAfter === "string") {
    const parsed = parseRetryAfter(e.retryAfter, nowMs);
    if (parsed !== undefined) return parsed;
  }

  const headers = e.headers;
  if (typeof headers === "object" && headers !== null) {
    const h = headers as Record<string, unknown>;
    const raw = h["retry-after"] ?? h["Retry-After"];
    if (typeof raw === "string" || typeof raw === "number") {
      return parseRetryAfter(raw, nowMs);
    }
  }
  return undefined;
}

/**
 * Whether an error represents an HTTP 429 (rate-limited) response.
 */
export function isRateLimited(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as Record<string, unknown>;
  return e.status === 429 || e.statusCode === 429 || getRetryAfterMs(err) !== undefined;
}

/**
 * A minimal consecutive-failure circuit breaker.
 *
 * It opens once `threshold` retryable failures occur back-to-back and stays
 * open until {@link reset} (or a subsequent success) closes it.
 */
export class CircuitBreaker {
  private consecutiveFailures = 0;
  private open = false;

  constructor(private readonly threshold: number) {
    if (threshold < 1) throw new RangeError("CircuitBreaker threshold must be >= 1");
  }

  /** Number of consecutive failures currently recorded. */
  get failures(): number {
    return this.consecutiveFailures;
  }

  /** Whether the breaker is currently open (tripped). */
  get isOpen(): boolean {
    return this.open;
  }

  /** Record a successful operation, closing the breaker and clearing the count. */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.open = false;
  }

  /** Record a failed operation; opens the breaker once the threshold is reached. */
  recordFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.threshold) {
      this.open = true;
    }
  }

  /** Force the breaker closed and reset the failure count. */
  reset(): void {
    this.recordSuccess();
  }
}

/** Reason a retry (or terminal failure) occurred, for structured logging. */
export type RetryReason = "error" | "rate-limited" | "circuit-open" | "exhausted";

/** Structured record describing a single retry decision. */
export interface RetryAttemptInfo {
  /** 1-based attempt number that just failed. */
  attempt: number;
  /** Configured maximum attempts. */
  maxAttempts: number;
  /** Delay in ms before the next attempt (0 for terminal outcomes). */
  delayMs: number;
  /** Why the retry/decision happened. */
  reason: RetryReason;
  /** The underlying error. */
  error: unknown;
}

/** Callback invoked on every retry decision — the structured-logging hook. */
export type RetryLogger = (info: RetryAttemptInfo) => void;

/** Options controlling {@link withRetry}. */
export interface WithRetryOptions {
  /** Backoff / circuit-breaker tunables. */
  config: RetryConfig;
  /** Classifier for whether an error is worth retrying (default: always). */
  isRetryable?: (err: unknown) => boolean;
  /** Shared circuit breaker; created from `config.circuitBreakerThreshold` if omitted. */
  circuitBreaker?: CircuitBreaker;
  /** Structured-logging hook, invoked once per retry/terminal decision. */
  onRetry?: RetryLogger;
  /** Injectable sleep (default: real `setTimeout`). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable RNG passed to the backoff calculation. */
  random?: () => number;
  /** Injectable clock for `Retry-After` HTTP-date math. */
  now?: () => number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `fn` with exponential-backoff-with-jitter retries, honoring rate-limit
 * `Retry-After` hints and a consecutive-failure circuit breaker.
 *
 * Behavior:
 * - Retries only errors for which `isRetryable` returns true; others rethrow immediately.
 * - Each retryable failure advances the circuit breaker; when it opens, the queue is
 *   "paused" by throwing a {@link CircuitBreakerError} so callers can report unhealthy.
 * - A rate-limit `Retry-After` delay takes precedence over the computed backoff.
 * - Every retry decision is reported to `onRetry` for structured logging.
 *
 * @param fn Operation to attempt; receives the zero-based attempt index.
 * @param opts Retry configuration and injectable dependencies.
 * @returns The resolved value of the first successful attempt.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: WithRetryOptions
): Promise<T> {
  const {
    config,
    isRetryable = () => true,
    onRetry,
    sleep = defaultSleep,
    random = Math.random,
    now = Date.now,
  } = opts;
  const breaker = opts.circuitBreaker ?? new CircuitBreaker(config.circuitBreakerThreshold);

  let lastError: unknown;

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    if (breaker.isOpen) {
      throw new CircuitBreakerError(
        "Circuit breaker is open; transaction queue paused due to repeated failures.",
        { consecutiveFailures: breaker.failures },
        lastError
      );
    }

    try {
      const result = await fn(attempt);
      breaker.recordSuccess();
      return result;
    } catch (err) {
      lastError = err;

      if (!isRetryable(err)) {
        throw err;
      }

      breaker.recordFailure();

      // Circuit tripped on this failure — pause the queue and report unhealthy.
      if (breaker.isOpen) {
        onRetry?.({
          attempt: attempt + 1,
          maxAttempts: config.maxAttempts,
          delayMs: 0,
          reason: "circuit-open",
          error: err,
        });
        throw new CircuitBreakerError(
          "Circuit breaker opened after repeated retryable failures; queue paused.",
          { consecutiveFailures: breaker.failures },
          err
        );
      }

      const isLastAttempt = attempt === config.maxAttempts - 1;
      if (isLastAttempt) {
        onRetry?.({
          attempt: attempt + 1,
          maxAttempts: config.maxAttempts,
          delayMs: 0,
          reason: "exhausted",
          error: err,
        });
        throw err;
      }

      const retryAfterMs = getRetryAfterMs(err, now());
      const delayMs =
        retryAfterMs !== undefined
          ? Math.min(retryAfterMs, config.maxDelayMs)
          : backoffWithJitter(
              attempt,
              config.baseDelayMs,
              config.maxDelayMs,
              config.jitterFactor,
              random
            );

      onRetry?.({
        attempt: attempt + 1,
        maxAttempts: config.maxAttempts,
        delayMs,
        reason: retryAfterMs !== undefined ? "rate-limited" : "error",
        error: err,
      });

      await sleep(delayMs);
    }
  }

  // Unreachable in practice (loop either returns or throws), but satisfies the type checker.
  throw lastError instanceof Error ? lastError : new Error("withRetry exhausted all attempts");
}
