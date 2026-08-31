/**
 * DM Relay Server - Transport-only encrypted message relay for Linkora.
 *
 * This server never has access to plaintext message content. All messages
 * are end-to-end encrypted using X25519 + ChaCha20-Poly1305.
 */

import http from "http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import { WebSocketServer, WebSocket } from "ws";
import { Database } from "./database";
import { AuthService } from "./auth";
import { CleanupService } from "./cleanup";
import { createRouter, registerWsClient } from "./routes";
import { loadConfig } from "./config";
import {
  requestIdMiddleware,
  requestLoggerMiddleware,
  errorHandler,
  notFoundHandler,
  validateContentType,
} from "./middleware";
import {
  rateLimitMiddleware,
  initRateLimiters,
  closeRateLimiters,
  isWsIpRateLimited,
} from "./middleware/rateLimit";
import { createHealthRouter } from "./routes/health";
import { logger } from "./logger";
import { InflightCounter } from "./inflight-counter";

export { InflightCounter };

// Load environment variables
dotenv.config();

const SERVICE_VERSION = process.env.npm_package_version ?? "0.1.0";
const startTime = Date.now();

// Configuration
const config = loadConfig();

let started = false;
let startedAt: string | null = null;
let shuttingDown = false;

/**
 * How long (ms) to wait for in-flight WebSocket DB writes to finish before
 * forcing a pool close.  Defaults to 30 000 ms; override with the
 * SHUTDOWN_DRAIN_TIMEOUT_MS environment variable.
 */
const SHUTDOWN_DRAIN_TIMEOUT_MS = (() => {
  const raw = process.env.SHUTDOWN_DRAIN_TIMEOUT_MS;
  if (!raw) return 30_000;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? 30_000 : parsed;
})();

