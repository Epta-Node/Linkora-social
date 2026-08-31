/**
 * SDK configuration — environment-driven tunables.
 *
 * Currently exposes the retry / backoff configuration used by
 * {@link TransactionQueue}. Values are read once from the environment and can
 * always be overridden programmatically when constructing a queue.
 */

/**
 * Tunables for exponential-backoff-with-jitter transaction retries.
 */
export interface RetryConfig {
  /** Maximum number of attempts (including the first) per transaction submission. */
  maxAttempts: number;
  /** Base delay in ms used as the multiplier for exponential backoff. */
  baseDelayMs: number;
  /** Upper bound in ms for a single backoff delay. */
  maxDelayMs: number;
  /** Jitter factor in the range [0, 1]; controls the random spread added to each delay. */
  jitterFactor: number;
  /** Consecutive retryable failures tolerated before the circuit breaker opens. */
  circuitBreakerThreshold: number;
}

/**
 * Built-in defaults, matching the documented environment variables.
 */
export const DEFAULT_RETRY_CONFIG: Readonly<RetryConfig> = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitterFactor: 0.5,
  circuitBreakerThreshold: 5,
};

type EnvLike = Record<string, string | undefined>;

function readInt(env: EnvLike, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readFloat(env: EnvLike, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Build a {@link RetryConfig} from environment variables, falling back to
 * {@link DEFAULT_RETRY_CONFIG} for any that are unset or malformed.
 *
 * Recognized variables:
 * - `TX_RETRY_MAX_ATTEMPTS` — Max retry attempts per transaction (default 5)
 * - `TX_RETRY_BASE_DELAY_MS` — Base delay for backoff (default 1000)
 * - `TX_RETRY_MAX_DELAY_MS` — Maximum delay cap (default 30000)
 * - `TX_RETRY_JITTER_FACTOR` — Jitter factor, clamped to [0, 1] (default 0.5)
 * - `TX_RETRY_CIRCUIT_BREAKER_THRESHOLD` — Consecutive failures before pausing (default 5)
 *
 * @param env Environment source, defaults to `process.env`.
 */
export function loadRetryConfig(
  env: EnvLike = typeof process !== "undefined" ? process.env : {}
): RetryConfig {
  const maxAttempts = Math.max(
    1,
    readInt(env, "TX_RETRY_MAX_ATTEMPTS", DEFAULT_RETRY_CONFIG.maxAttempts)
  );
  const baseDelayMs = readInt(env, "TX_RETRY_BASE_DELAY_MS", DEFAULT_RETRY_CONFIG.baseDelayMs);
  const maxDelayMs = Math.max(
    baseDelayMs,
    readInt(env, "TX_RETRY_MAX_DELAY_MS", DEFAULT_RETRY_CONFIG.maxDelayMs)
  );
  const jitterFactor = clamp(
    readFloat(env, "TX_RETRY_JITTER_FACTOR", DEFAULT_RETRY_CONFIG.jitterFactor),
    0,
    1
  );
  const circuitBreakerThreshold = Math.max(
    1,
    readInt(env, "TX_RETRY_CIRCUIT_BREAKER_THRESHOLD", DEFAULT_RETRY_CONFIG.circuitBreakerThreshold)
  );

  return { maxAttempts, baseDelayMs, maxDelayMs, jitterFactor, circuitBreakerThreshold };
}

/**
 * Merge a partial override on top of the environment-derived config.
 */
export function resolveRetryConfig(overrides?: Partial<RetryConfig>): RetryConfig {
  const base = loadRetryConfig();
  return { ...base, ...pruneUndefined(overrides) };
}

function pruneUndefined<T extends object>(obj?: T): Partial<T> {
  if (!obj) return {};
  const out: Partial<T> = {};
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}
