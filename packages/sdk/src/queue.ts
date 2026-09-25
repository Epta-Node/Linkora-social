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
 * In dry-run mode the queue still emits a `confirmed` event at the end of each
 * step (as a completion marker), but the event carries `dryRun: true` and no
 * `hash`. Consumers can therefore distinguish a simulated `confirmed` from a
 * real on-chain confirmation by checking the `dryRun` flag.
 *
 * ### Per-step timeout
 * `stepTimeoutMs` (config or per-`run()` override) caps the total wall-clock
 * time spent on a single step (signing + submission + confirmation). When the
 * deadline is exceeded the step is treated as a failure and rollbacks fire.
 *
 * ### Restart persistence (issue #1355)
 * With a `persistence` adapter configured, queue and retry state is saved at
 * every durable transition. If the host app restarts mid-queue, `resume()`
 * reloads that state: sent-but-unconfirmed transactions emit an explicit
 * `unconfirmed` event and are reconciled (confirmed or reported `lost`),
 * never-submitted items emit `lost` and are re-queued for submission.
 */

import * as rpc from "@stellar/stellar-sdk/rpc";
import { TransactionBuilder, type Transaction, FeeBumpTransaction } from "@stellar/stellar-base";
import { CircuitBreakerError, NetworkError, SigningError, SimulationError } from "./errors.js";
import { resolveRetryConfig, type RetryConfig } from "./config.js";
import { CircuitBreaker, withRetry, type RetryLogger } from "./utils/retry.js";

const { isSimulationError, isSimulationSuccess } = rpc.Api;

export type TxStatus =
  | "pending"
  | "simulated"
  | "submitted"
  | "confirmed"
  | "failed"
  | "unconfirmed"
  | "lost";

export interface TxStatusEvent {
  index: number;
  xdr: string;
  status: TxStatus;
  hash?: string;
  error?: string;
  /** Resource fee returned by simulation (present when status is "simulated" or later). */
  resourceFee?: string;
  /**
   * When `true`, the event reflects a dry-run (simulate-only) execution rather
   * than a real on-chain submission. A dry-run `confirmed` event carries no
   * `hash`; consumers can use this flag to distinguish simulated success from an
   * actual broadcast.
   */
  dryRun?: boolean;
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

/**
 * Durable, per-step record persisted by a {@link QueuePersistence} adapter
 * (issue #1355). Rollback callbacks are functions and cannot be serialized;
 * after a restart the resumed queue therefore reports `lost` / `unconfirmed`
 * status events instead of replaying rollbacks.
 */
export interface PersistedQueueStep {
  xdr: string;
  /** Durable status at save time. */
  status: "pending" | "simulated" | "submitted" | "confirmed";
  /** Transaction hash once the step has been submitted. */
  hash?: string;
  resourceFee?: string;
  stepTimeoutMs?: number;
}

/** Snapshot of queue + retry state saved by the persistence adapter. */
export interface PersistedQueueState {
  steps: PersistedQueueStep[];
  /** Epoch milliseconds when the snapshot was written. */
  savedAt: number;
}

/**
 * Optional storage adapter (issue #1355) that lets a host app survive a
 * restart: queue and retry state is written through `save` at every durable
 * transition, and {@link TransactionQueue.resume} reloads it to reconcile
 * sent-but-unconfirmed transactions.
 */
export interface QueuePersistence {
  save(state: PersistedQueueState): Promise<void>;
  load(): Promise<PersistedQueueState | undefined>;
  clear(): Promise<void>;
}

export interface QueueSigner {
  signTransaction(xdr: string): Promise<string>;
  getPublicKey?(): Promise<string>;
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
  /** Network used to parse transaction XDR when sequence guarding is enabled. */
  networkPassphrase?: string;
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

  /** Latest Horizon account sequence used to reject stale or overlapping submissions. */
  getAccountSequence?(accountId: string): Promise<{ sequence: string; ledger?: number }>;
}

const accountSequenceLocks = new Map<string, Promise<void>>();

async function withAccountSequenceLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = accountSequenceLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  accountSequenceLocks.set(key, current);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (accountSequenceLocks.get(key) === current) accountSequenceLocks.delete(key);
  }
}

