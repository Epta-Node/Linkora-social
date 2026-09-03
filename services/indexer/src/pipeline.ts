/**
 * Exactly-once ingestion pipeline.
 *
 * Each batch is processed inside a SINGLE transaction:
 *
 *   1. INSERT every event into the `raw_events` staging table, idempotent via
 *      `ON CONFLICT (ledger_sequence, event_index) DO NOTHING`.
 *   2. Project each event into the domain tables (posts, follows, …) via
 *      the injected `domainProcessor`, which MUST use the same transaction client.
 *   3. Stamp `raw_events.processed_at` and advance `indexer_cursor.processed_cursor`.
 *   4. COMMIT.
 *
 * Ordinary batches use READ COMMITTED because the raw and domain writes are
 * idempotent. Callers that require SERIALIZABLE can opt in and receive bounded
 * retries for PostgreSQL serialization failures and deadlocks.
 *
 * The pg types are narrowed to small structural interfaces so the pipeline can
 * be unit-tested against an in-memory fake without a live database.
 */

import { EventBus, BusEvent } from "./bus";
import { serializationRetriesTotal } from "./metrics";

export interface QueryResultLike {
  rowCount: number | null;
  rows: unknown[];
}

export interface PgClientLike {
  query(text: string, params?: unknown[]): Promise<QueryResultLike>;
  release(): void;
}

export interface PgPoolLike {
  connect(): Promise<PgClientLike>;
}

/** Normalised event flowing through the pipeline. */
export interface IngestEvent {
  ledgerSequence: number;
  eventIndex: number;
  contractId: string;
  /** Contract event type — topic[0]. */
  type: string;
  topic: string[];
  /** Decoded (or raw) event body, stored as JSONB. */
  data: unknown;
}

/**
 * Projects a single raw event into the domain tables. MUST issue all its
 * writes through the provided transaction client so they commit atomically
 * with the raw ingest and cursor advance. MUST be idempotent (safe to replay).
 */
export type DomainProcessor = (client: PgClientLike, event: IngestEvent) => Promise<void>;

export type TransactionIsolation = "read committed" | "serializable";

export interface IngestPipelineOptions {
  /** Stream identity for the cursor row (typically the contract id). */
  streamId: string;
  bus: EventBus;
  domainProcessor?: DomainProcessor;
  /** READ COMMITTED by default. Use SERIALIZABLE only for handlers that need it. */
  transactionIsolation?: TransactionIsolation;
  /** Maximum total attempts for explicitly serializable transactions. */
  serializationRetryAttempts?: number;
  /** Injectable delay for deterministic retry tests. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Invoked with the new cursor strictly AFTER the batch's transaction has
   * committed. Used to publish commit-aligned metrics (e.g. the state root)
   * that must never reflect a partially-applied or rolled-back batch. Never
   * called when the transaction rolls back.
   *
   * `events` contains exactly the events that were committed in this batch,
   * enabling O(batch_size) incremental state-root updates without full-table
   * scans.
   */
  onCommit?: (cursor: number, events: IngestEvent[]) => Promise<void> | void;
}

export interface BatchResult {
  committed: boolean;
  /** Cursor value after this batch (unchanged if nothing committed). */
  cursor: number;
  /** Number of raw rows newly inserted (excludes ON CONFLICT skips). */
  inserted: number;
}

const DEFAULT_SERIALIZATION_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_MS = 50;

const noopProcessor: DomainProcessor = async () => {
  /* default: no domain projection wired — overridden in production */
};

export function isSerializationConflict(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "40001" || code === "40P01";
}

/**
 * Retry a serializable transaction after PostgreSQL serialization failures and
 * deadlocks. The operation must open a fresh transaction for every attempt.
 */
export async function withSerializationRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: {
    maxAttempts?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {}
): Promise<T> {
  const maxAttempts = Math.max(
    1,
    Math.floor(options.maxAttempts ?? DEFAULT_SERIALIZATION_ATTEMPTS)
  );
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (!isSerializationConflict(error) || attempt >= maxAttempts) {
        throw error;
      }

      const delayMs = DEFAULT_RETRY_BASE_MS * 2 ** (attempt - 1);
      serializationRetriesTotal.inc();
      console.warn(
        JSON.stringify({
          metric: "serialization_retry",
          attempt,
          nextAttempt: attempt + 1,
          maxAttempts,
          delayMs,
          code: (error as { code?: unknown }).code,
        })
      );
      await sleep(delayMs);
    }
  }
}

export class IngestPipeline {
  private readonly pool: PgPoolLike;
  private readonly streamId: string;
  private readonly bus: EventBus;
  private readonly domainProcessor: DomainProcessor;
  private readonly transactionIsolation: TransactionIsolation;
  private readonly serializationRetryAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onCommit?: (cursor: number, events: IngestEvent[]) => Promise<void> | void;

