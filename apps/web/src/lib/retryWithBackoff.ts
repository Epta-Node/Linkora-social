/** Default wallet-connect backoff: retry after 500ms, 1s, then 2s. */
export const WALLET_RETRY_DELAYS_MS = [500, 1000, 2000] as const;

export interface RetryOptions {
  /** Delay before each retry; its length is the number of retries. */
  delaysMs: readonly number[];
  /** Return false to stop retrying and rethrow immediately. */
  shouldRetry?: (error: unknown) => boolean;
  /** Called before waiting for retry number `attempt` (1-based). */
  onRetry?: (attempt: number, error: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `fn`, retrying failures with the given delays. Throws the last error. */
export async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { delaysMs, shouldRetry = () => true, onRetry, sleep = defaultSleep } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= delaysMs.length || !shouldRetry(error)) throw error;
      onRetry?.(attempt + 1, error);
      await sleep(delaysMs[attempt]);
    }
  }
}
