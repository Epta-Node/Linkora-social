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
 * Environment variables (all required unless noted):
 *   DATABASE_URL            - PostgreSQL connection string
 *   STELLAR_RPC_URL         - Soroban RPC endpoint
 *   CONTRACT_ID             - Bech32 contract address
 *   START_LEDGER            - Ledger sequence to start streaming from
 *   PORT                    - (optional) HTTP/WS port, default 3000
 *   RPC_RATE_LIMIT_PER_SEC  - (optional) RPC rate cap, default 10
 *   MIN_POLL_INTERVAL_MS    - (optional) adaptive poll floor, default 100
 *   MAX_POLL_INTERVAL_MS    - (optional) adaptive poll ceiling, default 5000
 */

import http from "http";
import { Pool } from "pg";
import { streamEvents, RawEvent, BatchProcessor } from "./stream";
import { IngestPipeline, IngestEvent } from "./pipeline";
import { bus } from "./bus";
import { attachWebSocketServer } from "./ws";

// ── Config ────────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalIntEnv(name: string): number | undefined {
  const v = process.env[name];
  return v ? parseInt(v, 10) : undefined;
}

const DATABASE_URL = requireEnv("DATABASE_URL");
const STELLAR_RPC_URL = requireEnv("STELLAR_RPC_URL");
const CONTRACT_ID = requireEnv("CONTRACT_ID");
const START_LEDGER = parseInt(requireEnv("START_LEDGER"), 10);
const PORT = parseInt(process.env.PORT ?? "3000", 10);

// ── Database ──────────────────────────────────────────────────────────────────

const pgPool = new Pool({ connectionString: DATABASE_URL });

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
    CREATE TABLE IF NOT EXISTS indexer_state (
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

const httpServer = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

const wsHandle = attachWebSocketServer(httpServer, bus, { path: "/ws" });

// ── Graceful shutdown ─────────────────────────────────────────────────────────

const abortController = new AbortController();
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[indexer] Received ${signal}, shutting down…`);
  abortController.abort();
  await wsHandle.close();
  httpServer.close();
  await pgPool.end();
  console.log("[indexer] Shutdown complete.");
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("[indexer] Starting Linkora indexer");
  console.log(`[indexer] RPC:        ${STELLAR_RPC_URL}`);
  console.log(`[indexer] Contract:   ${CONTRACT_ID}`);
  console.log(`[indexer] From ledger: ${START_LEDGER}`);

  await ensureSchema();

  const pipeline = new IngestPipeline(pgPool, {
    streamId: CONTRACT_ID,
    bus,
    // domainProcessor: wire decoded handlers here. Until contract XDR decoding
    // is implemented, events are staged + fanned out without domain projection.
  });

  const processBatch: BatchProcessor = async (events) => {
    const result = await pipeline.processBatch(events.map(toIngestEvent));
    return result.cursor;
  };

  // Resume gap detection from the last committed cursor.
  const initialCursor = await pipeline.readCursor();

  httpServer.listen(PORT, () => {
    console.log(`[indexer] HTTP + WS listening on :${PORT} (ws path /ws)`);
  });

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
      ratePerSec: optionalIntEnv("RPC_RATE_LIMIT_PER_SEC"),
      minPollMs: optionalIntEnv("MIN_POLL_INTERVAL_MS"),
      maxPollMs: optionalIntEnv("MAX_POLL_INTERVAL_MS"),
    },
    processBatch,
    abortController.signal
  );

  await wsHandle.close();
  httpServer.close();
  await pgPool.end();
  console.log("[indexer] Shutdown complete.");
}

main().catch((err) => {
  console.error("[indexer] Fatal error:", err);
  process.exit(1);
});
