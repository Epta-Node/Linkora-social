/**
 * Kubernetes-ready health endpoints: liveness, readiness, and startup probes.
 *
 * - /health/live    always 200 while the process is running
 * - /health/ready    200 when the database is reachable and the relay isn't shutting down
 * - /health/startup  200 once initial bootstrap (DB init) has completed
 */

import { Router } from "express";
import { Database } from "../database";

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

  router.get("/health/live", (_req, res) => {
    const uptime = Math.floor((Date.now() - state.startTime) / 1000);
    res.json({ status: "alive", uptime });
  });

  router.get("/health/ready", async (_req, res) => {
    if (state.isShuttingDown()) {
      res
        .status(503)
        .json({ status: "not_ready", checks: { database: { status: "down", latencyMs: 0 } } });
      return;
    }

    const database = await checkDatabase(state.db);
    const ready = database.status === "up";
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      checks: { database },
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
