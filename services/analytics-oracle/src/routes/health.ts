/**
 * Kubernetes-ready health endpoints: liveness, readiness, and startup probes.
 *
 * - /health/live    always 200 while the process is running
 * - /health/ready    200 when downstream dependencies (DB, Stellar RPC) are healthy
 * - /health/startup  200 once initial bootstrap (first analytics window) has completed
 */

import { Router } from "express";
import { Pool } from "pg";

interface DependencyCheck {
  status: "up" | "down";
  latencyMs: number;
}

export interface HealthDeps {
  db: Pool;
  rpcUrl: string;
  startTime: number;
  isStarted: () => boolean;
  startedAt: () => string | null;
}

async function checkDatabase(db: Pool): Promise<DependencyCheck> {
  const start = Date.now();
  try {
    await db.query("SELECT 1");
    return { status: "up", latencyMs: Date.now() - start };
  } catch {
    return { status: "down", latencyMs: Date.now() - start };
  }
}

async function checkStellarRpc(rpcUrl: string): Promise<DependencyCheck> {
  const start = Date.now();
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 3000);
    await fetch(rpcUrl, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger", params: [] }),
    }).finally(() => clearTimeout(timeout));
    return { status: "up", latencyMs: Date.now() - start };
  } catch {
    return { status: "down", latencyMs: Date.now() - start };
  }
}

export function createHealthRouter(deps: HealthDeps): Router {
  const router = Router();

  router.get("/health/live", (_req, res) => {
    const uptime = Math.floor((Date.now() - deps.startTime) / 1000);
    res.json({ status: "alive", uptime });
  });

  router.get("/health/ready", async (_req, res) => {
    const [database, stellar_rpc] = await Promise.all([
      checkDatabase(deps.db),
      checkStellarRpc(deps.rpcUrl),
    ]);

    const ready = database.status === "up" && stellar_rpc.status === "up";
    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      checks: { database, stellar_rpc },
    });
  });

  router.get("/health/startup", (_req, res) => {
    if (deps.isStarted()) {
      res.json({ status: "started", startedAt: deps.startedAt() });
    } else {
      res.status(503).json({ status: "starting" });
    }
  });

  return router;
}
