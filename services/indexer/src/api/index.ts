import express, { Request, Response, NextFunction } from "express";
import { Pool as PgPool } from "pg";
import { Database } from "../db";
import { logger, requestLoggingMiddleware } from "../logger";
import { rateLimit, rateLimitWrite } from "../middleware/rateLimit";
import { requireStellarAuth } from "../middleware/stellarAuth";
import { validateBody } from "../middleware/validate";
import { z } from "zod";
import { createProfilesRouter } from "./routes/profiles";
import { createPostsRouter } from "./routes/posts";
import { createFollowsRouter } from "./routes/follows";
import { createPoolsRouter } from "./routes/pools";
import { createStateRootRouter } from "./routes/stateRoot";
import { createNotificationsRouter } from "./routes/notifications";
import { createGovernanceRouter } from "./routes/governance";
import { createUsersRouter } from "./routes/users";
import { createFeedRouter } from "./routes/feed";
import { isFenced } from "../gossip";
import { getBackfillState } from "../stream";
import {
  defaultNotificationService,
  NotificationService,
  PostgresDeviceTokenStore,
} from "../notifications/service";
import { PostgresDatabase } from "../postgres-db";
import { HealthMonitor } from "../services/health-monitor";

function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const origin = req.headers.origin;
  if (origin) {
    if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
}

// ── App factory ───────────────────────────────────────────────────────────────

export function createApp(
  db: Database,
  pg?: PgPool,
  healthMonitor?: HealthMonitor
): express.Application {
  const app = express();
  app.use(express.json());
  app.use(corsMiddleware);
  app.use(requestLoggingMiddleware);

  const startTime = Date.now();
  const version = process.env.npm_package_version ?? "0.1.0";
  const commit = process.env.COMMIT_SHA ?? "unknown";
  const monitor =
    healthMonitor ?? (pg ? new HealthMonitor(pg, process.env.STELLAR_RPC_URL ?? "") : undefined);

  app.get("/health", async (_req: Request, res: Response): Promise<void> => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const backfill = getBackfillState();
    const readiness = monitor
      ? await monitor.checkReadiness()
      : { ready: false, checks: undefined };

    res.status(readiness.ready ? 200 : 503).json({
      status: readiness.ready ? "ok" : "degraded",
      uptime,
      version,
      commit,
      checks: readiness.checks,
      backfill: backfill.active
        ? { active: true, fromLedger: backfill.fromLedger, toLedger: backfill.toLedger }
        : { active: false },
    });
  });

  // Liveness probe — always 200 while the process is running.
  app.get("/health/live", (_req: Request, res: Response): void => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    res.json({ status: "alive", uptime });
  });

  // Readiness probe — 200 when DB, Stellar RPC, and event stream are healthy.
  app.get("/health/ready", async (_req: Request, res: Response): Promise<void> => {
    if (!monitor) {
      res.status(503).json({ status: "not_ready", reason: "health monitor unavailable" });
      return;
    }
    const readiness = await monitor.checkReadiness();
    res.status(readiness.ready ? 200 : 503).json({
      status: readiness.ready ? "ready" : "not_ready",
      checks: readiness.checks,
    });
  });

  // Startup probe — 200 only once initial bootstrap has completed.
  app.get("/health/startup", (_req: Request, res: Response): void => {
    if (monitor?.isStarted()) {
      res.json({ status: "started", startedAt: monitor.getStartedAt() });
    } else {
      res.status(503).json({ status: "starting" });
    }
  });

  app.use("/api", rateLimit);

  app.use("/api", (_req: Request, res: Response, next: NextFunction): void => {
    if (isFenced()) {
      res.status(503).json({
        error: {
          code: "SELF_FENCED",
          message: "Node self-fenced: Byzantine divergence detected",
          requestId: req.context?.requestId,
        },
      });
      return;
    }
    next();
  });

  app.use("/api/profiles", createProfilesRouter(db));
  app.use("/api/posts", createPostsRouter(db));
  app.use("/api/follows", createFollowsRouter(db));
  app.use("/api/pools", createPoolsRouter(db));
  app.use("/api/governance", createGovernanceRouter(db));
  app.use("/api/users", createUsersRouter(db));

  if (pg) {
    app.use("/api/feed", createFeedRouter(pg));
  }

  const notificationService = pg
    ? new NotificationService({ deviceTokenStore: new PostgresDeviceTokenStore(pg) })
    : defaultNotificationService;
  app.use("/api/notifications", createNotificationsRouter(notificationService));

  if (pg) {
    app.use("/api/state-root", createStateRootRouter(pg));
  }

  const dmMessageSchema = z.object({
    recipientAddress: z.string().min(1, "recipientAddress is required"),
    encryptedContent: z.string().min(1, "encryptedContent is required"),
  });

  app.post(
    "/api/messages",
    requireStellarAuth,
    rateLimitWrite,
    validateBody(dmMessageSchema),
    (req: Request, res: Response): void => {
      const { recipientAddress } = req.body as z.infer<typeof dmMessageSchema>;

      res.status(202).json({
        status: "accepted",
        from: req.context?.stellarAddress,
        to: recipientAddress,
      });
    }
  );

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

    if (typeof (err as any).statusCode === "number") {
      const appErr = err as any;
      res.status(appErr.statusCode).json({
        error: {
          code: appErr.code ?? "INTERNAL_ERROR",
          message: appErr.message,
          details: appErr.details,
          requestId: req.context?.requestId,
        },
      });
      return;
    }

    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        requestId: req.context?.requestId,
      },
    });
  });

  return app;
}

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
