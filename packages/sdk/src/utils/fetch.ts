import { RetryExhaustedError, TimeoutError } from "../errors.js";

const DEFAULT_TIMEOUT_MS = 30_000;

/** Maximum retries after the initial attempt, regardless of caller input. */
const MAX_RETRIES = 5;

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 100;
const DEFAULT_MAX_DELAY_MS = 5_000;

/** Methods that are safe to repeat and may therefore be retried. */
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Options for {@link fetchWithRetry}.
 */
export interface FetchRetryOptions {
  /** Retries after the initial attempt, capped at {@link MAX_RETRIES} (default 2). */
  retries?: number;
  /** Backoff base delay in ms; doubles each attempt (default 100). */
  baseDelayMs?: number;
  /** Backoff delay cap in ms (default 5 000). */
  maxDelayMs?: number;
  /** Opt a non-GET request that is safe to repeat (e.g. an RPC simulate) into retries. */
  idempotent?: boolean;
  /** Called before each retry with (attempt number, backoff delay ms, error). */
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
}

/**
 * Wrapper around `fetch` that aborts the request after a configurable timeout.
 *
 * A caller-supplied `init.signal` is combined with the internal timeout
 * controller so either can cancel the request (issue #1344): a caller abort
 * propagates as the original `AbortError` — distinguishable from a timeout —
 * while an internal timeout raises {@link TimeoutError}.
 *
 * @param url The URL to fetch.
 * @param init Standard `RequestInit` options.
 * @param timeoutMs Timeout in milliseconds (default 30 000). Pass `0` to disable.
 * @returns The fetch `Response`.
 * @throws {TimeoutError} When the request exceeds the timeout.
 */
export async function fetchWithTimeout(
  url: string | URL,
  init: RequestInit | undefined,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  if (timeoutMs <= 0) {
    return fetch(url, init);
  }

  const callerSignal = init?.signal ?? null;
  const controller = new AbortController();
  const forwardCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener("abort", forwardCallerAbort);
    }
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const urlText = typeof url === "string" ? url : url.toString();

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (isAbortError(err)) {
      if (callerSignal?.aborted) {
        throw err;
      }
      throw new TimeoutError(
        `Request to ${urlText} timed out after ${timeoutMs}ms`,
        { url: urlText, timeoutMs },
        err
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", forwardCallerAbort);
  }
}

/**
 * Adds bounded exponential-backoff retries for idempotent requests on top of
 * {@link fetchWithTimeout} (issue #1363).
 *
 * Only idempotent requests retry: `GET`/`HEAD`/`OPTIONS`, or any method with
 * `idempotent: true` (e.g. an RPC simulate). Non-idempotent submits keep
 * their existing separate retry handling in the transaction queue and are
 * never retried here. A caller `AbortError` is final and is not retried.
 * HTTP status handling stays with callers — only transport failures
 * (network errors, timeouts) are retried.
 *
 * @param url The URL to fetch.
 * @param init Standard `RequestInit` options.
 * @param timeoutMs Timeout per attempt in milliseconds (default 30 000). Pass `0` to disable.
 * @param retryOptions Bounds, backoff tuning and per-retry reporting.
 * @returns The fetch `Response`.
 * @throws {RetryExhaustedError} When every attempt failed on a transport error.
 */
export async function fetchWithRetry(
  url: string | URL,
  init: RequestInit | undefined,
  timeoutMs?: number,
  retryOptions?: FetchRetryOptions
): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const idempotent = retryOptions?.idempotent === true || IDEMPOTENT_METHODS.has(method);
  const urlText = typeof url === "string" ? url : url.toString();

  if (!idempotent) {
    return fetchWithTimeout(url, init, timeoutMs);
  }

  const retries = Math.min(
    Math.max(retryOptions?.retries ?? DEFAULT_MAX_RETRIES, 0),
    MAX_RETRIES
  );
  const baseDelayMs = retryOptions?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = retryOptions?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchWithTimeout(url, init, timeoutMs);
    } catch (error: unknown) {
      lastError = error;
      if (attempt === retries) break;
      // A caller abort is intentional — do not retry an aborted request.
      if (isAbortError(error) && (init?.signal?.aborted ?? false)) {
        throw error;
      }
      const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      retryOptions?.onRetry?.(attempt + 1, delay, error);
      await sleep(delay);
    }
  }

  throw new RetryExhaustedError(
    `Request to ${urlText} failed after ${retries + 1} attempts.`,
    { url: urlText, attempts: retries + 1 },
    lastError
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}