async function createApp() {
  const app = express();
  app.set("trust proxy", 1); // trust first proxy

  // Security middleware
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );

  // CORS configuration
  app.use(
    cors({
      origin: config.corsOrigin,
      methods: ["GET", "POST"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Idempotency-Key"],
      credentials: false, // No cookies/credentials needed
    })
  );

  // Body parsing
  app.use(express.json({ limit: "1mb" })); // Limit request size

  // Initialize database
  logger.info({ service: "dm-relay" }, "Connecting to database...");
  const database = new Database(config.databaseUrl);
  await database.init();

  // Initialize auth service
  const authService = new AuthService(config.maxTimestampSkew, config.stellarNetwork);

  // Initialize cleanup service
  const cleanupService = new CleanupService(
    database,
    config.messageTtlDays,
    config.idempotencyTtlHours
  );
  cleanupService.start();

  // Initialise rate limiters (upgrades to Redis store when REDIS_URL is set).
  await initRateLimiters();

  // Custom middleware
  app.use(requestIdMiddleware);
  app.use(requestLoggerMiddleware);
  app.use(validateContentType);

  // Rate limiting
  app.use("/api", rateLimitMiddleware);

  // API routes. Auth (message-signature for POST /messages, address-ownership
  // for GET /messages/:address) is applied per-route inside createRouter,
  // scoped to exactly the routes that need it — not via a global path-matching
  // middleware that could over-apply to unrelated routes such as health checks.
  app.use("/api", createRouter(database, authService));

  // ── Health endpoints ───────────────────────────────────────────────────────
  // Liveness / readiness / startup probes — see routes/health.ts for details.

  app.use(
    createHealthRouter({
      db: database,
      startTime,
      isStarted: () => started,
      startedAt: () => startedAt,
      isShuttingDown: () => shuttingDown,
    })
  );

  // Root info
  app.get("/", (_req, res) => {
    res.json({ service: "linkora-dm-relay", version: SERVICE_VERSION, status: "running" });
  });

  // Error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  // WebSocket server for real-time push to online recipients
  // Clients connect with ?address=<STELLAR_ADDRESS>&timestamp=<TS>&signature=<SIG>
  // to authenticate and receive their messages.
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
    maxPayload: config.maxMessageBytes,
  });

  // Counter for DB writes that are currently executing on behalf of a
  // WebSocket connection.  The shutdown handler drains this before closing
  // the pool so no write is abandoned mid-flight.
  const inflightCounter = new InflightCounter();

  const MAX_WS_CONNECTIONS_PER_ADDRESS = 5;
  const wsConnectionCounts = new Map<string, number>();

  function getWsClientIp(req: http.IncomingMessage): string {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string") return xff.split(",")[0].trim();
    return req.socket.remoteAddress || "unknown";
  }

  // The handler is async because the rate-limit check now round-trips to
  // Redis. `ws` never sees the rejection of an async listener, so anything
  // that throws past the checks below would surface as an unhandled rejection
  // and take the process down — hence the outer catch.
  wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
    handleWsConnection(ws, req).catch((err) => {
      logger.error({ err, ip: getWsClientIp(req) }, "WebSocket connection handler failed");
      ws.close(1011, "Internal error");
    });
  });

  async function handleWsConnection(ws: WebSocket, req: http.IncomingMessage): Promise<void> {
    const clientIp = getWsClientIp(req);
    const url = new URL(req.url ?? "/", "http://localhost");
    const address = url.searchParams.get("address") ?? "";
    const timestampStr = url.searchParams.get("timestamp") ?? "";
    const signature = url.searchParams.get("signature") ?? "";

    // Rate limit per IP. Backed by the same Redis store as the HTTP limiters,
    // so the cap applies to the deployment as a whole rather than per replica.
    if (await isWsIpRateLimited(clientIp)) {
      logger.warn({ ip: clientIp }, "WebSocket rate limit exceeded");
      ws.close(1008, "Rate limit exceeded");
      return;
    }

    // Validate required auth params
    if (!address || !timestampStr || !signature) {
      ws.close(1008, "Missing required query params: address, timestamp, signature");
      return;
    }

    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp)) {
      ws.close(1008, "Invalid timestamp");
      return;
    }

    // Verify address ownership
    try {
      authService.verifyAddressOwnership(address, timestamp, signature);
    } catch (err) {
      logger.warn({ ip: clientIp, address }, "WebSocket auth failed");
      ws.close(1008, "Authentication failed");
      return;
    }

    // Enforce max connections per address
    const currentCount = wsConnectionCounts.get(address) ?? 0;
    if (currentCount >= MAX_WS_CONNECTIONS_PER_ADDRESS) {
      logger.warn({ address, count: currentCount }, "WebSocket connection limit reached");
      ws.close(1008, "Maximum connections per address reached");
      return;
    }

    wsConnectionCounts.set(address, currentCount + 1);
    registerWsClient(address, ws, inflightCounter, config.maxMessageBytes);

    logger.info(
      { address, ip: clientIp, connections: currentCount + 1 },
      "WebSocket client connected (authenticated)"
    );

    ws.on("close", () => {
      const count = wsConnectionCounts.get(address) ?? 1;
      if (count <= 1) {
        wsConnectionCounts.delete(address);
      } else {
        wsConnectionCounts.set(address, count - 1);
      }
      logger.info({ address, ip: clientIp }, "WebSocket client disconnected");
    });
  }

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  //
  // Shutdown sequence:
  //   1. Stop accepting new HTTP requests (httpServer.close).
  //   2. Stop accepting new WebSocket connections (wss.close with callback).
  //   3. Wait for the wss.close callback, which fires once all existing WS
  //      connections have been terminated.
  //   4. Drain any in-flight DB writes that were already in progress when
  //      shutdown was triggered (bounded by SHUTDOWN_DRAIN_TIMEOUT_MS).
  //   5. Tear down ancillary services and close the DB pool.
  //
  // A hard-kill timer (drain timeout + 5 s buffer) is armed immediately so
  // the process always exits even if something hangs.
  const gracefulShutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Starting graceful shutdown...");
    shuttingDown = true;

    // Hard-kill safety net — fires after drain window + 5 s buffer.
    const forceExitTimer = setTimeout(() => {
      logger.error(
        { drainTimeoutMs: SHUTDOWN_DRAIN_TIMEOUT_MS },
        "Shutdown timed out, forcing exit"
      );
      process.exit(1);
    }, SHUTDOWN_DRAIN_TIMEOUT_MS + 5_000);
    // Do not let this timer keep the event loop alive if everything drains
    // cleanly before it fires.
    forceExitTimer.unref();

    // 1. Stop accepting new HTTP requests.
    httpServer.close();

    // 2 & 3. Stop accepting new WebSocket connections and wait for existing
    //        connections to be fully closed before proceeding.
    await new Promise<void>((resolve) => {
      wss.close(() => {
        logger.info("WebSocket server drained");
        resolve();
      });
    });

    // 4. Wait for any DB operations that were already in flight when the WS
    //    connections closed to finish, capped by the drain timeout.
    if (inflightCounter.value > 0) {
      logger.info(
        { inflight: inflightCounter.value },
        "Waiting for in-flight DB operations to complete..."
      );
      await Promise.race([
        inflightCounter.drain(),
        new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_DRAIN_TIMEOUT_MS)),
      ]);
      if (inflightCounter.value > 0) {
        logger.warn(
          { inflight: inflightCounter.value },
          "Drain timeout reached; some in-flight writes may have been abandoned"
        );
      } else {
        logger.info("All in-flight DB operations completed");
      }
    }

    // 5. Tear down ancillary services, then close the pool.
    cleanupService.stop();
    await closeRateLimiters();
    await database.close();

    logger.info("Graceful shutdown completed");
    process.exit(0);
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  return { app: httpServer, database, cleanupService, inflightCounter };
}

async function startServer() {
  try {
    const { app: httpServer } = await createApp();

    const server = httpServer.listen(config.port, () => {
      logger.info(
        { port: config.port, env: config.nodeEnv, ttlDays: config.messageTtlDays },
        "DM Relay service started"
      );
      started = true;
      startedAt = new Date().toISOString();
    });

    return server;
  } catch (error) {
    logger.error({ err: error }, "Failed to start server");
    process.exit(1);
  }
}

// Start server if this file is run directly
if (require.main === module) {
  startServer();
}

export { createApp, startServer };
