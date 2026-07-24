/**
 * TransactionQueue — ordered multi-step Stellar transaction submission.
 *
 * Enqueues XDR transactions, signs them via a provided signer, submits each
 * to the Soroban RPC, polls for confirmation, and emits status events at
 * every state transition. Each step may optionally register a rollback
 * callback that is invoked if a later step fails.
 */

import { CircuitBreakerError, NetworkError, SigningError } from "./errors";
import { resolveRetryConfig, type RetryConfig } from "./config";
import { CircuitBreaker, withRetry, type RetryLogger } from "./utils/retry";

export type TxStatus = "pending" | "submitted" | "confirmed" | "failed";

export interface TxStatusEvent {
  index: number;
  xdr: string;
  status: TxStatus;
  hash?: string;
  error?: string;
}

export type TxStatusListener = (event: TxStatusEvent) => void;

export interface QueueStep {
  /** Base-64 XDR of the unsigned transaction envelope. */
  xdr: string;
  /** Called (in reverse order) if a subsequent step fails. */
  rollback?: () => Promise<void> | void;
}

export interface QueueSigner {
  signTransaction(xdr: string): Promise<string>;
}

export interface RpcClient {
  sendTransaction(
    signedXdr: string
  ): Promise<{ hash: string; status: string; errorResultXdr?: string }>;
  getTransaction(hash: string): Promise<{ status: string; errorResultXdr?: string }>;
}

export interface TransactionQueueConfig {
  signer: QueueSigner;
  rpc: RpcClient;
  /** How often to poll for confirmation in ms (default 2000). */
  pollIntervalMs?: number;
  /** Maximum number of poll attempts before timing out (default 30). */
  maxPollAttempts?: number;
  /**
   * Retry / backoff overrides. Any field left unset falls back to the
   * environment-derived defaults (see {@link resolveRetryConfig}).
   */
  retry?: Partial<RetryConfig>;
  /**
   * Structured-logging hook invoked on every retry decision. Wire this to a
   * `ConnectionHealthMonitor.recordRetry` to surface retry telemetry.
   */
  logger?: RetryLogger;
  /** Injectable RNG for the backoff jitter (defaults to `Math.random`). */
  random?: () => number;
}

/**
 * A submission failure is permanent (not worth retrying) when it carries a
 * `retryable: false` marker in its error details — e.g. a transaction the RPC
 * rejected outright with an `ERROR` status.
 */
function isRetryableSubmission(err: unknown): boolean {
  const details = (err as { details?: { retryable?: boolean } } | null)?.details;
  return details?.retryable !== false;
}

/**
 * Ordered queue for multi-step Stellar transaction flows.
 *
 * Usage:
 * ```ts
 * const queue = new TransactionQueue({ signer, rpc });
 * queue.on("status", (e) => console.log(e.status));
 * queue.enqueue(xdr1, async () => { // rollback for step 0 });
 * queue.enqueue(xdr2);
 * await queue.run();
 * ```
 */
export class TransactionQueue {
  private steps: QueueStep[] = [];
  private listeners: TxStatusListener[] = [];
  private readonly signer: QueueSigner;
  private readonly rpc: RpcClient;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;
  private readonly retryConfig: RetryConfig;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly logger?: RetryLogger;
  private readonly random: () => number;

  constructor(config: TransactionQueueConfig) {
    this.signer = config.signer;
    this.rpc = config.rpc;
    this.pollIntervalMs = config.pollIntervalMs ?? 2000;
    this.maxPollAttempts = config.maxPollAttempts ?? 30;
    this.retryConfig = resolveRetryConfig(config.retry);
    this.circuitBreaker = new CircuitBreaker(this.retryConfig.circuitBreakerThreshold);
    this.logger = config.logger;
    this.random = config.random ?? Math.random;
  }

  /** Current circuit-breaker state — `true` once the failure threshold is hit. */
  get isCircuitOpen(): boolean {
    return this.circuitBreaker.isOpen;
  }

  /**
   * Register a status-change listener.
   *
   * @param event The event name to listen for (currently only "status").
   * @param listener The callback function invoked on status changes.
   * @returns The queue instance for chaining.
   *
   * @example
   * ```ts
   * queue.on("status", (e) => {
   *   console.log(`Step ${e.index} status: ${e.status}`);
   *   if (e.status === "failed") {
   *     console.error(`Error: ${e.error}`);
   *   }
   * });
   * ```
   */
  on(event: "status", listener: TxStatusListener): this {
    this.listeners.push(listener);
    return this;
  }

