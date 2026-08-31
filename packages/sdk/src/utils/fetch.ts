import { TimeoutError } from "../errors.js";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Wrapper around `fetch` that aborts the request after a configurable timeout.
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (isAbortError(err)) {
      throw new TimeoutError(
        `Request to ${typeof url === "string" ? url : url.toString()} timed out after ${timeoutMs}ms`,
        { url: typeof url === "string" ? url : url.toString(), timeoutMs },
        err
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}
