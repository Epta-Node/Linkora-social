import { Pool } from "pg";
import cron from "node-cron";
import { scoreRefreshDeferredTotal } from "./metrics";

/**
 * Score refresh service
 * Refreshes the post_scores materialized view on a schedule.
 * The materialized view now includes normalized tags for case-insensitive filtering.
 *
 * `REFRESH MATERIALIZED VIEW CONCURRENTLY` only allows one concurrent refresh
 * at a time and requires exclusive access for a brief final swap, so under
 * load a refresh can be skipped with "Refresh skipped because another refresh
 * is in progress" or fail with a lock timeout.  Instead of logging-and-dropping
 * on the first collision, this service:
 *
 *  1. Retries transient collisions (active concurrent refresh, lock timeout,
 *     statement timeout, deadlock / serialization failures) with exponential
 *     backoff and jitter.
 *  2. Bounds each attempt with `statement_timeout` so a stuck refresh cannot
 *     monopolise the connection.
 *  3. Emits a structured `score_refresh_deferred` metric (log + Prometheus
 *     counter) on every deferred attempt for observability.
 */
export class ScoreRefreshService {
  private pool: Pool;
  private cronJob: cron.ScheduledTask | null = null;
  private refreshIntervalMinutes: number;
  private statementTimeoutMs: number;
  private maxRetries: number;
  private retryBaseDelayMs: number;
  private retryMaxDelayMs: number;
  private jitterFraction: number;

  constructor(
    pool: Pool,
    refreshIntervalMinutes: number = 5,
    options: {
      /** Per-attempt statement_timeout for the REFRESH. Default 30 000 ms. */
      statementTimeoutMs?: number;
      /** Max consecutive retries after the first collision. Default 5. */
      maxRetries?: number;
      /** Base delay for the first retry; doubles per retry. Default 1 000 ms. */
      retryBaseDelayMs?: number;
      /** Upper bound on the exponential backoff delay. Default 30 000 ms. */
      retryMaxDelayMs?: number;
      /** Fraction of the interval to jitter each scheduled run. Default 0.25. */
      jitterFraction?: number;
    } = {}
  ) {
    this.pool = pool;
    this.refreshIntervalMinutes = refreshIntervalMinutes;
    this.statementTimeoutMs = options.statementTimeoutMs ?? 30_000;
    this.maxRetries = options.maxRetries ?? 5;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 1_000;
    this.retryMaxDelayMs = options.retryMaxDelayMs ?? 30_000;
    this.jitterFraction = options.jitterFraction ?? 0.25;
  }

  /**
   * Refresh the post_scores materialized view with retry-on-collision.
   *
   * Runs on a dedicated connection inside a transaction with a per-attempt
   * `statement_timeout`. Transient collisions are retried with exponential
   * backoff + jitter; non-transient failures are thrown after logging.
   */
  async refreshScores(): Promise<void> {
    const client = await this.pool.connect();
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          await client.query("BEGIN");
          await client.query(`SET LOCAL statement_timeout = ${this.statementTimeoutMs}`);
          await client.query("REFRESH MATERIALIZED VIEW CONCURRENTLY post_scores");
          await client.query("COMMIT");
          console.log("[score-refresh] Successfully refreshed post_scores materialized view");
          return;
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {
            /* connection already broken — nothing to roll back */
          });

          if (!isTransientRefreshError(error) || attempt >= this.maxRetries) {
            console.error("[score-refresh] Failed to refresh post_scores:", error);
            throw error;
          }

          // Deferred refresh — emit metric + log, then back off and retry.
          const retryInMs = jitteredBackoff(this.retryBaseDelayMs, attempt, this.retryMaxDelayMs);
          scoreRefreshDeferredTotal.inc();
          console.log(
            JSON.stringify({
              metric: "score_refresh_deferred",
              message: "Concurrent refresh or lock contention — retrying with backoff",
              attempt: attempt + 1,
              maxRetries: this.maxRetries,
              retryInMs,
              code: extractErrorCode(error),
            })
          );
          await sleep(retryInMs);
        }
      }
    } finally {
      client.release();
    }
  }

  /**
   * Start the scheduled refresh job.
   *
   * Each scheduled run is delayed by a small jitter (up to `jitterFraction` of
   * the interval) so multiple indexer replicas do not all fire a refresh at
   * the exact same clock boundary — the primary cause of concurrent-refresh
   * collisions in a scaled deployment.
   */
  start(): void {
    if (this.cronJob) {
      console.warn("[score-refresh] Score refresh job already running");
      return;
    }

    const cronExpression = `*/${this.refreshIntervalMinutes} * * * *`;
    console.log(
      `[score-refresh] Starting score refresh job with interval: ${this.refreshIntervalMinutes} minutes`
    );

    this.cronJob = cron.schedule(cronExpression, async () => {
      await sleep(this.jitterDelayMs());
      try {
        await this.refreshScores();
      } catch (err) {
        // Retries exhausted or a non-transient failure — keep the scheduler alive.
        console.error("[score-refresh] Refresh job iteration failed:", err);
      }
    });

    // Run initial refresh with a jittered delay so replicas desynchronise at boot.
    this.sleepThenRefresh(this.jitterDelayMs());
  }

  /**
   * Stop the scheduled refresh job.
   */
  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      console.log("[score-refresh] Score refresh job stopped");
    }
  }

  private async sleepThenRefresh(delayMs: number): Promise<void> {
    await sleep(delayMs);
    this.refreshScores().catch((err) => {
      console.error("[score-refresh] Initial refresh failed:", err);
    });
  }

  private jitterDelayMs(): number {
    const intervalMs = this.refreshIntervalMinutes * 60 * 1000;
    const bound = Math.max(0, intervalMs * this.jitterFraction);
    return Math.floor(Math.random() * bound);
  }
}

// ── Transient-failure detection ──────────────────────────────────────────────

const CONCURRENT_REFRESH_RE = /another[^]*refresh is in progress/i;

/**
 * True when an error represents a transient refresh collision worth retrying:
 * an active concurrent refresh, a lock timeout, a statement timeout, or a
 * deadlock / serialization failure. Anything else is fatal.
 */
function isTransientRefreshError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message;
  if (CONCURRENT_REFRESH_RE.test(message)) return true;

  const code = extractErrorCode(error);
  // 55P03 lock_not_available, 57014 statement_timeout, 40P01 deadlock_detected,
  // 40001 serialization_failure
  return code === "55P03" || code === "57014" || code === "40P01" || code === "40001";
}

function extractErrorCode(error: unknown): string | undefined {
  return (error as { code?: unknown })?.code as string | undefined;
}

// ── Backoff helpers ──────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with full jitter within [base * 2^attempt, max]. */
function jitteredBackoff(baseMs: number, attempt: number, maxMs: number): number {
  const upper = Math.min(baseMs * 2 ** attempt, maxMs);
  const lower = Math.floor(upper / 2);
  return lower + Math.floor(Math.random() * (upper - lower + 1));
}