  /**
   * Add a transaction step to the queue.
   *
   * @param xdr The base64-encoded transaction envelope XDR.
   * @param rollback An optional callback to run if a subsequent step in the queue fails.
   * @returns The queue instance for chaining.
   *
   * @example
   * ```ts
   * queue.enqueue(txOpXdr, async () => {
   *   console.log("Rolling back step 0");
   *   // Implement any necessary rollback logic here
   * });
   * ```
   */
  enqueue(xdr: string, rollback?: QueueStep["rollback"]): this {
    this.steps.push({ xdr, rollback });
    return this;
  }

  /**
   * Execute all enqueued steps in order.
   * On failure of step N, rollbacks for steps 0…N-1 are called in reverse order.
   *
   * @throws {SigningError} If a transaction fails to sign.
   * @throws {NetworkError} If submission or confirmation fails on the network.
   *
   * @example
   * ```ts
   * try {
   *   await queue.run();
   *   console.log("All transactions completed successfully!");
   * } catch (error) {
   *   console.error("Queue execution failed:", error.message);
   *   // Rollbacks for previously successful steps have already been executed
   * }
   * ```
   */
  async run(): Promise<void> {
    const completed: number[] = [];

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      this.emit({ index: i, xdr: step.xdr, status: "pending" });

      let signedXdr: string;
      try {
        signedXdr = await this.signer.signTransaction(step.xdr);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.emit({ index: i, xdr: step.xdr, status: "failed", error });
        await this.runRollbacks(completed);
        throw new SigningError(`Step ${i} signing failed: ${error}`, { step: i }, err);
      }

      let hash: string;
      try {
        const result = await withRetry(
          async () => {
            const r = await this.rpc.sendTransaction(signedXdr);
            if (r.status === "ERROR") {
              // Permanent rejection — mark non-retryable so we fail fast.
              throw new NetworkError(r.errorResultXdr ?? "sendTransaction returned ERROR", {
                step: i,
                retryable: false,
              });
            }
            return r;
          },
          {
            config: this.retryConfig,
            circuitBreaker: this.circuitBreaker,
            isRetryable: isRetryableSubmission,
            onRetry: this.logger,
            sleep: (ms) => this.sleep(ms),
            random: this.random,
          }
        );
        hash = result.hash;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.emit({ index: i, xdr: step.xdr, status: "failed", error });
        await this.runRollbacks(completed);
        // Surface circuit-breaker trips verbatim so callers can report unhealthy.
        throw err instanceof CircuitBreakerError
          ? err
          : new NetworkError(`Step ${i} submission failed: ${error}`, { step: i }, err);
      }

      this.emit({ index: i, xdr: step.xdr, status: "submitted", hash });

      try {
        await this.pollConfirmation(hash);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.emit({ index: i, xdr: step.xdr, status: "failed", hash, error });
        await this.runRollbacks(completed);
        throw err instanceof NetworkError
          ? err
          : new NetworkError(`Step ${i} confirmation failed: ${error}`, { step: i, hash }, err);
      }

      this.emit({ index: i, xdr: step.xdr, status: "confirmed", hash });
      completed.push(i);
    }
  }

  private emit(event: TxStatusEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private async pollConfirmation(hash: string): Promise<void> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt++) {
      const tx = await this.rpc.getTransaction(hash);
      if (tx.status === "SUCCESS") return;
      if (tx.status === "FAILED") {
        throw new NetworkError(tx.errorResultXdr ?? "transaction FAILED", { hash });
      }
      // status is "NOT_FOUND" or "PENDING" — keep polling
      await this.sleep(this.pollIntervalMs);
    }
    throw new NetworkError(
      `Transaction ${hash} not confirmed after ${this.maxPollAttempts} attempts`,
      { hash, attempts: this.maxPollAttempts }
    );
  }

  private async runRollbacks(completedIndices: number[]): Promise<void> {
    for (let i = completedIndices.length - 1; i >= 0; i--) {
      const step = this.steps[completedIndices[i]];
      if (step.rollback) {
        try {
          await step.rollback();
        } catch {
          // Rollbacks are best-effort; swallow errors to allow the rest to run.
        }
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
