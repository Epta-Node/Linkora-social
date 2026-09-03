import * as rpc from "@stellar/stellar-sdk/rpc";
import type { RetryAttemptInfo, RetryReason } from "./utils/retry.js";
import { TimeoutError } from "./errors.js";

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
  /** Timeout in ms for individual health check pings. Default: 10000 */
  pingTimeoutMs?: number;
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
  private readonly pingTimeoutMs: number;
  private readonly server: rpc.Server;

  private status: ConnectionStatus = "disconnected";
  private listeners: ConnectionStatusCallback[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private hasChecked = false;
  private retryMetrics: RetryMetrics = emptyRetryMetrics();
  private readonly _server?: rpc.Server;

  private boundResume = () => this.resume();

  constructor(rpcUrl: string, config: HealthCheckConfig = {}, server?: rpc.Server) {
    this.rpcUrl = rpcUrl;
    this.intervalMs = config.intervalMs ?? 30_000;
    this.backoffMs = config.backoffMs ?? 1_000;
    this.maxBackoffMs = config.maxBackoffMs ?? 30_000;
    this.pingTimeoutMs = config.pingTimeoutMs ?? 10_000;
    this.server = server ?? new rpc.Server(this.rpcUrl, { allowHttp: false });

    if (typeof window !== "undefined") {
      window.addEventListener("online", this.boundResume);
      document.addEventListener("visibilitychange", this.boundResume);
    }
  }

  /**
   * Register a callback invoked whenever connection status changes. Starts the loop if not
   * already running. Re-registering the same callback reference is a no-op (it will not be
   * invoked twice per status change), so it is safe to call this repeatedly with a stable
   * callback — e.g. from a React effect that re-runs on every render.
   *
   * @returns An unsubscribe function that removes this listener.
   */
  onConnectionStatusChange(callback: ConnectionStatusCallback): () => void {
    if (!this.listeners.includes(callback)) {
      this.listeners.push(callback);
    }
    this.start();
    return () => {
      this.listeners = this.listeners.filter((cb) => cb !== callback);
    };
  }

  /** Perform a single health check ping against the RPC endpoint. */
  async healthCheck(): Promise<boolean> {
    try {
      const result = await withTimeout(
        this.server.getLatestLedger(),
        this.pingTimeoutMs,
        `Health check timed out after ${this.pingTimeoutMs}ms`
      );
      return result !== null;
    } catch {
      return false;
    }
  }

  /** Alias for start(). Useful for resuming after a sustained outage stops polling. */
  resume(): void {
    this.start();
  }

  /** Alias for start(). */
  wake(): void {
    this.start();
  }

  /** Start periodic health checks. Idempotent — safe to call multiple times. */
  start(): void {
    if (this.timer !== null) return; // already running
    this.stopped = false;
    this.hasChecked = false;
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

  /** Destroy the monitor, stop all checks, clear listeners, and reset state. */
  destroy(): void {
    this.stop();
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.boundResume);
      document.removeEventListener("visibilitychange", this.boundResume);
    }
    this.listeners = [];
    this.status = "disconnected";
    this.hasChecked = false;
    this.retryMetrics = emptyRetryMetrics();
    this._currentBackoff = 0;
  }

  private scheduleCheck(delayMs: number): void {
    const baseJitter =
      delayMs === 0
        ? Math.random() * Math.min(this.intervalMs, 100)
        : delayMs * 0.2 * Math.random();
    this.timer = setTimeout(() => this.runCheck(), delayMs + baseJitter);
  }

  private async runCheck(): Promise<void> {
    if (this.stopped) return;

    const ok = await this.healthCheck();
    const next: ConnectionStatus = ok ? "connected" : "disconnected";

    // Always emit the result of the first check so callers observe the
    // initial connection state even when the RPC is unreachable from the start.
    if (!this.hasChecked || next !== this.status) {
      this.status = next;
      for (const cb of this.listeners) cb(this.status);
    }
    this.hasChecked = true;

    if (!this.stopped) {
      if (!ok && this._currentBackoff >= this.maxBackoffMs) {
        // Sustained outage reached max backoff cap. Stop probing until manual restart or network recovery event.
        this.stop();
      } else {
        this.scheduleCheck(ok ? this.intervalMs : this.nextBackoff());
      }
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

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message, { timeoutMs: ms })), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
