/**
 * Health check orchestration for Kubernetes-style liveness / readiness / startup probes.
 *
 * Tracks process-level lifecycle state (started, shutting down) and runs
 * downstream dependency checks (database, Stellar RPC, event stream) with
 * latency measurements for the readiness probe.
 *
 * Backfill monitoring
 * ────────────────────
 * The monitor accepts an optional BackfillCoordinator reference. When present,
 * the health endpoint exposes:
 *   - backfill.status  — "healthy" | "backfilling" | "gap_too_large" | "circuit_open"
 *   - backfill.progress — processed / total ledger counts
 */

import { Pool } from "pg";
import type { BackfillCoordinator, BackfillStatus, BackfillProgress } from "./backfill-coordinator";

export interface DependencyCheck {
  status: "up" | "down";
  latencyMs: number;
}

export interface EventStreamCheck {
  status: "connected" | "disconnected";
  lastEventAgo: string;
}

export interface BackfillHealthCheck {
  status: BackfillStatus;
  fromLedger?: number;
  toLedger?: number;
  processedLedgers: number;
  totalLedgers: number;
  consecutiveFailures: number;
}

export interface ReadinessResult {
  ready: boolean;
  checks: {
    database: DependencyCheck;
    stellar_rpc: DependencyCheck;
    event_stream: EventStreamCheck;
    backfill: BackfillHealthCheck;
  };
}

export class HealthMonitor {
  private started = false;
  private startedAt: string | null = null;
  private shuttingDown = false;
  private lastEventAt: number | null = null;
  private backfillCoordinator: BackfillCoordinator | null = null;

  constructor(
    private db: Pool,
    private rpcUrl: string
  ) {}

  /**
   * Attach a backfill coordinator so the health endpoint can report its status.
   * Call this after constructing both the monitor and the coordinator.
   */
  setBackfillCoordinator(coordinator: BackfillCoordinator): void {
    this.backfillCoordinator = coordinator;
  }

  markStarted(): void {
    if (this.started) return;
    this.started = true;
    this.startedAt = new Date().toISOString();
  }

  markShuttingDown(): void {
    this.shuttingDown = true;
  }

  recordEvent(): void {
    this.lastEventAt = Date.now();
  }

  isStarted(): boolean {
    return this.started;
  }

  getStartedAt(): string | null {
    return this.startedAt;
  }

  private async checkDatabase(): Promise<DependencyCheck> {
    const start = Date.now();
    try {
      await this.db.query("SELECT 1");
      return { status: "up", latencyMs: Date.now() - start };
    } catch {
      return { status: "down", latencyMs: Date.now() - start };
    }
  }

  private async checkStellarRpc(): Promise<DependencyCheck> {
    const start = Date.now();
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 3000);
      await fetch(this.rpcUrl, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger", params: {} }),
      }).finally(() => clearTimeout(timeout));
      return { status: "up", latencyMs: Date.now() - start };
    } catch {
      return { status: "down", latencyMs: Date.now() - start };
    }
  }

  private checkEventStream(): EventStreamCheck {
    if (this.lastEventAt === null) {
      return { status: "disconnected", lastEventAgo: "n/a" };
    }
    const secondsAgo = Math.floor((Date.now() - this.lastEventAt) / 1000);
    return { status: "connected", lastEventAgo: `${secondsAgo}s` };
  }

  private checkBackfill(): BackfillHealthCheck {
    if (!this.backfillCoordinator) {
      return {
        status: "healthy",
        processedLedgers: 0,
        totalLedgers: 0,
        consecutiveFailures: 0,
      };
    }
    const p: BackfillProgress = this.backfillCoordinator.progress;
    return {
      status: p.status,
      fromLedger: p.fromLedger,
      toLedger: p.toLedger,
      processedLedgers: p.processedLedgers,
      totalLedgers: p.totalLedgers,
      consecutiveFailures: p.consecutiveFailures,
    };
  }

  async checkReadiness(): Promise<ReadinessResult> {
    if (this.shuttingDown) {
      return {
        ready: false,
        checks: {
          database: { status: "down", latencyMs: 0 },
          stellar_rpc: { status: "down", latencyMs: 0 },
          event_stream: { status: "disconnected", lastEventAgo: "n/a" },
          backfill: {
            status: "healthy",
            processedLedgers: 0,
            totalLedgers: 0,
            consecutiveFailures: 0,
          },
        },
      };
    }

    const [database, stellar_rpc] = await Promise.all([
      this.checkDatabase(),
      this.checkStellarRpc(),
    ]);
    const event_stream = this.checkEventStream();
    const backfill = this.checkBackfill();

    // Not ready if circuit breaker is open or gap is too large.
    const backfillHealthy =
      backfill.status !== "circuit_open" && backfill.status !== "gap_too_large";
    const ready =
      database.status === "up" && stellar_rpc.status === "up" && backfillHealthy;

    return { ready, checks: { database, stellar_rpc, event_stream, backfill } };
  }
}
