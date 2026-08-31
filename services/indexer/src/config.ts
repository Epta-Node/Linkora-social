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
 * STREAM_CIRCUIT_BREAKER_THRESHOLD
 *                             — Consecutive *persistent* live-stream failures
 *                               before the circuit breaker opens (default 10).
 *                               Transient transport faults (ECONNREFUSED,
 *                               ETIMEDOUT, 429/5xx, ...) never count toward it.
 * STREAM_CIRCUIT_BREAKER_PROBE_INTERVAL_MS
 *                             — How long the stream breaker stays open before
 *                               letting a single probe through (default 30000).
 * BACKFILL_CIRCUIT_BREAKER_MAX_FAILURES
 *                             — Stop backfilling and require manual intervention
 *                               after this many consecutive failures (default 5).
 *
 * Retention settings (raw_events partition management)
 * ──────────────────────────────────────────────────────
 * RAW_EVENTS_RETENTION_LEDGERS — Number of ledgers to keep before dropping old
 *                                partitions (default 4 000 000 ≈ 231 days).
 * RAW_EVENTS_PARTITION_SIZE    — Ledger range per partition bucket
 *                                (default 1 000 000).  Must match the value
 *                                used in migration 012.
 * RAW_EVENTS_ARCHIVE_ONLY      — Set to "true" to detach rather than drop old
 *                                partitions (default false).
 * RAW_EVENTS_RETENTION_CRON    — cron schedule for the retention job
 *                                (default "5 * * * *" — every hour at :05).
 *
 * Connection pool settings
 * ─────────────────────────
 * DB_POOL_MAX                — Maximum PostgreSQL pool connections (default 20).
 * DB_POOL_IDLE_TIMEOUT       — Milliseconds an idle connection is kept before
 *                               being closed (default 30 000).
 * DB_POOL_CONNECTION_TIMEOUT — Milliseconds to wait for a connection before
 *                               failing (default 5 000).
 *
 * Shutdown settings
 * ─────────────────
 * SHUTDOWN_TIMEOUT_MS         — Milliseconds to wait for in-flight requests to
 *                               drain before forcing the process to exit
 *                               (default 30 000).
 *
 * Rate limiting
 * ─────────────
 * REDIS_URL                   — Shared Redis endpoint backing the HTTP rate
 *                               limiter. REQUIRED when NODE_ENV=production;
 *                               without it every replica keeps its own counters
 *                               and the effective limit becomes
 *                               RATE_LIMIT × replicaCount.
 * ALLOW_IN_MEMORY_RATE_LIMIT  — Explicit opt-out allowing the in-memory store
 *                               in production. Only safe for single-replica
 *                               deployments.
 */

import { resolveRateLimitEnv } from "@linkora/types/src/rate-limit-env";

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

  /**
   * Shared Redis endpoint for the HTTP rate limiter. Undefined only when the
   * service is allowed to run with per-instance in-memory counters.
   */
  redisUrl: string | undefined;

  // Streaming / rate limiting
  rpcRateLimitPerSec: number | undefined;
  minPollIntervalMs: number | undefined;
  maxPollIntervalMs: number | undefined;
  /** Consecutive persistent stream failures before the circuit breaker opens. */
  streamCircuitBreakerThreshold: number;
  /** How long the stream breaker stays open before probing once. */
  streamCircuitBreakerProbeIntervalMs: number;

  // Database connection pool
  pgPoolMin: number;
  pgPoolMax: number;

  // Backfill
  backfill: BackfillConfig;

  // Raw-events retention / partition management
  rawEventsRetention: RawEventsRetentionCfg;

  // PostgreSQL connection pool
  dbPool: DbPoolConfig;

  // Graceful shutdown drain timeout (ms)
  shutdownTimeoutMs: number;
}

export interface DbPoolConfig {
  /** Maximum number of clients in the pool. */
  max: number;
  /** Milliseconds an idle client is kept before being closed. */
  idleTimeoutMs: number;
  /** Milliseconds to wait for a connection before failing. */
  connectionTimeoutMs: number;
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
   * Number of ledgers the RPC's latest closed ledger must advance past a
   * suspected hole before the gap is declared durable. Benign RPC lag (a
   * ledger that is not yet finalised) is reported as "still catching up"
   * instead of tripping the alert until the RPC has moved at least this many
   * ledgers beyond the hole. Default: 200.
   */
  gapConfirmationLedgers: number;

