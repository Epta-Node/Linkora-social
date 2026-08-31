/**
 * TransactionQueue — ordered multi-step Stellar transaction submission.
 *
 * Enqueues XDR transactions, signs them via a provided signer, optionally
 * simulates each via the Soroban RPC, submits to the network, polls for
 * confirmation, and emits status events at every state transition. Each step
 * may optionally register a rollback callback that is invoked if a later step
 * fails.
 *
 * ### dryRun mode
 * When `dryRun: true` is passed to `run()` (or set as a queue-level default),
 * every step is simulated but never submitted. This is useful for preflight
 * checks and fee estimation without consuming sequence numbers or fees.
 *
 * ### Per-step timeout
 * `stepTimeoutMs` (config or per-`run()` override) caps the total wall-clock
 * time spent on a single step (signing + submission + confirmation). When the
 * deadline is exceeded the step is treated as a failure and rollbacks fire.
 */

import { CircuitBreakerError, NetworkError, SigningError, SimulationError } from "./errors.js";
import { resolveRetryConfig, type RetryConfig } from "./config.js";
import { CircuitBreaker, withRetry, type RetryLogger } from "./utils/retry.js";

export type TxStatus = "pending" | "simulated" | "submitted" | "confirmed" | "failed";

export interface TxStatusEvent {
  index: number;
  xdr: string;
  status: TxStatus;
  hash?: string;
  error?: string;
  /** Resource fee returned by simulation (present when status is "simulated" or later). */
  resourceFee?: string;
}

export type TxStatusListener = (event: TxStatusEvent) => void;

export interface QueueStep {
  /** Base-64 XDR of the unsigned transaction envelope. */
  xdr: string;
  /** Called (in reverse order) if a subsequent step fails. */
  rollback?: () => Promise<void> | void;
  /**
   * Per-step timeout override in milliseconds. When set, supersedes the
   * queue-level `stepTimeoutMs` for this step only.
   */
  stepTimeoutMs?: number;
}

export interface QueueSigner {
  signTransaction(xdr: string): Promise<string>;
}

export interface SimulationResult {
  /** Whether the simulation succeeded. */
  success: boolean;
  /** Estimated resource fee in stroops as a string. */
  resourceFee: string;
  /** Error message when success is false. */
  error?: string;
}

export interface RpcClient {
  /**
   * Simulate a transaction without submitting it.
   *
   * Returns the estimated resource fee and whether the simulation succeeded.
   * Called before every `sendTransaction` unless `skipSimulation` is set.
   */
  simulateTransaction(xdr: string): Promise<SimulationResult>;

  sendTransaction(
    signedXdr: string
  ): Promise<{ hash: string; status: string; errorResultXdr?: string }>;

  getTransaction(hash: string): Promise<{ status: string; errorResultXdr?: string }>;
}

/** Options that can be passed per `run()` call to override queue-level defaults. */
export interface RunOptions {
  /**
   * When true, each step is simulated but never submitted to the network.
   * Useful for fee estimation and preflight validation.
   * Defaults to the queue-level `dryRun` setting (false if unset).
   */
  dryRun?: boolean;
  /**
   * Per-step wall-clock timeout in milliseconds for this run.
   * Overrides the queue-level `stepTimeoutMs` when set.
   */
  stepTimeoutMs?: number;
  /**
   * When true, skip the `simulateTransaction` call before submission.
   * Useful when the XDR has already been prepared / simulated upstream.
   * Does not affect dryRun — a dryRun always simulates.
   */
  skipSimulation?: boolean;
}

