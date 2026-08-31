/**
 * Kubernetes-ready health endpoints: liveness, readiness, and startup probes.
 *
 * - /health          aggregate status, including degraded modes
 * - /health/live     always 200 while the process is running
 * - /health/ready    200 when the database is reachable and the relay isn't shutting down
 * - /health/startup  200 once initial bootstrap (DB init) has completed
 *
 * `rateLimiter` reports which store backs the HTTP and WebSocket limiters.
 * `shared: false` means limits are enforced per replica, so a scaled
 * deployment's effective limit is `limit × replicaCount`. That marks the
 * service degraded on /health but does not fail readiness — a single-replica
 * deployment is still correct, and pulling the pod from the load balancer
 * would turn a weak limit into an outage.
 */

import { Router } from "express";
import type { RateLimitStoreStatus } from "@linkora/types/src/rate-limit-env";
import { Database } from "../database";
import { getRateLimitStoreStatus } from "../middleware/rateLimit";

interface DependencyCheck {
  status: "up" | "down";
  latencyMs: number;
}

export interface HealthState {
  db: Database;
  startTime: number;
  isStarted: () => boolean;
  startedAt: () => string | null;
  isShuttingDown: () => boolean;
  /** Injectable for tests; defaults to the module-level limiter singleton. */
  rateLimitStatus?: () => RateLimitStoreStatus;
}

async function checkDatabase(db: Database): Promise<DependencyCheck> {
  const start = Date.now();
  try {
    await db.ping();
    return { status: "up", latencyMs: Date.now() - start };
  } catch {
    return { status: "down", latencyMs: Date.now() - start };
  }
}

export function createHealthRouter(state: HealthState): Router {
  const router = Router();
  const rateLimitStatus = state.rateLimitStatus ?? getRateLimitStoreStatus;

  router.get("/health", async (_req, res) => {
    const uptime = Math.floor((Date.now() - state.startTime) / 1000);
    const rateLimiter = rateLimitStatus();

    if (state.isShuttingDown()) {
      res.status(503).json({
        status: "degraded",
        uptime,
        rateLimiter,
        checks: { database: { status: "down", latencyMs: 0 } },
      });
      return;
    }

    const database = await checkDatabase(state.db);
    const healthy = database.status === "up";
    const status = healthy ? (rateLimiter.shared ? "ok" : "degraded") : "degraded";

    res.status(healthy ? 200 : 503).json({
      status,
      uptime,
      rateLimiter,
      checks: { database },
    });
  });

  router.get("/health/live", (_req, res) => {
    const uptime = Math.floor((Date.now() - state.startTime) / 1000);
    res.json({ status: "alive", uptime });
  });

  router.get("/health/ready", async (_req, res) => {
    const rateLimiter = rateLimitStatus();

    if (state.isShuttingDown()) {
      res.status(503).json({
        status: "not_ready",
        degraded: !rateLimiter.shared,
        checks: { database: { status: "down", latencyMs: 0 }, rateLimiter },
      });
      return;
    }

    const database = await checkDatabase(state.db);
    const ready = database.status === "up";
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      degraded: !rateLimiter.shared,
      checks: { database, rateLimiter },
    });
  });

  router.get("/health/startup", (_req, res) => {
    if (state.isStarted()) {
      res.json({ status: "started", startedAt: state.startedAt() });
    } else {
      res.status(503).json({ status: "starting" });
    }
  });

  return router;
}