  /**
   * Stop backfilling and require manual intervention after this many
   * consecutive batch failures (circuit-breaker threshold).
   */
  circuitBreakerMaxFailures: number;
}

export interface RawEventsRetentionCfg {
  /** Number of ledgers to retain. Default 4 000 000 (≈ 231 days). */
  retentionLedgers: number;
  /** Ledger range per partition. Default 1 000 000. */
  partitionSize: number;
  /** Detach-only mode — do not DROP old partitions. Default false. */
  archiveOnly: boolean;
  /** node-cron schedule. Default every hour at :05. */
  cronSchedule: string;
}

/** Parse and validate configuration from environment variables. */
export function loadConfig(): IndexerConfig {
  // Throws when NODE_ENV=production and no shared rate-limit store is
  // configured, so a deployment can never silently run with per-replica limits.
  const rateLimitEnv = resolveRateLimitEnv("indexer");

  const raw = {
    databaseUrl: requireEnv("DATABASE_URL"),
    stellarRpcUrl: requireEnv("STELLAR_RPC_URL"),
    contractId: requireEnv("CONTRACT_ID"),
    startLedger: parseInt(requireEnv("START_LEDGER"), 10),
    port: optionalNonNegInt("PORT", 3000),
    scoreRefreshIntervalMinutes: optionalInt("SCORE_REFRESH_INTERVAL_MINUTES", 5),

    redisUrl: rateLimitEnv.redisUrl,

    rpcRateLimitPerSec: process.env.RPC_RATE_LIMIT_PER_SEC
      ? parseInt(process.env.RPC_RATE_LIMIT_PER_SEC, 10)
      : undefined,
    minPollIntervalMs: process.env.MIN_POLL_INTERVAL_MS
      ? parseInt(process.env.MIN_POLL_INTERVAL_MS, 10)
      : undefined,
    maxPollIntervalMs: process.env.MAX_POLL_INTERVAL_MS
      ? parseInt(process.env.MAX_POLL_INTERVAL_MS, 10)
      : undefined,

    streamCircuitBreakerThreshold: optionalInt("STREAM_CIRCUIT_BREAKER_THRESHOLD", 10),
    streamCircuitBreakerProbeIntervalMs: optionalInt(
      "STREAM_CIRCUIT_BREAKER_PROBE_INTERVAL_MS",
      30_000
    ),

    pgPoolMin: optionalInt("PG_POOL_MIN", 2),
    pgPoolMax: optionalInt("PG_POOL_MAX", 10),

    backfill: {
      maxDepthLedgers: optionalInt("BACKFILL_MAX_DEPTH_LEDGERS", 10_000),
      batchSize: optionalInt("BACKFILL_BATCH_SIZE", 100),
      rateLimitMs: optionalNonNegInt("BACKFILL_RATE_LIMIT_MS", 100),
      alertThreshold: optionalInt("BACKFILL_ALERT_THRESHOLD", 5_000),
      gapConfirmationLedgers: optionalInt("BACKFILL_GAP_CONFIRMATION_LEDGERS", 200),
      circuitBreakerMaxFailures: optionalInt("BACKFILL_CIRCUIT_BREAKER_MAX_FAILURES", 5),
    },

    rawEventsRetention: {
      retentionLedgers: optionalInt("RAW_EVENTS_RETENTION_LEDGERS", 4_000_000),
      partitionSize: optionalInt("RAW_EVENTS_PARTITION_SIZE", 1_000_000),
      archiveOnly: process.env.RAW_EVENTS_ARCHIVE_ONLY === "true",
      cronSchedule: process.env.RAW_EVENTS_RETENTION_CRON ?? "5 * * * *",
    },

    dbPool: {
      max: optionalInt("DB_POOL_MAX", 20),
      idleTimeoutMs: optionalInt("DB_POOL_IDLE_TIMEOUT", 30_000),
      connectionTimeoutMs: optionalInt("DB_POOL_CONNECTION_TIMEOUT", 5_000),
    },

    shutdownTimeoutMs: optionalInt("SHUTDOWN_TIMEOUT_MS", 30_000),
  };

  if (!Number.isFinite(raw.startLedger) || raw.startLedger < 0) {
    throw new Error(
      `START_LEDGER must be a non-negative integer, got: ${process.env.START_LEDGER}`
    );
  }

  return raw;
}
