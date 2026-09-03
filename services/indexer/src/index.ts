/**
 * Linkora Indexer — entry point.
 *
 * Connects to a Soroban RPC endpoint and streams Linkora contract events
 * through an exactly-once pipeline:
 *
 *   RPC getEvents → stream (rate-limited, adaptive, gap-aware)
 *                 → IngestPipeline (raw_events + domain write + cursor, 1 txn)
 *                 → EventBus → WebSocket fanout (/ws)
 *
 * Environment variables — see src/config.ts for the full reference.
 * Backfill-specific variables:
 *   BACKFILL_MAX_DEPTH_LEDGERS         — default 10000
 *   BACKFILL_BATCH_SIZE                — default 100
 *   BACKFILL_RATE_LIMIT_MS             — default 100
 *   BACKFILL_ALERT_THRESHOLD           — default 5000
 *   BACKFILL_CIRCUIT_BREAKER_MAX_FAILURES — default 5
 */

import http from "http";
import { InstrumentedPool } from "./instrumented-pool";
import { streamEvents, backfillStartupGap, RawEvent, BatchProcessor } from "./stream";
import { IngestPipeline, IngestEvent } from "./pipeline";
import { bus } from "./bus";
import { attachWebSocketServer } from "./ws";
import { startGossip } from "./gossip";
import { attachNotificationDispatcher } from "./notifications/events";
import { NotificationService, PostgresDeviceTokenStore } from "./notifications/service";
import { createApp } from "./api";
import { createDomainProcessor } from "./domain-processor";
import { applyStateRootDelta } from "./stateRoot";
import { PostgresDatabase } from "./postgres-db";
import { ScoreRefreshService } from "./score-refresh";
import { HealthMonitor } from "./services/health-monitor";
import { BackfillCoordinator } from "./services/backfill-coordinator";
import { loadConfig } from "./config";
import { GracefulShutdown } from "./graceful-shutdown";
import { logger } from "./logger";
import { initRateLimiter } from "./middleware/rateLimit";
import { RawEventsRetentionManager } from "./retention";

// ── Config ────────────────────────────────────────────────────────────────────

const cfg = loadConfig();

const DATABASE_URL = cfg.databaseUrl;
const STELLAR_RPC_URL = cfg.stellarRpcUrl;
const CONTRACT_ID = cfg.contractId;
const START_LEDGER = cfg.startLedger;
const PORT = cfg.port;
const SCORE_REFRESH_INTERVAL_MINUTES = cfg.scoreRefreshIntervalMinutes;

// ── Database ──────────────────────────────────────────────────────────────────

const STATEMENT_TIMEOUT_MS = parseInt(process.env.STATEMENT_TIMEOUT_MS || "30000", 10);
const LOCK_TIMEOUT_MS = parseInt(process.env.LOCK_TIMEOUT_MS || "10000", 10);
const SLOW_QUERY_THRESHOLD_MS = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || "5000", 10);
const POOL_STATS_LOG_INTERVAL_MS = parseInt(process.env.DB_POOL_STATS_INTERVAL_MS || "60000", 10);

const pgPool = new InstrumentedPool(SLOW_QUERY_THRESHOLD_MS, {
  connectionString: DATABASE_URL,
  statement_timeout: STATEMENT_TIMEOUT_MS,
  lock_timeout: LOCK_TIMEOUT_MS,
  max: cfg.dbPool.max,
  idleTimeoutMillis: cfg.dbPool.idleTimeoutMs,
  connectionTimeoutMillis: cfg.dbPool.connectionTimeoutMs,
  min: cfg.pgPoolMin,
});

logger.info(
  {
    max: cfg.dbPool.max,
    idleTimeoutMs: cfg.dbPool.idleTimeoutMs,
    connectionTimeoutMs: cfg.dbPool.connectionTimeoutMs,
  },
  "PostgreSQL pool configured"
);

// Periodically log pool utilisation so saturation is visible before it
// manifests as connection-timeout errors under load.
const poolStatsTimer = setInterval(() => {
  logger.info(
    {
      totalCount: pgPool.totalCount,
      idleCount: pgPool.idleCount,
      waitingCount: pgPool.waitingCount,
    },
    "PostgreSQL pool stats"
  );
}, POOL_STATS_LOG_INTERVAL_MS);
poolStatsTimer.unref();

const notificationService = new NotificationService({
  deviceTokenStore: new PostgresDeviceTokenStore(pgPool),
  pool: pgPool,
});
const scoreRefreshService = new ScoreRefreshService(pgPool, SCORE_REFRESH_INTERVAL_MINUTES);
const rawEventsRetentionManager = new RawEventsRetentionManager(pgPool, cfg.rawEventsRetention);

