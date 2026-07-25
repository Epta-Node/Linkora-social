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
import { Pool } from "pg";
import { streamEvents, backfillStartupGap, RawEvent, BatchProcessor } from "./stream";
import { IngestPipeline, IngestEvent } from "./pipeline";
import { bus } from "./bus";
import { attachWebSocketServer } from "./ws";
import { startGossip } from "./gossip";
import { attachNotificationDispatcher } from "./notifications/events";
import { NotificationService, PostgresDeviceTokenStore } from "./notifications/service";
import { createApp } from "./api";
import { createDomainProcessor } from "./domain-processor";
import { PostgresDatabase } from "./postgres-db";
import { ScoreRefreshService } from "./score-refresh";
import { HealthMonitor } from "./services/health-monitor";
import { BackfillCoordinator } from "./services/backfill-coordinator";
import { loadConfig } from "./config";

// ── Config ────────────────────────────────────────────────────────────────────

const cfg = loadConfig();

const DATABASE_URL = cfg.databaseUrl;
const STELLAR_RPC_URL = cfg.stellarRpcUrl;
const CONTRACT_ID = cfg.contractId;
const START_LEDGER = cfg.startLedger;
const PORT = cfg.port;
const SCORE_REFRESH_INTERVAL_MINUTES = cfg.scoreRefreshIntervalMinutes;

// ── Database ──────────────────────────────────────────────────────────────────

const pgPool = new Pool({ connectionString: DATABASE_URL });
const notificationService = new NotificationService({
  deviceTokenStore: new PostgresDeviceTokenStore(pgPool),
  pool: pgPool,
});
const scoreRefreshService = new ScoreRefreshService(pgPool, SCORE_REFRESH_INTERVAL_MINUTES);

/**
 * Idempotently ensure the staging table and cursor exist. Mirrors
 * migrations/006_raw_events.sql for dev/test environments that boot without a
 * separate migration step.
 */
async function ensureSchema(): Promise<void> {
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
    )
  `);
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

// ── HTTP + WebSocket server ──────────────────────────────────────────────────

const healthMonitor = new HealthMonitor(pgPool, STELLAR_RPC_URL);
const apiApp = createApp(new PostgresDatabase(pgPool), pgPool, healthMonitor);
const httpServer = http.createServer(apiApp);

const wsHandle = attachWebSocketServer(httpServer, bus, { path: "/ws" });
const detachNotificationDispatcher = attachNotificationDispatcher(bus, pgPool, notificationService);

// ── Lifecycle control ────────────────────────────────────────────────────────

const abortController = new AbortController();
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[indexer] Received ${signal}, shutting down…`);
  healthMonitor.markShuttingDown();
  abortController.abort();
  scoreRefreshService.stop();
  detachNotificationDispatcher();
  await wsHandle.close();
  httpServer.close();
  await pgPool.end();
  console.log("[indexer] Shutdown complete.");
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// ── Core runner ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("[indexer] Starting Linkora indexer");
  console.log(`[indexer] RPC:        ${STELLAR_RPC_URL}`);
  console.log(`[indexer] Contract:   ${CONTRACT_ID}`);
  console.log(`[indexer] From ledger: ${START_LEDGER}`);

  await ensureSchema();

  const pipeline = new IngestPipeline(pgPool, {
    streamId: CONTRACT_ID,
    bus,
    domainProcessor: createDomainProcessor(
      pgPool,
      notificationService,
      new PostgresDatabase(pgPool)
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
      console.warn("[indexer] Startup gap check failed (continuing):", err);
    }
  }

  httpServer.listen(PORT, () => {
    console.log(`[indexer] HTTP + WS listening on :${PORT} (ws path /ws)`);
    healthMonitor.markStarted();
  });

  // Start score refresh service
  scoreRefreshService.start();

  // Start gossip in the background.
  startGossip(pgPool, abortController.signal).catch((err) =>
    console.error("[gossip] Fatal error:", err)
  );

  await streamEvents(
    {
      rpcUrl: STELLAR_RPC_URL,
      contractId: CONTRACT_ID,
      startLedger: START_LEDGER,
      initialCursor,
      ratePerSec: cfg.rpcRateLimitPerSec,
      minPollMs: cfg.minPollIntervalMs,
      maxPollMs: cfg.maxPollIntervalMs,
      backfillConfig: cfg.backfill,
      backfillCoordinator,
    },
    processBatch,
    abortController.signal
  );

  await wsHandle.close();
  detachNotificationDispatcher();
  httpServer.close();
  await pgPool.end();
  console.log("[indexer] Shutdown complete.");
}

main().catch((err) => {
  console.error("[indexer] Fatal error:", err);
  process.exit(1);
});
