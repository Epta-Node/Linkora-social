import express, { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { Pool as PgPool } from "pg";
import { Database } from "../db";
import { createProfilesRouter } from "./routes/profiles";
import { createPostsRouter } from "./routes/posts";
import { createFollowsRouter } from "./routes/follows";
import { createPoolsRouter } from "./routes/pools";
import { createStateRootRouter } from "./routes/stateRoot";
import { isFenced } from "../gossip";

// ── Rate-limit configuration (all values are env-overridable) ────────────────

const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? "60000", 10);
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX ?? "100", 10);

// ── Rate limiter middleware ───────────────────────────────────────────────────

const apiLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: "draft-7", // Sends RateLimit-* headers (RFC 9110 draft-7)
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    // Respect X-Forwarded-For when running behind a trusted reverse proxy.
    // In production, set `app.set("trust proxy", 1)` and ensure only your
    // load-balancer can set this header.
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string") {
      return forwarded.split(",")[0].trim();
    }
    return req.ip ?? "unknown";
  },
  handler: (req: Request, res: Response): void => {
    const retryAfter = Math.ceil(RATE_LIMIT_WINDOW_MS / 1000);
    res.status(429).set("Retry-After", String(retryAfter)).json({
      error: "Too many requests. Please retry after the indicated delay.",
      code: "RATE_LIMIT_EXCEEDED",
      retryAfterSeconds: retryAfter,
    });
  },
});

// ── App factory ───────────────────────────────────────────────────────────────

export function createApp(db: Database, pg?: PgPool): express.Application {
  const app = express();
  app.use(express.json());

  // Apply rate limiting to all /api routes.
  app.use("/api", apiLimiter);

  // Self-fencing middleware: stop serving when Byzantine majority detected.
  app.use("/api", (_req: Request, res: Response, next: NextFunction): void => {
    if (isFenced()) {
      res.status(503).json({ error: "Node self-fenced: Byzantine divergence detected", code: "SELF_FENCED" });
      return;
    }
    next();
  });

  // ── Resource routes ────────────────────────────────────────────────────────
  app.use("/api/profiles", createProfilesRouter(db));
  app.use("/api/posts", createPostsRouter(db));
  app.use("/api/follows", createFollowsRouter(db));
  app.use("/api/pools", createPoolsRouter(db));

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

  app.post(
    "/api/search/posts",
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

  // ── Error handler ─────────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction): void => {
    console.error(err);
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  });

  return app;
}

// Back-compat: export a pre-built app and limiter for tests that import them directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _stub = {} as any;
export const app = createApp(_stub);
export { apiLimiter };

// ── Server bootstrap (skipped when imported in tests) ────────────────────────

if (require.main === module) {
  const PORT = parseInt(process.env.PORT ?? "3001", 10);
  app.listen(PORT, () => {
    console.log(`Indexer API listening on port ${PORT}`);
    console.log(
      `Rate limit: ${RATE_LIMIT_MAX} requests per ${RATE_LIMIT_WINDOW_MS / 1000}s per IP`
    );
  });
}
