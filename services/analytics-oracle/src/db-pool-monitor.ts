/**
 * Postgres connection pool health monitoring (issue #888).
 *
 * `pg.Pool` emits an `'error'` event when an **idle** client in the pool hits
 * a connection-level failure (the database restarted, the socket was reset,
 * etc). Node's `EventEmitter` treats an `'error'` event with no listener as
 * fatal — it rethrows, which crashes the process. Every intermittent
 * "Connection terminated unexpectedly" outage this issue describes traces
 * back to that: not a failure to reconnect (the pool already creates a fresh
 * client automatically on the next query — there is no persistent
 * "connection" to reconnect), but the missing listener turning a single dead
 * idle client into a process crash.
 *
 * `attachPoolMonitoring` is the fix: it adds that listener (so the pool just
 * logs and discards the dead client, exactly as `pg` intends), plus
 * structured logging for connect/remove events and, optionally, a periodic
 * pool-utilisation log so saturation is visible before it manifests as
 * connection-timeout errors under load.
 */

import type { Pool } from "pg";

export interface PoolLike {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}

export interface PoolMetrics {
  /** Clients currently held by the pool (idle + checked out). */
  totalCount: number;
  /** Clients not currently checked out. */
  idleCount: number;
  /** Queries waiting on a client because the pool is saturated. */
  waitingCount: number;
}

export function getPoolMetrics(pool: PoolLike): PoolMetrics {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
  };
}

export type PoolHealthStatus = "healthy" | "unhealthy";

export interface PoolHealthResult {
  status: PoolHealthStatus;
  latencyMs: number;
  error?: string;
  metrics: PoolMetrics;
}

export interface QueryablePool extends PoolLike {
  query(text: string): Promise<unknown>;
}

/**
 * Runs `SELECT 1` against the pool with a hard timeout. Used by a service's
 * `/health` endpoint to report `healthy` / `unhealthy` rather than only
 * "did the last unrelated query happen to succeed."
 */
export async function checkPoolHealth(
  pool: QueryablePool,
  timeoutMs = 2000
): Promise<PoolHealthResult> {
  const start = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Pool health check timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
    return { status: "healthy", latencyMs: Date.now() - start, metrics: getPoolMetrics(pool) };
  } catch (err) {
    return {
      status: "unhealthy",
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
      metrics: getPoolMetrics(pool),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface PoolLogger {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
}

export interface AttachPoolMonitoringOptions {
  logger: PoolLogger;
  /** Included on every log line so multi-pool deployments can tell them apart. */
  serviceName: string;
  /** Logs pool utilisation on this interval. 0 (default) disables it. */
  statsIntervalMs?: number;
}

/**
 * Attaches the `'error'` handler pg.Pool needs, structured connect/remove
 * logging, and (optionally) periodic stats logging.
 *
 * Returns `stop()` to clear the stats interval on graceful shutdown; safe to
 * ignore if `statsIntervalMs` is 0 (no timer is created).
 */
export function attachPoolMonitoring(
  pool: Pool,
  options: AttachPoolMonitoringOptions
): { stop: () => void } {
  const { logger, serviceName, statsIntervalMs = 0 } = options;

  pool.on("error", (err) => {
    logger.error(
      { err, service: serviceName, ...getPoolMetrics(pool) },
      "Postgres pool error on an idle client — the client is discarded, the pool continues"
    );
  });

  pool.on("connect", () => {
    logger.info(
      { service: serviceName, ...getPoolMetrics(pool) },
      "Postgres pool: client connected"
    );
  });

  pool.on("remove", () => {
    logger.info({ service: serviceName, ...getPoolMetrics(pool) }, "Postgres pool: client removed");
  });

  let timer: NodeJS.Timeout | undefined;
  if (statsIntervalMs > 0) {
    timer = setInterval(() => {
      logger.info({ service: serviceName, ...getPoolMetrics(pool) }, "Postgres pool stats");
    }, statsIntervalMs);
    timer.unref();
  }

  return {
    stop: () => {
      if (timer) clearInterval(timer);
    },
  };
}
