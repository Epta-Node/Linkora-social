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
import {
  requestIdMiddleware,
  requestLoggerMiddleware,
  errorHandler,
  notFoundHandler,
  validateContentType,
} from "./middleware";
import { messageAuthMiddleware } from "./middleware/auth";
import { rateLimitMiddleware } from "./middleware/rateLimit";
import { createHealthRouter } from "./routes/health";
import { logger } from "./logger";

// Load environment variables
dotenv.config();

const SERVICE_VERSION = process.env.npm_package_version ?? "0.1.0";
const COMMIT_SHA = process.env.COMMIT_SHA ?? "unknown";
const startTime = Date.now();

// Configuration
const config = {
  port: parseInt(process.env.PORT || "3001"),
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL || "postgresql://localhost:5432/linkora_dm_relay",
  corsOrigin: process.env.CORS_ORIGIN?.split(",") || ["http://localhost:3000"],
  messageTtlDays: parseInt(process.env.MESSAGE_TTL_DAYS || "7"),
  maxTimestampSkew: parseInt(process.env.MAX_TIMESTAMP_SKEW || "30"),
  stellarNetwork: process.env.STELLAR_NETWORK || "Testnet",
  idempotencyTtlHours: parseInt(process.env.IDEMPOTENCY_TTL_HOURS || "24"),
};

let started = false;
let startedAt: string | null = null;
let shuttingDown = false;

async function createApp() {
  const app = express();

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
      allowedHeaders: ["Content-Type", "Authorization"],
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

  // Custom middleware
  app.use(requestIdMiddleware);
  app.use(requestLoggerMiddleware);
  app.use(validateContentType);

  // Rate limiting
  app.use("/api", rateLimitMiddleware);
  const messageAuth = messageAuthMiddleware(authService);
  app.use("/api/messages", messageAuth);

  // API routes
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

  app.get("/health", async (_req, res) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    let dbStatus = "disconnected";
    try {
      await database.ping();
      dbStatus = "connected";
    } catch {
      /* */
    }
    const ok = dbStatus === "connected";
    res.status(ok ? 200 : 503).json({
      status: ok ? "ok" : "degraded",
      uptime,
      version: SERVICE_VERSION,
      commit: COMMIT_SHA,
      db: dbStatus,
    });
  });

  // Root info
  app.get("/", (_req, res) => {
    res.json({ service: "linkora-dm-relay", version: SERVICE_VERSION, status: "running" });
  });

  // Error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  // WebSocket server for real-time push to online recipients
  // Clients connect with ?address=<STELLAR_ADDRESS> to receive their messages.
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws: WebSocket, req) => {
    const url = new URL(req.url ?? "/", `http://localhost`);
    const address = url.searchParams.get("address") ?? "";
    if (address) {
      registerWsClient(address, ws);
      logger.info({ address }, "WebSocket client connected");
    } else {
      ws.close(1008, "Missing address query param");
    }
  });

  // Graceful shutdown
  const gracefulShutdown = async (signal: string) => {
    logger.info({ signal }, "Starting graceful shutdown...");
    shuttingDown = true;

    wss.close();
    cleanupService.stop();
    await database.close();

    logger.info("Graceful shutdown completed");
    process.exit(0);
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  return { app: httpServer, database, cleanupService };
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
