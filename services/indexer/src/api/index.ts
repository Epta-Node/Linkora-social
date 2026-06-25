import express, { Request, Response, NextFunction } from "express";
import { Pool as PgPool } from "pg";
import { Database } from "../db";
import { logger } from "../logger";
import { rateLimitRead, rateLimitWrite } from "../middleware/rateLimit";
import { requireStellarAuth } from "../middleware/stellarAuth";
import { createProfilesRouter } from "./routes/profiles";
import { createPostsRouter } from "./routes/posts";
import { createFollowsRouter } from "./routes/follows";
import { createPoolsRouter } from "./routes/pools";
import { createStateRootRouter } from "./routes/stateRoot";
import { createNotificationsRouter } from "./routes/notifications";
import { isFenced } from "../gossip";
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

  app.get("/health", (_req: Request, res: Response): void => {
    res.json({ status: "ok" });
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
  app.use("/api/profiles", createProfilesRouter(db));
  app.use("/api/posts", createPostsRouter(db));
  app.use("/api/follows", createFollowsRouter(db));
  app.use("/api/pools", createPoolsRouter(db));

  const notificationService = pg
    ? new NotificationService({ deviceTokenStore: new PostgresDeviceTokenStore(pg) })
    : defaultNotificationService;
  app.use("/api/notifications", createNotificationsRouter(notificationService));

  // State root endpoint (requires pg pool).
  if (pg) {
    app.use("/api/state-root", createStateRootRouter(pg));
  }

  // ── Search endpoint ──────────────────────────────────────────────────────────

  interface SearchQuery {
    query: string;
    limit?: number;
    offset?: number;
  }

  interface Post {
    id: number;
    author: string;
    content: string;
    tip_total: string;
    timestamp: number;
  }

  interface SearchResponse {
    posts: Post[];
    total: number;
    has_more: boolean;
  }

  interface ErrorResponse {
    error: string;
    code: string;
  }

  const MAX_LIMIT = 100;
  const DEFAULT_LIMIT = 20;
  const DEFAULT_OFFSET = 0;

  // Override: search uses read-rate-limit even though it's POST
  app.post(
    "/api/search/posts",
    rateLimitRead,
    (req: Request, res: Response<SearchResponse | ErrorResponse>): void => {
      const body = req.body as Partial<SearchQuery>;

      if (
        body.query === undefined ||
        body.query === null ||
        typeof body.query !== "string" ||
        body.query.trim() === ""
      ) {
        res.status(400).json({ error: "query is required", code: "INVALID_QUERY" });
        return;
      }

      const limit = body.limit !== undefined ? Number(body.limit) : DEFAULT_LIMIT;
      const offset = body.offset !== undefined ? Number(body.offset) : DEFAULT_OFFSET;

      if (!Number.isInteger(limit) || limit < 1) {
        res.status(400).json({ error: "limit must be a positive integer", code: "INVALID_QUERY" });
        return;
      }

      if (limit > MAX_LIMIT) {
        res.status(400).json({
          error: `limit cannot exceed ${MAX_LIMIT}`,
          code: "LIMIT_EXCEEDED",
        });
        return;
      }

      if (!Number.isInteger(offset) || offset < 0) {
        res
          .status(400)
          .json({ error: "offset must be a non-negative integer", code: "INVALID_QUERY" });
        return;
      }

      // TODO: integrate with the search database.
      res.json({ posts: [], total: 0, has_more: false });
    }
  );

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
  const apiApp = pg ? createApp(new PostgresDatabase(pg), pg) : app;

  apiApp.listen(PORT, () => {
    console.log(`Indexer API listening on port ${PORT}`);
    console.log(
      `Rate limit: ${RATE_LIMIT_MAX} requests per ${RATE_LIMIT_WINDOW_MS / 1000}s per IP`
    );
  });
}