  constructor(pool: PgPoolLike, opts: IngestPipelineOptions) {
    this.pool = pool;
    this.streamId = opts.streamId;
    this.bus = opts.bus;
    this.domainProcessor = opts.domainProcessor ?? noopProcessor;
    this.transactionIsolation = opts.transactionIsolation ?? "read committed";
    this.serializationRetryAttempts = Math.max(
      1,
      Math.floor(opts.serializationRetryAttempts ?? DEFAULT_SERIALIZATION_ATTEMPTS)
    );
    this.sleep =
      opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.onCommit = opts.onCommit;
  }

  /** Read the last committed cursor for this stream (0 if none). */
  async readCursor(): Promise<number> {
    const client = await this.pool.connect();
    try {
      const res = await client.query("SELECT processed_cursor FROM indexer_cursor WHERE id = $1", [
        this.streamId,
      ]);
      const row = res.rows[0] as { processed_cursor?: number | string } | undefined;
      if (!row || row.processed_cursor === undefined) return 0;
      return Number(row.processed_cursor);
    } finally {
      client.release();
    }
  }

  /** Process one batch with the configured transaction isolation. */
  async processBatch(events: IngestEvent[]): Promise<BatchResult> {
    if (events.length === 0) {
      return { committed: false, cursor: await this.readCursor(), inserted: 0 };
    }

    if (this.transactionIsolation === "serializable") {
      return withSerializationRetry(() => this.processBatchOnce(events), {
        maxAttempts: this.serializationRetryAttempts,
        sleep: this.sleep,
      });
    }

    return this.processBatchOnce(events);
  }

  private async processBatchOnce(events: IngestEvent[]): Promise<BatchResult> {
    const client = await this.pool.connect();
    let inserted = 0;
    try {
      await client.query(
        this.transactionIsolation === "serializable"
          ? "BEGIN ISOLATION LEVEL SERIALIZABLE"
          : "BEGIN ISOLATION LEVEL READ COMMITTED"
      );

      // (1) Stage raw events — idempotent on the natural key.
      for (const ev of events) {
        const res = await client.query(
          `INSERT INTO raw_events
             (ledger_sequence, event_index, contract_id, topic, data)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (ledger_sequence, event_index) DO NOTHING`,
          [ev.ledgerSequence, ev.eventIndex, ev.contractId, ev.topic, JSON.stringify(ev.data)]
        );
        inserted += res.rowCount ?? 0;
      }

      // (2) Project into domain tables using the SAME transaction client.
      for (const ev of events) {
        await this.domainProcessor(client, ev);
      }

      // (3) Mark processed in a single bulk UPDATE — one round-trip instead of N.
      //     We pass all (ledger_sequence, event_index) pairs as a typed composite
      //     array and let PostgreSQL join against them.  This is the LAST write
      //     before commit so the cursor never advances ahead of a committed
      //     domain write.
      //
      //     SQL: UPDATE raw_events SET processed_at = NOW()
      //          WHERE (ledger_sequence, event_index) = ANY($1::record[])
      //
      //     The literal value fed to $1 is built as a Postgres array-of-rows
      //     string:  '{"(seq1,idx1)","(seq2,idx2)", …}'
      const pairs = events.map((ev) => `"(${ev.ledgerSequence},${ev.eventIndex})"`).join(",");
      await client.query(
        `UPDATE raw_events
            SET processed_at = NOW()
          WHERE (ledger_sequence, event_index) = ANY($1::record[])`,
        [`{${pairs}}`]
      );

      const newCursor = events.reduce((m, e) => Math.max(m, e.ledgerSequence), 0);
      await client.query(
        `INSERT INTO indexer_cursor (id, processed_cursor)
         VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE
           SET processed_cursor = GREATEST(indexer_cursor.processed_cursor, EXCLUDED.processed_cursor),
               updated_at = NOW()`,
        [this.streamId, newCursor]
      );

      await client.query("COMMIT");

      // (4) Fan out only after the durable commit.
      for (const ev of events) {
        this.bus.publish(toBusEvent(ev));
      }

      // (5) Commit-aligned side effects (e.g. state root publication) run
      // only once the batch is durably committed, never on rollback.
      if (this.onCommit) {
        await this.onCommit(newCursor, events);
      }

      return { committed: true, cursor: newCursor, inserted };
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackErr) {
        console.error("[pipeline] rollback failed:", rollbackErr);
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

function toBusEvent(ev: IngestEvent): BusEvent {
  return {
    type: ev.type,
    ledgerSequence: ev.ledgerSequence,
    eventIndex: ev.eventIndex,
    contractId: ev.contractId,
    topic: ev.topic,
    data: ev.data,
  };
}