/**
 * Idempotently ensure the staging table and cursor exist. Mirrors
 * migrations/006_raw_events.sql + 012_raw_events_partitioned.sql for dev/test
 * environments that boot without a separate migration step.
 *
 * When raw_events already exists as a plain (non-partitioned) heap table this
 * function leaves it untouched — run migration 012 to convert it.  Fresh
 * deployments get the partitioned layout from the start.
 */
async function _ensureSchema(): Promise<void> {
  // ── raw_events ─────────────────────────────────────────────────────────────
  // Only create the partitioned parent when raw_events does not yet exist at
  // all.  If it already exists (partitioned or not) we leave it in place;
  // migration 012 handles the conversion for existing deployments.
  const rawEventsExists = await pgPool
    .query<{ exists: boolean }>(`SELECT to_regclass('public.raw_events') IS NOT NULL AS exists`)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .then((r: any) => r.rows[0]?.exists ?? false);

  if (!rawEventsExists) {
    // Create the partitioned parent.
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS raw_events (
        id              BIGSERIAL   NOT NULL,
        ledger_sequence BIGINT      NOT NULL,
        event_index     INT         NOT NULL,
        contract_id     TEXT        NOT NULL,
        topic           TEXT[]      NOT NULL,
        data            JSONB       NOT NULL,
        processed_at    TIMESTAMPTZ,
        PRIMARY KEY (ledger_sequence, event_index)
      ) PARTITION BY RANGE (ledger_sequence)
    `);

    // Indexes on the parent — propagated to every child partition (PG 11+).
    // PG requires all partitioning columns in a unique index, so we include
    // ledger_sequence alongside id. Names match migration 012.
    await pgPool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_events_id1
        ON raw_events (id, ledger_sequence)
    `);
    await pgPool.query(`
      CREATE INDEX IF NOT EXISTS idx_raw_events_contract_id1
        ON raw_events (contract_id)
    `);
    await pgPool.query(`
      CREATE INDEX IF NOT EXISTS idx_raw_events_ledger1
        ON raw_events (ledger_sequence)
    `);
    // Partial index for crash-recovery: only unprocessed rows are indexed.
    await pgPool.query(`
      CREATE INDEX IF NOT EXISTS idx_raw_events_unprocessed
        ON raw_events (ledger_sequence, event_index)
        WHERE processed_at IS NULL
    `);

    // Default catch-all partition (absorbs inserts not covered by a named bucket).
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS raw_events_default
        PARTITION OF raw_events DEFAULT
    `);

    // Seed the first two 1M-ledger buckets so initial inserts never hit the
    // default partition.  The retention manager creates further buckets
    // proactively as the indexer cursor advances.
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS raw_events_p0_1000000
        PARTITION OF raw_events FOR VALUES FROM (0) TO (1000000)
    `);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS raw_events_p1000000_2000000
        PARTITION OF raw_events FOR VALUES FROM (1000000) TO (2000000)
    `);
  } else {
    // Table exists — ensure at minimum the partial index is present.
    // (It will be a no-op if the index already exists.)
    await pgPool.query(`
      CREATE INDEX IF NOT EXISTS idx_raw_events_unprocessed
        ON raw_events (ledger_sequence, event_index)
        WHERE processed_at IS NULL
    `);
  }

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS indexer_cursor (
      id               TEXT        PRIMARY KEY,
      processed_cursor BIGINT      NOT NULL DEFAULT 0,
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS indexer_state (
      ledger_sequence BIGINT      PRIMARY KEY,
      state_root      TEXT        NOT NULL,
      computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // ── Incremental state-root tables (migration 015) ───────────────────────
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS state_root_accumulators (
      table_name  TEXT        PRIMARY KEY,
      accumulator TEXT        NOT NULL DEFAULT repeat('0', 64),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`
    INSERT INTO state_root_accumulators (table_name, accumulator)
    VALUES
      ('posts',              repeat('0', 64)),
      ('follows',            repeat('0', 64)),
      ('profiles',           repeat('0', 64)),
      ('pools',              repeat('0', 64)),
      ('__bootstrap_done__', repeat('0', 64))
    ON CONFLICT (table_name) DO NOTHING
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS state_root_row_hashes (
      table_name  TEXT        NOT NULL,
      row_key     TEXT        NOT NULL,
      row_hash    TEXT        NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (table_name, row_key)
    )
  `);
  await pgPool.query(`
    CREATE INDEX IF NOT EXISTS idx_state_root_row_hashes_table
      ON state_root_row_hashes (table_name)
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS device_tokens (
      id         SERIAL      PRIMARY KEY,
      address    TEXT        NOT NULL,
      token      TEXT        NOT NULL,
      platform   TEXT        NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (address, token)
    )
  `);
  await pgPool.query(`
    CREATE INDEX IF NOT EXISTS idx_device_tokens_address_updated
      ON device_tokens (address, updated_at DESC)
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS sent_notifications (
      id              BIGSERIAL    PRIMARY KEY,
      event_id        BIGINT       NOT NULL,
      event_type      TEXT         NOT NULL,
      recipient       TEXT         NOT NULL,
      dispatch_key    TEXT         NOT NULL,
      dispatched_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      UNIQUE (dispatch_key)
    )
  `);
  await pgPool.query(`
    CREATE INDEX IF NOT EXISTS idx_sent_notifications_recipient
      ON sent_notifications (recipient, dispatched_at DESC)
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS blocks (
      blocker TEXT NOT NULL,
      blocked TEXT NOT NULL,
      PRIMARY KEY (blocker, blocked)
    )
  `);
  await pgPool.query(`
    CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks (blocker)
  `);
  await pgPool.query(`
    CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks (blocked)
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS dm_keys (
      address       TEXT PRIMARY KEY,
      x25519_pubkey TEXT NOT NULL,
      updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS notification_preferences (
      address              TEXT PRIMARY KEY,
      browser_push_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      new_followers        BOOLEAN NOT NULL DEFAULT TRUE,
      new_likes            BOOLEAN NOT NULL DEFAULT TRUE,
      new_comments         BOOLEAN NOT NULL DEFAULT TRUE,
      direct_messages      BOOLEAN NOT NULL DEFAULT TRUE,
      pool_activity        BOOLEAN NOT NULL DEFAULT TRUE,
      governance_updates   BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// ── Event normalisation ─────────────────────────────────────────────────────

function toIngestEvent(event: RawEvent): IngestEvent {
  return {
    ledgerSequence: event.ledger,
    eventIndex: event.eventIndex,
    contractId: event.contractId,
    type: event.topic[0] ?? "unknown",
    topic: event.topic,
    data: {
      id: event.id,
      value: event.value,
      txHash: event.txHash,
      ledgerClosedAt: event.ledgerClosedAt,
      pagingToken: event.pagingToken,
    },
  };
}

// ── Graceful shutdown ────────────────────────────────────────────────────────

const healthMonitor = new HealthMonitor(pgPool, STELLAR_RPC_URL);
const abortController = new AbortController();
const shutdownFlag = { active: false };

const apiApp = createApp(new PostgresDatabase(pgPool), pgPool, healthMonitor, shutdownFlag);
const httpServer = http.createServer(apiApp);

const wsHandle = attachWebSocketServer(httpServer, bus, { path: "/ws" });
const detachNotificationDispatcher = attachNotificationDispatcher(bus, pgPool, notificationService);

// ── Lifecycle control ────────────────────────────────────────────────────────

const gracefulShutdown = new GracefulShutdown({
  httpServer,
  pgPool,
  wsHandle,
  abortController,
  scoreRefreshStop: () => scoreRefreshService.stop(),
  detachNotificationDispatcher,
  shutdownTimeoutMs: cfg.shutdownTimeoutMs,
  onSignal: (signal) => {
    logger.info({ signal }, "Graceful shutdown initiated");
    healthMonitor.markShuttingDown();
    clearInterval(poolStatsTimer);
    rawEventsRetentionManager.stop();
  },
  shutdownFlag,
});

gracefulShutdown.registerSignals();

// ── Core runner ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info("Starting Linkora indexer");
  logger.info(
    { rpcUrl: STELLAR_RPC_URL, contractId: CONTRACT_ID, startLedger: START_LEDGER },
    "Config"
  );

  // Initialise HTTP rate limiter (upgrades to Redis store when REDIS_URL is set).
  await initRateLimiter();

  await assertSchemaVersion(pgPool);

  const pipeline = new IngestPipeline(pgPool, {
    streamId: CONTRACT_ID,
    bus,
    domainProcessor: createDomainProcessor(
      pgPool,
      notificationService,
      new PostgresDatabase(pgPool)
    ),
    // Update the state root incrementally from the batch delta — O(batch_size)
    // instead of the old O(table_size) full scan.  The root is written to
    // indexer_state after the domain transaction has already committed, so it
    // always reflects a fully-applied ledger.
    onCommit: (cursor, events): Promise<void> =>
      applyStateRootDelta(pgPool, cursor, events).then(
        () => {},
        (err) =>
          logger.warn({ err, ledgerSequence: cursor }, "Failed to publish state root after commit")
      ),
  });

  const processBatch: BatchProcessor = async (events) => {
    const result = await pipeline.processBatch(events.map(toIngestEvent));
    if (events.length > 0) healthMonitor.recordEvent();
    return result.cursor;
  };

  // Resume gap detection from the last committed cursor.
  const initialCursor = await pipeline.readCursor();

  // ── Backfill coordinator ──────────────────────────────────────────────────
  // Build a coordinator that wraps a resilient fetchRange so it can be reused
  // for both startup and mid-stream gap recovery.
  const { TokenBucket } = await import("./ratelimit");
  const { streamEvents: _se, ...streamModule } = await import("./stream");
  void streamModule; // used indirectly; suppress unused-import lint

  // We need fetchRange as an injectable RangeFetcher.  Rather than duplicating
  // the RPC logic we build a thin adapter that uses backfillStartupGap's
  // existing resilient fetcher via backfillStartupGap itself (one ledger at a
  // time) — but that would be slow.  Instead we expose a thin async wrapper
  // that constructs a one-shot TokenBucket and calls the RPC-resilient helper.
  const rateLimiter = new TokenBucket({ ratePerSec: cfg.rpcRateLimitPerSec ?? 10 });
  const rangeFetcher = async (fromLedger: number, toLedger: number, signal: AbortSignal) => {
    // Reuse backfillStartupGap to leverage its resilient fetch, treating the
    // range as a mini startup gap.
    const collected: import("./stream").RawEvent[] = [];
    await backfillStartupGap(
      {
        rpcUrl: STELLAR_RPC_URL,
        contractId: CONTRACT_ID,
        maxRetries: 6,
        backoffBaseMs: 250,
        backoffMaxMs: 10_000,
      },
      fromLedger,
      toLedger,
      async (events) => {
        collected.push(...events);
        return events[events.length - 1]?.ledger ?? fromLedger;
      },
      signal,
      { rateLimiter }
    );
    return collected;
  };

  const backfillCoordinator = new BackfillCoordinator(cfg.backfill, rangeFetcher);
  healthMonitor.setBackfillCoordinator(backfillCoordinator);

  // ── Startup gap detection ─────────────────────────────────────────────────
  // If the indexer was down, fetch the current ledger from RPC and backfill
  // any ledgers between processed_cursor and current before streaming live.
  if (initialCursor > 0) {
    try {
      const rpcRes = await fetch(STELLAR_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger", params: {} }),
      });
      if (rpcRes.ok) {
        const rpcJson = (await rpcRes.json()) as { result?: { sequence: number } };
        const currentLedger = rpcJson.result?.sequence ?? 0;
        if (currentLedger > initialCursor + 1) {
          const gapSize = currentLedger - initialCursor;
          console.log(
            `[indexer] Startup gap detected: processed=${initialCursor}, current=${currentLedger}, gapSize=${gapSize}. Backfilling…`
          );
          // Use the coordinator for startup gap recovery as well, so depth
          // limits and circuit breaker apply consistently.
          const recovered = await backfillCoordinator.recoverGap(
            initialCursor + 1,
            currentLedger,
            processBatch,
            abortController.signal
          );
          if (!recovered) {
            console.warn(
              "[indexer] Startup gap exceeds max backfill depth — starting live stream without full recovery."
            );
          }
        }
      }
    } catch (err) {
      logger.warn({ err }, "Startup gap check failed (continuing)");
    }
  }

  httpServer.listen(PORT, () => {
    console.log(`[indexer] HTTP + WS listening on :${PORT} (ws path /ws)`);
    healthMonitor.markStarted();
  });

  // Start score refresh service
  scoreRefreshService.start();

  // Start raw_events retention / partition management
  rawEventsRetentionManager.start();

  // Start gossip in the background with auto-replay support.
  startGossip(pgPool, abortController.signal, {
    rpcUrl: STELLAR_RPC_URL,
    contractId: CONTRACT_ID,
    processBatch,
  }).catch((err) => console.error("[gossip] Fatal error:", err));

  await streamEvents(
    {
      rpcUrl: STELLAR_RPC_URL,
      contractId: CONTRACT_ID,
      startLedger: START_LEDGER,
      initialCursor,
      ratePerSec: cfg.rpcRateLimitPerSec,
      minPollMs: cfg.minPollIntervalMs,
      maxPollMs: cfg.maxPollIntervalMs,
      circuitBreakerThreshold: cfg.streamCircuitBreakerThreshold,
      circuitBreakerProbeIntervalMs: cfg.streamCircuitBreakerProbeIntervalMs,
      backfillConfig: cfg.backfill,
      backfillCoordinator,
    },
    processBatch,
    abortController.signal
  );

  logger.info("Event stream ended, initiating shutdown");
  await gracefulShutdown.shutdown("STREAM_END");
}

main().catch((err) => {
  logger.error({ err }, "Fatal error");
  process.exit(1);
});
