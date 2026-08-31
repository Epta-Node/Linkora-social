import http from "http";
import { Pool } from "pg";
import { WsHandle } from "./ws";
import { logger } from "./logger";

export interface GracefulShutdownOptions {
  httpServer: http.Server;
  pgPool: Pool;
  wsHandle: WsHandle;
  abortController: AbortController;
  scoreRefreshStop: () => void;
  detachNotificationDispatcher: () => void;
  shutdownTimeoutMs?: number;
  onSignal?: (signal: string) => void;
  shutdownFlag?: { active: boolean };
}

export class GracefulShutdown {
  private readonly httpServer: http.Server;
  private readonly pgPool: Pool;
  private readonly wsHandle: WsHandle;
  private readonly abortController: AbortController;
  private readonly scoreRefreshStop: () => void;
  private readonly detachNotificationDispatcher: () => void;
  private readonly shutdownTimeoutMs: number;
  private readonly onSignal?: (signal: string) => void;
  private readonly shutdownFlag?: { active: boolean };

  private _isShuttingDown = false;
  private inFlightRequests = 0;
  private inFlightResolve: (() => void) | null = null;

  constructor(opts: GracefulShutdownOptions) {
    this.httpServer = opts.httpServer;
    this.pgPool = opts.pgPool;
    this.wsHandle = opts.wsHandle;
    this.abortController = opts.abortController;
    this.scoreRefreshStop = opts.scoreRefreshStop;
    this.detachNotificationDispatcher = opts.detachNotificationDispatcher;
    this.shutdownTimeoutMs = opts.shutdownTimeoutMs ?? 30_000;
    this.onSignal = opts.onSignal;
    this.shutdownFlag = opts.shutdownFlag;

    this.httpServer.on("request", (_req, res) => {
      this.inFlightRequests++;
      res.on("finish", () => this.requestComplete());
      res.on("close", () => this.requestComplete());
    });
  }

  get isShuttingDown(): boolean {
    return this._isShuttingDown;
  }

  get activeRequestCount(): number {
    return this.inFlightRequests;
  }

  private requestComplete(): void {
    this.inFlightRequests--;
    if (this.inFlightRequests === 0 && this.inFlightResolve) {
      this.inFlightResolve();
      this.inFlightResolve = null;
    }
  }

  registerSignals(): void {
    process.on("SIGTERM", () => void this.shutdown("SIGTERM"));
    process.on("SIGINT", () => void this.shutdown("SIGINT"));
  }

  async shutdown(signal: string): Promise<void> {
    if (this._isShuttingDown) return;
    this._isShuttingDown = true;
    if (this.shutdownFlag) this.shutdownFlag.active = true;

    logger.info({ signal, shutdownTimeoutMs: this.shutdownTimeoutMs }, "Shutdown initiated");

    this.onSignal?.(signal);

    this.scoreRefreshStop();
    this.detachNotificationDispatcher();

    this.abortController.abort();

    logger.info({ activeRequests: this.inFlightRequests }, "Stopping HTTP server");
    this.httpServer.close();

    const wsClose = this.wsHandle.close().then(() => {
      logger.info("WebSocket server closed");
    });

    const drainPromise = new Promise<void>((resolve) => {
      if (this.inFlightRequests <= 0) {
        resolve();
      } else {
        this.inFlightResolve = resolve;
      }
    });

    const pgClose = drainPromise
      .then(() => {
        logger.info("In-flight requests drained, closing PostgreSQL pool");
        return this.pgPool.end();
      })
      .then(() => {
        logger.info("PostgreSQL pool closed");
      });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("Shutdown timed out")), this.shutdownTimeoutMs);
    });

    try {
      await Promise.race([Promise.all([wsClose, pgClose]), timeout]);
      if (timeoutId) clearTimeout(timeoutId);
      logger.info({ signal }, "Shutdown complete");
      process.exit(0);
    } catch {
      logger.error({ signal }, "Shutdown timed out, forcing exit");
      process.exit(1);
    }
  }
}