export interface TransactionQueueConfig {
  signer: QueueSigner;
  rpc: RpcClient;
  /** How often to poll for confirmation in ms (default 2000). */
  pollIntervalMs?: number;
  /** Maximum number of poll attempts before timing out (default 30). */
  maxPollAttempts?: number;
  /** Timeout in ms for individual RPC calls (default 10000). */
  rpcTimeoutMs?: number;
  /**
   * Maximum wall-clock time in milliseconds to spend on a single step
   * (signing + simulation + submission + confirmation). When exceeded the step
   * is failed and rollbacks fire. Default: no timeout.
   */
  stepTimeoutMs?: number;
  /**
   * When true, every `run()` call behaves as a dry run (simulate only) unless
   * the per-call `RunOptions.dryRun` explicitly overrides it.
   */
  dryRun?: boolean;
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
 * queue.on("status", (e) => console.log(e.status, e.hash));
 * queue.enqueue(xdr1, async () => { /* rollback for step 0 *\/ });
 * queue.enqueue(xdr2);
 * await queue.run();
 *
 * // Dry-run (simulate only, no submission):
 * await queue.run({ dryRun: true });
 * ```
 */
export class TransactionQueue {
  private steps: QueueStep[] = [];
  private listeners: TxStatusListener[] = [];
  private readonly signer: QueueSigner;
  private readonly rpc: RpcClient;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;
  private readonly rpcTimeoutMs: number;
  private readonly defaultStepTimeoutMs: number | undefined;
  private readonly defaultDryRun: boolean;
  private readonly retryConfig: RetryConfig;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly logger?: RetryLogger;
  private readonly random: () => number;

  /** Hashes of every successfully submitted (and confirmed) transaction, in step order. */
  private _submittedHashes: string[] = [];

  constructor(config: TransactionQueueConfig) {
    this.signer = config.signer;
    this.rpc = config.rpc;
    this.pollIntervalMs = config.pollIntervalMs ?? 2000;
    this.maxPollAttempts = config.maxPollAttempts ?? 30;
    this.rpcTimeoutMs = config.rpcTimeoutMs ?? 10000;
    this.defaultStepTimeoutMs = config.stepTimeoutMs;
    this.defaultDryRun = config.dryRun ?? false;
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
   * Hashes of all successfully confirmed transactions from the most recent
   * `run()` call, in step order. Reset at the start of each `run()`.
   */
  get submittedHashes(): readonly string[] {
    return this._submittedHashes;
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
   * @param stepTimeoutMs Optional per-step timeout override in milliseconds.
   * @returns The queue instance for chaining.
   *
   * @example
   * ```ts
   * queue.enqueue(txOpXdr, async () => {
   *   console.log("Rolling back step 0");
   * }, 10_000);
   * ```
   */
  enqueue(xdr: string, rollback?: QueueStep["rollback"], stepTimeoutMs?: number): this {
    this.steps.push({ xdr, rollback, stepTimeoutMs });
    return this;
  }

  /**
   * Execute all enqueued steps in order.
   *
   * For each step:
   *   1. Emits `pending`.
   *   2. Signs the XDR via the configured signer.
   *   3. Simulates the signed transaction via `rpc.simulateTransaction` (unless
   *      `skipSimulation` is true). Emits `simulated` on success.
   *   4. In `dryRun` mode, stops here and does not submit.
   *   5. Submits via `rpc.sendTransaction`. Emits `submitted` with the hash.
   *   6. Polls `rpc.getTransaction` until `SUCCESS` or failure. Emits `confirmed`.
   *
   * On failure of step N, rollbacks for steps 0…N-1 are called in reverse order.
   *
   * @param opts Per-call overrides (dryRun, stepTimeoutMs, skipSimulation).
   *
   * @throws {SigningError} If a transaction fails to sign.
   * @throws {SimulationError} If simulation fails (and skipSimulation is false).
   * @throws {NetworkError} If submission or confirmation fails on the network.
   *
   * @example
   * ```ts
   * // Full submit
   * await queue.run();
   *
   * // Simulate only
   * await queue.run({ dryRun: true });
   *
   * // With per-call step timeout
   * await queue.run({ stepTimeoutMs: 15_000 });
   * ```
   */
  async run(opts: RunOptions = {}): Promise<void> {
    const isDryRun = opts.dryRun ?? this.defaultDryRun;
    const skipSimulation = opts.skipSimulation ?? false;
    const runTimeoutMs = opts.stepTimeoutMs ?? this.defaultStepTimeoutMs;

    this._submittedHashes = [];
    const completed: number[] = [];

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      const timeoutMs = step.stepTimeoutMs ?? runTimeoutMs;

      this.emit({ index: i, xdr: step.xdr, status: "pending" });

      // runStep emits "failed" and fires rollbacks internally before throwing.
      await this.runStep(i, step, isDryRun, skipSimulation, completed, timeoutMs);
    }

    this.steps = [];
  }

  // ── Internal step execution ───────────────────────────────────────────────

  private async runStep(
    i: number,
    step: QueueStep,
    isDryRun: boolean,
    skipSimulation: boolean,
    completed: number[],
    timeoutMs: number | undefined
  ): Promise<void> {
    const work = this.executeStep(i, step, isDryRun, skipSimulation, completed);

    if (timeoutMs !== undefined) {
      await this.withTimeout(work, timeoutMs, async () => {
        const error = `Step ${i} timed out after ${timeoutMs}ms`;
        this.emit({ index: i, xdr: step.xdr, status: "failed", error });
        await this.runRollbacks(completed);
        throw new NetworkError(error, { step: i, timeout: timeoutMs });
      });
    } else {
      await work;
    }
  }

  private async executeStep(
    i: number,
    step: QueueStep,
    isDryRun: boolean,
    skipSimulation: boolean,
    completed: number[]
  ): Promise<void> {
    // ── 1. Sign ──────────────────────────────────────────────────────────────
    let signedXdr: string;
    try {
      signedXdr = await this.signer.signTransaction(step.xdr);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.emit({ index: i, xdr: step.xdr, status: "failed", error });
      await this.runRollbacks(completed);
      throw new SigningError(`Step ${i} signing failed: ${error}`, { step: i }, err);
    }

    // ── 2. Simulate ──────────────────────────────────────────────────────────
    let resourceFee: string | undefined;
    if (!skipSimulation || isDryRun) {
      let simResult: SimulationResult;
      try {
        simResult = await this.rpc.simulateTransaction(signedXdr);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.emit({ index: i, xdr: step.xdr, status: "failed", error });
        await this.runRollbacks(completed);
        throw new SimulationError(`Step ${i} simulation error: ${error}`, undefined, err);
      }

      if (!simResult.success) {
        const error = simResult.error ?? "simulation failed";
        this.emit({ index: i, xdr: step.xdr, status: "failed", error });
        await this.runRollbacks(completed);
        throw new SimulationError(`Step ${i} simulation failed: ${error}`, undefined);
      }

      resourceFee = simResult.resourceFee;
      this.emit({ index: i, xdr: step.xdr, status: "simulated", resourceFee });
    }

    // ── 3. Dry-run exit ──────────────────────────────────────────────────────
    if (isDryRun) {
      // Simulation succeeded; mark as confirmed for tracking purposes (no hash).
      this.emit({ index: i, xdr: step.xdr, status: "confirmed", resourceFee });
      completed.push(i);
      return;
    }

    // ── 4. Submit ────────────────────────────────────────────────────────────
    let hash: string;
    try {
      const result = await withRetry(
        async () => {
          const r = await this.withTimeout(
            this.rpc.sendTransaction(signedXdr),
            this.rpcTimeoutMs,
            async () => {
              throw new NetworkError(`sendTransaction timed out after ${this.rpcTimeoutMs}ms`);
            }
          );
          if (r.status === "ERROR") {
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
      throw err instanceof CircuitBreakerError
        ? err
        : new NetworkError(`Step ${i} submission failed: ${error}`, { step: i }, err);
    }

    this.emit({ index: i, xdr: step.xdr, status: "submitted", hash, resourceFee });

    // ── 5. Confirm ───────────────────────────────────────────────────────────
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

    this.emit({ index: i, xdr: step.xdr, status: "confirmed", hash, resourceFee });
    this._submittedHashes.push(hash);
    completed.push(i);
  }

  private emit(event: TxStatusEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private async pollConfirmation(hash: string): Promise<void> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt++) {
      const tx = await this.withTimeout(
        this.rpc.getTransaction(hash),
        this.rpcTimeoutMs,
        async () => {
          throw new NetworkError(`getTransaction timed out after ${this.rpcTimeoutMs}ms`);
        }
      );
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

  /**
   * Race `work` against a deadline. If the deadline fires first, `onTimeout`
   * is called (which should throw) and its rejection propagates.
   */
  private async withTimeout<T>(
    work: Promise<T>,
    timeoutMs: number,
    onTimeout: () => Promise<never>
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => onTimeout().catch(reject), timeoutMs);
    });
    try {
      return await Promise.race([work, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
