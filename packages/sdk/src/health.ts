import * as rpc from "@stellar/stellar-sdk/rpc";
import type { RetryAttemptInfo, RetryReason } from "./utils/retry";

export type ConnectionStatus = "connected" | "disconnected";
export type ConnectionStatusCallback = (status: ConnectionStatus) => void;

/**
 * Aggregate retry telemetry recorded from a {@link TransactionQueue}'s retry loop.
 */
export interface RetryMetrics {
  /** Total retry attempts observed (excludes the initial try and terminal outcomes). */
  totalRetries: number;
  /** Retries triggered by a rate-limit (`Retry-After` / 429) response. */
  rateLimitedRetries: number;
  /** Number of times the circuit breaker has opened. */
  circuitOpenEvents: number;
  /** Number of submissions that exhausted all attempts. */
  exhaustedEvents: number;
  /** Reason for the most recent retry decision, if any. */
  lastReason?: RetryReason;
  /** Delay in ms scheduled for the most recent retry, if any. */
  lastDelayMs?: number;
  /** False once the circuit breaker has opened; restored by {@link ConnectionHealthMonitor.resetRetryMetrics}. */
  healthy: boolean;
}

function emptyRetryMetrics(): RetryMetrics {
  return {
    totalRetries: 0,
    rateLimitedRetries: 0,
    circuitOpenEvents: 0,
    exhaustedEvents: 0,
    healthy: true,
  };
}

export interface HealthCheckConfig {
  /** Interval in ms between health checks. Default: 30000 */
  intervalMs?: number;
  /** Initial backoff in ms for reconnection attempts. Default: 1000 */
  backoffMs?: number;
  /** Maximum backoff cap in ms. Default: 30000 */
  maxBackoffMs?: number;
}

/**
 * Manages periodic RPC health checks, emits connected/disconnected events,
 * and retries with exponential backoff on disconnect.
 */
export class ConnectionHealthMonitor {
  private readonly rpcUrl: string;
  private readonly intervalMs: number;
  private readonly backoffMs: number;
  private readonly maxBackoffMs: number;

  private status: ConnectionStatus = "disconnected";
  private listeners: ConnectionStatusCallback[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private retryMetrics: RetryMetrics = emptyRetryMetrics();

  constructor(rpcUrl: string, config: HealthCheckConfig = {}) {
    this.rpcUrl = rpcUrl;
    this.intervalMs = config.intervalMs ?? 30_000;
    this.backoffMs = config.backoffMs ?? 1_000;
    this.maxBackoffMs = config.maxBackoffMs ?? 30_000;
  }

  /** Register a callback invoked whenever connection status changes. Starts the loop if not already running. */
  onConnectionStatusChange(callback: ConnectionStatusCallback): void {
    this.listeners.push(callback);
    this.start();
  }

  /** Perform a single health check ping against the RPC endpoint. */
  async healthCheck(): Promise<boolean> {
    try {
      const server = new rpc.Server(this.rpcUrl);
      await server.getLatestLedger();
      return true;
    } catch {
      return false;
    }
  }

  /** Start periodic health checks. Idempotent — safe to call multiple times. */
  start(): void {
    if (this.timer !== null) return; // already running
    this.stopped = false;
    this.scheduleCheck(0);
  }

  /** Stop all periodic checks and clear timers. */
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleCheck(delayMs: number): void {
    this.timer = setTimeout(() => this.runCheck(), delayMs);
  }

  private async runCheck(): Promise<void> {
    if (this.stopped) return;

    const ok = await this.healthCheck();
    const next: ConnectionStatus = ok ? "connected" : "disconnected";

    if (next !== this.status) {
      this.status = next;
      for (const cb of this.listeners) cb(this.status);
    }

    if (!this.stopped) {
      this.scheduleCheck(ok ? this.intervalMs : this.nextBackoff());
    }
  }

  /**
   * Record a retry decision emitted by a transaction queue's retry loop.
   *
   * Wire this as the queue's `logger` (or call it from one) to surface retry
   * telemetry and circuit-breaker health through the monitor.
   */
  recordRetry(info: RetryAttemptInfo): void {
    this.retryMetrics.lastReason = info.reason;
    this.retryMetrics.lastDelayMs = info.delayMs;

    switch (info.reason) {
      case "rate-limited":
        this.retryMetrics.rateLimitedRetries += 1;
        this.retryMetrics.totalRetries += 1;
        break;
      case "error":
        this.retryMetrics.totalRetries += 1;
        break;
      case "circuit-open":
        this.retryMetrics.circuitOpenEvents += 1;
        this.retryMetrics.healthy = false;
        break;
      case "exhausted":
        this.retryMetrics.exhaustedEvents += 1;
        break;
    }
  }

  /** Snapshot of the retry telemetry gathered so far. */
  getRetryMetrics(): RetryMetrics {
    return { ...this.retryMetrics };
  }

  /** Clear retry telemetry and restore retry health to healthy. */
  resetRetryMetrics(): void {
    this.retryMetrics = emptyRetryMetrics();
  }

  /**
   * Overall health: connected to the RPC and the retry circuit breaker has not
   * tripped since the last reset.
   */
  isHealthy(): boolean {
    return this.status === "connected" && this.retryMetrics.healthy;
  }

  private _currentBackoff = 0;

  private nextBackoff(): number {
    if (this._currentBackoff === 0) {
      this._currentBackoff = this.backoffMs;
    } else {
      this._currentBackoff = Math.min(this._currentBackoff * 2, this.maxBackoffMs);
    }
    return this._currentBackoff;
  }
}
