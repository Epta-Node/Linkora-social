import express, { Request, Response, NextFunction } from "express";
import { Pool as PgPool } from "pg";
import { Database } from "../db";
import { logger } from "../logger";
import { rateLimit as apiLimiter, rateLimitWrite } from "../middleware/rateLimit";
import { requireStellarAuth } from "../middleware/stellarAuth";
import { createSearchRouter } from "./routes/search";
import { createProfilesRouter } from "./routes/profiles";
import { createPostsRouter } from "./routes/posts";
import { createFollowsRouter } from "./routes/follows";
import { createPoolsRouter } from "./routes/pools";
import { createStateRootRouter } from "./routes/stateRoot";
import { createNotificationsRouter } from "./routes/notifications";
import { createGovernanceRouter } from "./routes/governance";
import { createUsersRouter } from "./routes/users";
import { isFenced } from "../gossip";
import { getBackfillState } from "../stream";
import {
  defaultNotificationService,
  NotificationService,
  PostgresDeviceTokenStore,
} from "../notifications/service";
import { PostgresDatabase } from "../postgres-db";

// ── App factory ───────────────────────────────────────────────────────────────

export function createApp(db: Database, pg?: PgPool): express.Application {
  const app = express();
  app.use(express.json());

  const startTime = Date.now();
  const version = process.env.npm_package_version ?? "0.1.0";
  const commit = process.env.COMMIT_SHA ?? "unknown";

  // ── Health endpoints ───────────────────────────────────────────────────────

  app.get("/health", async (_req: Request, res: Response): Promise<void> => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const backfill = getBackfillState();

    // DB check
    let dbStatus = "disconnected";
    try {
      if (pg) {
        await pg.query("SELECT 1");
        dbStatus = "connected";
      }
    } catch {
      /* keep disconnected */
    }

    // RPC check
    let rpcStatus = "unreachable";
    try {
      const rpcUrl = process.env.STELLAR_RPC_URL;
      if (rpcUrl) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 3000);
        await fetch(`${rpcUrl}`, {
          method: "POST",
          signal: ctrl.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger", params: [] }),
        }).finally(() => clearTimeout(t));
        rpcStatus = "reachable";
      }
    } catch {
      /* keep unreachable */
    }

    const ok = dbStatus === "connected" && rpcStatus === "reachable";
    res.status(ok ? 200 : 503).json({
      status: ok ? "ok" : "degraded",
      uptime,
      version,
      commit,
      db: dbStatus,
      rpc: rpcStatus,
      backfill: backfill.active
        ? { active: true, fromLedger: backfill.fromLedger, toLedger: backfill.toLedger }
        : { active: false },
    });
  });

  // Readiness: ready to serve traffic (DB + RPC up)
  app.get("/health/ready", async (_req: Request, res: Response): Promise<void> => {
    try {
      if (pg) await pg.query("SELECT 1");
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "not ready", reason: "db unavailable" });
    }
  });

  // Liveness: process is alive
  app.get("/health/live", (_req: Request, res: Response): void => {
    res.json({ status: "live" });
  });

  // Apply rate limiting to all /api routes.
  app.use("/api", apiLimiter);

  // Self-fencing middleware: stop serving when Byzantine majority detected.
  app.use("/api", (_req: Request, res: Response, next: NextFunction): void => {
    if (isFenced()) {
      res
        .status(503)
        .json({ error: "Node self-fenced: Byzantine divergence detected", code: "SELF_FENCED" });
      return;
    }
    next();
  });

  // ── Resource routes ────────────────────────────────────────────────────────
  app.use("/api/search", createSearchRouter(db));
  app.use("/api/profiles", createProfilesRouter(db));
  app.use("/api/posts", createPostsRouter(db));
  app.use("/api/follows", createFollowsRouter(db));
  app.use("/api/pools", createPoolsRouter(db));
  app.use("/api/governance", createGovernanceRouter(db));
  app.use("/api/users", createUsersRouter(db));

  const notificationService = pg
    ? new NotificationService({ deviceTokenStore: new PostgresDeviceTokenStore(pg) })
    : defaultNotificationService;
  app.use("/api/notifications", createNotificationsRouter(notificationService));

  // State root endpoint (requires pg pool).
  if (pg) {
    app.use("/api/state-root", createStateRootRouter(pg));
  }

  // ── DM relay endpoint (write — requires Stellar auth + write rate limit) ───

  interface MessagePayload {
    recipientAddress: string;
    encryptedContent: string;
  }

  app.post(
    "/api/messages",
    requireStellarAuth,
    rateLimitWrite,
    (req: Request, res: Response): void => {
      const body = req.body as Partial<MessagePayload>;

      if (typeof body.recipientAddress !== "string" || body.recipientAddress.trim() === "") {
        res.status(400).json({ error: "recipientAddress is required", code: "INVALID_PAYLOAD" });
        return;
      }

      if (typeof body.encryptedContent !== "string" || body.encryptedContent.trim() === "") {
        res.status(400).json({ error: "encryptedContent is required", code: "INVALID_PAYLOAD" });
        return;
      }

      // TODO: persist and relay DM via Stellar contract.
      res.status(202).json({
        status: "accepted",
        from: req.context?.stellarAddress,
        to: body.recipientAddress,
      });
    }
  );

  // ── Error handler ─────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, req: Request, res: Response, _next: NextFunction): void => {
    logger.error(
      {
        requestId: req.context?.requestId,
        error: err.message,
        stack: err.stack,
      },
      "Unhandled error"
    );
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  });

  return app;
}

// ── Server bootstrap (skipped when imported in tests) ────────────────────────

if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Pool } = require("pg") as typeof import("pg");
  const DATABASE_URL = process.env.DATABASE_URL ?? "";
  const _stub = new Pool({ connectionString: DATABASE_URL }) as unknown as Database;
  const PORT = parseInt(process.env.PORT ?? "3001", 10);
  const databaseUrl = process.env.DATABASE_URL;
  const pg = databaseUrl ? new PgPool({ connectionString: databaseUrl }) : undefined;
  const apiApp = pg ? createApp(new PostgresDatabase(pg), pg) : createApp(_stub);

  apiApp.listen(PORT, () => {
    console.log(`Indexer API listening on port ${PORT}`);
    console.log(`Rate limit enabled: read limit is 60 RPM, write limit is 10 RPM`);
  });
}
