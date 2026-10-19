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
import { attachPoolMonitoring } from "./db-pool-monitor";
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
import { assertSchemaVersion } from "./schema-version";
import { streamHealth } from "./metrics";
import { postgresDomainCursorStore } from "./state";

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

// pool.on('error') is required: pg.Pool emits it when an idle client dies
// (e.g. Postgres restarts underneath it), and Node treats an 'error' event
// with no listener as fatal — this is what turned "Connection terminated
// unexpectedly" into a process crash rather than a logged, discarded client
// (issue #888).
attachPoolMonitoring(pgPool, { logger, serviceName: "indexer" });

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

  // #1523 — _ensureSchema has been removed.  The canonical schema definition
  // lives exclusively in services/indexer/migrations/.  Booting without
  // migrations applied now fails with an actionable error rather than
  // silently creating tables from a hand-maintained inline copy that can
  // drift from the migration files.
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
    if (events.length > 0) {
      healthMonitor.recordEvent();
      streamHealth.lastIngestedLedger = result.cursor;
    }
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
      domain: ["profiles", "posts", "follows", "tips"].includes(process.env.INDEXER_DOMAIN ?? "")
        ? (process.env.INDEXER_DOMAIN as "profiles" | "posts" | "follows" | "tips")
        : undefined,
      domainCursorStore: postgresDomainCursorStore(pgPool),
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
