/**
 * Indexer configuration.
 *
 * Centralises all environment-variable parsing so the rest of the codebase
 * imports typed values rather than calling process.env directly.
 *
 * Backfill settings
 * ─────────────────
 * BACKFILL_MAX_DEPTH_LEDGERS  — Maximum ledgers to backfill in one recovery
 *                               (default 10 000). Gaps larger than this trigger
 *                               an alert instead of an unbounded backfill.
 * BACKFILL_BATCH_SIZE         — Events per batch during backfill (default 100).
 * BACKFILL_RATE_LIMIT_MS      — Delay (ms) between backfill batches for rate
 *                               limiting (default 100 ms).
 * BACKFILL_ALERT_THRESHOLD    — Alert when the detected gap (in ledgers) exceeds
 *                               this value (default 5 000).
 * BACKFILL_CIRCUIT_BREAKER_MAX_FAILURES
 *                             — Stop backfilling and require manual intervention
 *                               after this many consecutive failures (default 5).
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer, got: ${v}`);
  }
  return n;
}

function optionalNonNegInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Environment variable ${name} must be a non-negative integer, got: ${v}`);
  }
  return n;
}

// ── Core ──────────────────────────────────────────────────────────────────────

export interface IndexerConfig {
  databaseUrl: string;
  stellarRpcUrl: string;
  contractId: string;
  startLedger: number;
  port: number;
  scoreRefreshIntervalMinutes: number;

  // Streaming / rate limiting
  rpcRateLimitPerSec: number | undefined;
  minPollIntervalMs: number | undefined;
  maxPollIntervalMs: number | undefined;

  // Backfill
  backfill: BackfillConfig;
}

export interface BackfillConfig {
  /**
   * Maximum ledgers to backfill in a single recovery run. Gaps larger than
   * this trigger an alert and are NOT automatically backfilled.
   */
  maxDepthLedgers: number;

  /**
   * Number of ledgers fetched per batch during backfill.
   */
  batchSize: number;

  /**
   * Milliseconds to wait between backfill batches (rate limiting).
   */
  rateLimitMs: number;

  /**
   * Emit an alert (structured log with metric=backfill_alert) when the
   * detected gap exceeds this many ledgers.
   */
  alertThreshold: number;

  /**
   * Stop backfilling and require manual intervention after this many
   * consecutive batch failures (circuit-breaker threshold).
   */
  circuitBreakerMaxFailures: number;
}

/** Parse and validate configuration from environment variables. */
export function loadConfig(): IndexerConfig {
  const raw = {
    databaseUrl: requireEnv("DATABASE_URL"),
    stellarRpcUrl: requireEnv("STELLAR_RPC_URL"),
    contractId: requireEnv("CONTRACT_ID"),
    startLedger: parseInt(requireEnv("START_LEDGER"), 10),
    port: optionalNonNegInt("PORT", 3000),
    scoreRefreshIntervalMinutes: optionalInt("SCORE_REFRESH_INTERVAL_MINUTES", 5),

    rpcRateLimitPerSec: process.env.RPC_RATE_LIMIT_PER_SEC
      ? parseInt(process.env.RPC_RATE_LIMIT_PER_SEC, 10)
      : undefined,
    minPollIntervalMs: process.env.MIN_POLL_INTERVAL_MS
      ? parseInt(process.env.MIN_POLL_INTERVAL_MS, 10)
      : undefined,
    maxPollIntervalMs: process.env.MAX_POLL_INTERVAL_MS
      ? parseInt(process.env.MAX_POLL_INTERVAL_MS, 10)
      : undefined,

    backfill: {
      maxDepthLedgers: optionalInt("BACKFILL_MAX_DEPTH_LEDGERS", 10_000),
      batchSize: optionalInt("BACKFILL_BATCH_SIZE", 100),
      rateLimitMs: optionalNonNegInt("BACKFILL_RATE_LIMIT_MS", 100),
      alertThreshold: optionalInt("BACKFILL_ALERT_THRESHOLD", 5_000),
      circuitBreakerMaxFailures: optionalInt("BACKFILL_CIRCUIT_BREAKER_MAX_FAILURES", 5),
    },
  };

  if (!Number.isFinite(raw.startLedger) || raw.startLedger < 0) {
    throw new Error(`START_LEDGER must be a non-negative integer, got: ${process.env.START_LEDGER}`);
  }

  return raw;
}
