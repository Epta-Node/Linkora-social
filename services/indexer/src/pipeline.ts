/**
 * Exactly-once ingestion pipeline.
 *
 * Each batch is processed inside a SINGLE serialisable transaction:
 *
 *   1. INSERT every event into the `raw_events` staging table, idempotent via
 *      `ON CONFLICT (ledger_sequence, event_index) DO NOTHING`.
 *   2. Project each event into the domain tables (posts, follows, …) via the
 *      injected `domainProcessor`, which MUST use the same transaction client.
 *   3. Stamp `raw_events.processed_at` and advance `indexer_state.processed_cursor`.
 *   4. COMMIT.
 *
 * Because the raw ingest, the domain write, and the cursor bump all live in
 * the same transaction, a crash at any point rolls back the entire batch. On
 * restart the batch is re-fetched from the (un-advanced) cursor and replayed;
 * the `ON CONFLICT` clause plus idempotent domain handlers guarantee no
 * duplicate domain rows — exactly-once semantics.
 *
 * The pg types are narrowed to small structural interfaces so the pipeline can
 * be unit-tested against an in-memory fake without a live database.
 */

import { EventBus, BusEvent } from "./bus";

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
export type DomainProcessor = (
  client: PgClientLike,
  event: IngestEvent
) => Promise<void>;

export interface IngestPipelineOptions {
  /** Stream identity for the cursor row (typically the contract id). */
  streamId: string;
  bus: EventBus;
  domainProcessor?: DomainProcessor;
}

export interface BatchResult {
  committed: boolean;
  /** Cursor value after this batch (unchanged if nothing committed). */
  cursor: number;
  /** Number of raw rows newly inserted (excludes ON CONFLICT skips). */
  inserted: number;
}

const noopProcessor: DomainProcessor = async () => {
  /* default: no domain projection wired — overridden in production */
};

export class IngestPipeline {
  private readonly pool: PgPoolLike;
  private readonly streamId: string;
  private readonly bus: EventBus;
  private readonly domainProcessor: DomainProcessor;

  constructor(pool: PgPoolLike, opts: IngestPipelineOptions) {
    this.pool = pool;
    this.streamId = opts.streamId;
    this.bus = opts.bus;
    this.domainProcessor = opts.domainProcessor ?? noopProcessor;
  }

  /** Read the last committed cursor for this stream (0 if none). */
  async readCursor(): Promise<number> {
    const client = await this.pool.connect();
    try {
      const res = await client.query(
        "SELECT processed_cursor FROM indexer_state WHERE id = $1",
        [this.streamId]
      );
      const row = res.rows[0] as { processed_cursor?: number | string } | undefined;
      if (!row || row.processed_cursor === undefined) return 0;
      return Number(row.processed_cursor);
    } finally {
      client.release();
    }
  }

  /**
   * Process one batch transactionally. Returns once committed (and after the
   * events have been published to the bus). On any error the transaction is
   * rolled back and the error rethrown — nothing is persisted or published.
   */
  async processBatch(events: IngestEvent[]): Promise<BatchResult> {
    if (events.length === 0) {
      return { committed: false, cursor: await this.readCursor(), inserted: 0 };
    }

    const client = await this.pool.connect();
    let inserted = 0;
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");

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

      // (3) Mark processed and advance the cursor — the LAST statements before
      //     commit, so the cursor never moves ahead of a committed domain write.
      for (const ev of events) {
        await client.query(
          `UPDATE raw_events SET processed_at = NOW()
           WHERE ledger_sequence = $1 AND event_index = $2`,
          [ev.ledgerSequence, ev.eventIndex]
        );
      }

      const newCursor = events.reduce((m, e) => Math.max(m, e.ledgerSequence), 0);
      await client.query(
        `INSERT INTO indexer_state (id, processed_cursor)
         VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE
           SET processed_cursor = GREATEST(indexer_state.processed_cursor, EXCLUDED.processed_cursor),
               updated_at = NOW()`,
        [this.streamId, newCursor]
      );

      await client.query("COMMIT");

      // (4) Fan out only after the durable commit.
      for (const ev of events) {
        this.bus.publish(toBusEvent(ev));
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