/**
 * Adapts a raw `@stellar/stellar-sdk` RPC server handle — whose methods take
 * parsed `Transaction` objects — to the string-XDR {@link RpcClient} shape
 * `TransactionQueue` expects.
 */
export function createRpcClientAdapter(
  server: rpc.Server,
  networkPassphrase: string,
  getAccountSequence?: RpcClient["getAccountSequence"]
): RpcClient {
  const parse = (xdr: string): Transaction | FeeBumpTransaction =>
    TransactionBuilder.fromXDR(xdr, networkPassphrase);

  return {
    networkPassphrase,
    ...(getAccountSequence ? { getAccountSequence } : {}),
    async simulateTransaction(xdr: string): Promise<SimulationResult> {
      const result = await server.simulateTransaction(parse(xdr));

      if (isSimulationError(result)) {
        return { success: false, resourceFee: "0", error: result.error };
      }
      if (!isSimulationSuccess(result)) {
        return { success: false, resourceFee: "0", error: "Unknown simulation error" };
      }
      return { success: true, resourceFee: result.minResourceFee || "0" };
    },

    async sendTransaction(signedXdr: string) {
      const result = await server.sendTransaction(parse(signedXdr));
      return {
        hash: result.hash,
        status: result.status,
        errorResultXdr: result.errorResult?.toXDR("base64"),
      };
    },

    async getTransaction(hash: string) {
      const result = await server.getTransaction(hash);
      return {
        status: result.status,
        errorResultXdr:
          result.status === rpc.Api.GetTransactionStatus.FAILED
            ? result.resultXdr.toXDR("base64")
            : undefined,
      };
    },
  };
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
  /** Network passphrase used to parse queued XDR for its source and sequence. */
  networkPassphrase?: string;
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
  /**
   * Optional persistence hook (issue #1355). When set, queue and retry state
   * is saved through it at every durable transition so a host-app restart can
   * resume via {@link TransactionQueue.resume} and reconcile sent-but-
   * unconfirmed transactions.
   */
  persistence?: QueuePersistence;
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
  private readonly networkPassphrase: string;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;
  private readonly rpcTimeoutMs: number;
  private readonly defaultStepTimeoutMs: number | undefined;
  private readonly defaultDryRun: boolean;
  private readonly retryConfig: RetryConfig;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly logger?: RetryLogger;
  private readonly random: () => number;
  private readonly persistence?: QueuePersistence;

  /** Hashes of every successfully submitted (and confirmed) transaction, in step order. */
  private _submittedHashes: string[] = [];

  /** Durable per-step state mirrored into the persistence adapter when set. */
  private stepStates: PersistedQueueStep[] = [];

  constructor(config: TransactionQueueConfig) {
    this.signer = config.signer;
    this.rpc = config.rpc;
    this.networkPassphrase =
      config.networkPassphrase ??
      config.rpc.networkPassphrase ??
      "Test SDF Network ; September 2015";
    this.pollIntervalMs = config.pollIntervalMs ?? 2000;
    this.maxPollAttempts = config.maxPollAttempts ?? 30;
    this.rpcTimeoutMs = config.rpcTimeoutMs ?? 10000;
    this.defaultStepTimeoutMs = config.stepTimeoutMs;
    this.defaultDryRun = config.dryRun ?? false;
    this.retryConfig = resolveRetryConfig(config.retry);
    this.circuitBreaker = new CircuitBreaker(this.retryConfig.circuitBreakerThreshold);
    this.logger = config.logger;
    this.random = config.random ?? Math.random;
    this.persistence = config.persistence;
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
    this.stepStates.push({ xdr, status: "pending", stepTimeoutMs });
    this.persistSnapshot();
    return this;
  }

  /**
   * Resume a queue after a host-app restart (issue #1355).
   *
   * Loads the state persisted by the {@link QueuePersistence} adapter and
   * reconciles every persisted step:
   * - **submitted-but-unconfirmed** steps emit an explicit `unconfirmed` event
   *   and are then re-polled: a later on-chain success emits `confirmed`
   *   (recovered), a failure emits `lost`.
   * - **never-submitted** steps (still `pending`/`simulated` at restart) emit
   *   a `lost` event and are re-queued, then executed through the normal
   *   submission pipeline.
   * - already `confirmed` steps are silently recovered into
   *   {@link TransactionQueue.submittedHashes}.
   *
   * Rollback callbacks cannot be persisted, so a resumed queue cannot replay
   * rollbacks — that is exactly why the `unconfirmed`/`lost` events exist.
   *
   * @param opts Per-call overrides applied to the remaining queued steps.
   * @returns The number of steps re-queued for execution.
   */
  async resume(opts: RunOptions = {}): Promise<number> {
    const persistence = this.persistence;
    if (!persistence) return 0;

    const state = await persistence.load();
    await persistence.clear();

    if (!state || state.steps.length === 0) return 0;

    const unfinished: QueueStep[] = [];

    for (let i = 0; i < state.steps.length; i++) {
      const persisted = state.steps[i];

      if (persisted.status === "submitted" && persisted.hash) {
        // Sent but never confirmed before the restart: signal it explicitly,
        // then reconcile by polling the network.
        this.emit({
          index: i,
          xdr: persisted.xdr,
          status: "unconfirmed",
          hash: persisted.hash,
          resourceFee: persisted.resourceFee,
        });
        try {
          await this.pollConfirmation(persisted.hash);
          this.emit({
            index: i,
            xdr: persisted.xdr,
            status: "confirmed",
            hash: persisted.hash,
            resourceFee: persisted.resourceFee,
          });
          this._submittedHashes.push(persisted.hash);
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          this.emit({
            index: i,
            xdr: persisted.xdr,
            status: "lost",
            hash: persisted.hash,
            error,
          });
        }
      } else if (persisted.status === "confirmed" && persisted.hash) {
        // Already confirmed before the restart — recover silently.
        this._submittedHashes.push(persisted.hash);
      } else {
        // Never submitted: the item was dropped by the restart.
        this.emit({
          index: i,
          xdr: persisted.xdr,
          status: "lost",
          resourceFee: persisted.resourceFee,
        });
        unfinished.push({ xdr: persisted.xdr, stepTimeoutMs: persisted.stepTimeoutMs });
      }
    }

    this.steps = unfinished;
    this.stepStates = unfinished.map((step) => ({
      xdr: step.xdr,
      status: "pending" as const,
      stepTimeoutMs: step.stepTimeoutMs,
    }));

    if (this.steps.length > 0) {
      const isDryRun = opts.dryRun ?? this.defaultDryRun;
      const skipSimulation = opts.skipSimulation ?? false;
      const runTimeoutMs = opts.stepTimeoutMs ?? this.defaultStepTimeoutMs;
      const completed: number[] = [];
      for (let i = 0; i < this.steps.length; i++) {
        const step = this.steps[i];
        this.emit({ index: i, xdr: step.xdr, status: "pending" });
        await this.runStep(i, step, isDryRun, skipSimulation, completed, step.stepTimeoutMs ?? runTimeoutMs);
      }
      this.steps = [];
      this.stepStates = [];
      await this.persistence?.clear().catch(() => undefined);
    }

    return unfinished.length;
  }

  /**
   * Mirror the current queue state into the persistence adapter, if any.
   * Failures are swallowed: persistence must never break submission flow.
   */
  private async persistSnapshot(): Promise<void> {
    if (!this.persistence) return;
    try {
      await this.persistence.save({
        steps: this.stepStates.map((s) => ({ ...s })),
        savedAt: Date.now(),
      });
    } catch {
      // Persistence is best-effort; ignore adapter write failures.
    }
  }

  /** Record a durable status transition for a step and persist it. */
  private markPersisted(
    index: number,
    step: QueueStep,
    status: PersistedQueueStep["status"],
    extra?: { hash?: string; resourceFee?: string }
  ): void {
    this.stepStates[index] = {
      xdr: step.xdr,
      status,
      hash: extra?.hash ?? this.stepStates[index]?.hash,
      resourceFee: extra?.resourceFee ?? this.stepStates[index]?.resourceFee,
      stepTimeoutMs: step.stepTimeoutMs ?? this.stepStates[index]?.stepTimeoutMs,
    };
    void this.persistSnapshot();
  }

  /**
   * Execute all enqueued steps in order.
   *
   * For each step:
   *   1. Emits `pending`.
   *   2. Signs the XDR via the configured signer.
   *   3. Simulates the signed transaction via `rpc.simulateTransaction` (unless
   *      `skipSimulation` is true). Emits `simulated` on success.
   *   4. In `dryRun` mode, stops here and does not submit. Emits a `confirmed`
   *      event with `dryRun: true` and no hash to mark the step complete.
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
    this.stepStates = [];
    // Every enqueued step reached a durable outcome — clear the restart state.
    await this.persistence?.clear().catch(() => undefined);
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
    const work = () => this.executeStep(i, step, isDryRun, skipSimulation, completed);
    let executionStarted = false;
    let timeoutTriggered = false;

    const guardedWork =
      this.rpc.getAccountSequence && !isDryRun
        ? async () => {
            const parsed = TransactionBuilder.fromXDR(step.xdr, this.networkPassphrase);
            const transaction =
              parsed instanceof FeeBumpTransaction
                ? parsed.innerTransaction
                : (parsed as Transaction);
            const lockKey = `${this.networkPassphrase}:${transaction.source}`;
            return withAccountSequenceLock(lockKey, async () => {
              if (timeoutTriggered) {
                executionStarted = true;
                throw new NetworkError(
                  `Step ${i} timed out before sequence validation completed.`,
                  {
                    step: i,
                    timeout: timeoutMs,
                  }
                );
              }
              const account = await this.rpc.getAccountSequence!(transaction.source);
              if (timeoutTriggered) {
                executionStarted = true;
                throw new NetworkError(`Step ${i} timed out before transaction signing.`, {
                  step: i,
                  timeout: timeoutMs,
                });
              }
              const expectedSequence = BigInt(account.sequence) + 1n;
              if (BigInt(transaction.sequence) !== expectedSequence) {
                throw new NetworkError(
                  `Transaction sequence is stale or out of order for ${transaction.source}: expected ${expectedSequence}, got ${transaction.sequence}. Refresh the account and rebuild the transaction.`,
                  {
                    accountId: transaction.source,
                    ledger: account.ledger,
                    expectedSequence: expectedSequence.toString(),
                    actualSequence: transaction.sequence,
                  }
                );
              }
              executionStarted = true;
              return work();
            });
          }
        : async () => {
            executionStarted = true;
            return work();
          };

    try {
      if (timeoutMs !== undefined) {
        await this.withTimeout(guardedWork(), timeoutMs, async () => {
          timeoutTriggered = true;
          const error = `Step ${i} timed out after ${timeoutMs}ms`;
          this.emit({ index: i, xdr: step.xdr, status: "failed", error });
          await this.runRollbacks(completed);
          throw new NetworkError(error, { step: i, timeout: timeoutMs });
        });
      } else {
        await guardedWork();
      }
    } catch (error) {
      if (!executionStarted && !timeoutTriggered) {
        const message = error instanceof Error ? error.message : String(error);
        this.emit({ index: i, xdr: step.xdr, status: "failed", error: message });
        await this.runRollbacks(completed);
      }
      throw error;
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
      this.markPersisted(i, step, "simulated", { resourceFee });
      this.emit({ index: i, xdr: step.xdr, status: "simulated", resourceFee });
    }

    // ── 3. Dry-run exit ──────────────────────────────────────────────────────
    if (isDryRun) {
      // Simulation succeeded; report a dry-run "confirmed" (no hash was
      // produced) so callers can track the step without mistaking it for a
      // real on-chain confirmation.
      this.emit({ index: i, xdr: step.xdr, status: "confirmed", resourceFee, dryRun: true });
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
    this.markPersisted(i, step, "submitted", { hash, resourceFee });

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
    this.markPersisted(i, step, "confirmed", { hash, resourceFee });
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
