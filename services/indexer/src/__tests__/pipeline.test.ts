/**
 * Exactly-once pipeline tests.
 *
 * Uses an in-memory fake of pg's Pool/Client that enforces:
 *   - PRIMARY KEY (ledger_sequence, event_index) with ON CONFLICT DO NOTHING
 *   - real transaction isolation (writes are staged in an overlay and only
 *     merged into the committed store on COMMIT; discarded on ROLLBACK)
 *
 * That lets us reproduce a crash *between* the raw ingest and the domain write
 * and prove that no duplicate domain rows survive on restart.
 */

import { EventBus } from "../bus";
import {
  IngestPipeline,
  IngestEvent,
  DomainProcessor,
  PgClientLike,
  PgPoolLike,
  QueryResultLike,
} from "../pipeline";

type Store = {
  raw: Map<string, IngestEvent>;
  posts: Map<string, { id: string; author: string }>;
  cursor: Map<string, number>;
};

function emptyStore(): Store {
  return { raw: new Map(), posts: new Map(), cursor: new Map() };
}

function cloneStore(s: Store): Store {
  return {
    raw: new Map(s.raw),
    posts: new Map(s.posts),
    cursor: new Map(s.cursor),
  };
}

class FakeClient implements PgClientLike {
  private overlay: Store | null = null;

  constructor(private readonly committed: { value: Store }) {}

  private active(): Store {
    return this.overlay ?? this.committed.value;
  }

  async query(text: string, params: unknown[] = []): Promise<QueryResultLike> {
    const sql = text.trim();

    if (sql.startsWith("BEGIN")) {
      this.overlay = cloneStore(this.committed.value);
      return { rowCount: 0, rows: [] };
    }
    if (sql.startsWith("COMMIT")) {
      if (this.overlay) this.committed.value = this.overlay;
      this.overlay = null;
      return { rowCount: 0, rows: [] };
    }
    if (sql.startsWith("ROLLBACK")) {
      this.overlay = null;
      return { rowCount: 0, rows: [] };
    }

    if (sql.startsWith("INSERT INTO raw_events")) {
      const key = `${params[0]}-${params[1]}`;
      const store = this.active();
      if (store.raw.has(key)) return { rowCount: 0, rows: [] }; // ON CONFLICT DO NOTHING
      store.raw.set(key, {
        ledgerSequence: Number(params[0]),
        eventIndex: Number(params[1]),
        contractId: String(params[2]),
        topic: params[3] as string[],
        type: (params[3] as string[])[0] ?? "unknown",
        data: params[4],
      });
      return { rowCount: 1, rows: [] };
    }

    if (sql.startsWith("INSERT INTO posts")) {
      const id = String(params[0]);
      const store = this.active();
      if (store.posts.has(id)) return { rowCount: 0, rows: [] }; // ON CONFLICT DO NOTHING
      store.posts.set(id, { id, author: String(params[1]) });
      return { rowCount: 1, rows: [] };
    }

    if (sql.startsWith("UPDATE raw_events SET processed_at")) {
      return { rowCount: 1, rows: [] };
    }

    if (sql.startsWith("INSERT INTO indexer_cursor")) {
      const store = this.active();
      const streamId = String(params[0]);
      const next = Number(params[1]);
      const prev = store.cursor.get(streamId) ?? 0;
      store.cursor.set(streamId, Math.max(prev, next)); // GREATEST(...)
      return { rowCount: 1, rows: [] };
    }

    if (sql.startsWith("SELECT processed_cursor FROM indexer_cursor")) {
      const streamId = String(params[0]);
      const value = this.active().cursor.get(streamId);
      return {
        rowCount: value === undefined ? 0 : 1,
        rows: value === undefined ? [] : [{ processed_cursor: value }],
      };
    }

    throw new Error(`FakeClient: unhandled SQL: ${sql}`);
  }

  release(): void {
    /* no-op */
  }
}

class FakePool implements PgPoolLike {
  readonly committed = { value: emptyStore() };
  async connect(): Promise<PgClientLike> {
    return new FakeClient(this.committed);
  }
}

function makeEvent(ledger: number, index: number, author: string): IngestEvent {
  return {
    ledgerSequence: ledger,
    eventIndex: index,
    contractId: "C123",
    type: "PostCreated",
    topic: ["PostCreated"],
    data: { author },
  };
}

// A domain processor that projects PostCreated into the posts table, with an
// optional one-shot "crash" injected between the raw ingest and this write.
function postProcessor(crashOnce: { value: boolean }): DomainProcessor {
  return async (client, event) => {
    if (crashOnce.value) {
      crashOnce.value = false;
      throw new Error("simulated crash before domain write");
    }
    const author = (event.data as { author: string }).author;
    await client.query(
      `INSERT INTO posts (id, author) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [`${event.ledgerSequence}:${event.eventIndex}`, author]
    );
  };
}

describe("IngestPipeline — exactly-once", () => {
  it("commits raw + domain + cursor atomically", async () => {
    const pool = new FakePool();
    const pipeline = new IngestPipeline(pool, {
      streamId: "C123",
      bus: new EventBus(),
      domainProcessor: postProcessor({ value: false }),
    });

    const res = await pipeline.processBatch([makeEvent(10, 0, "alice")]);

    expect(res.committed).toBe(true);
    expect(res.cursor).toBe(10);
    expect(pool.committed.value.raw.size).toBe(1);
    expect(pool.committed.value.posts.size).toBe(1);
    expect(pool.committed.value.cursor.get("C123")).toBe(10);
  });

  it("rolls back the raw ingest when the domain write crashes", async () => {
    const pool = new FakePool();
    const crash = { value: true };
    const pipeline = new IngestPipeline(pool, {
      streamId: "C123",
      bus: new EventBus(),
      domainProcessor: postProcessor(crash),
    });

    await expect(pipeline.processBatch([makeEvent(10, 0, "alice")])).rejects.toThrow(
      /simulated crash/
    );

    // Nothing persisted: raw, domain, and cursor all rolled back together.
    expect(pool.committed.value.raw.size).toBe(0);
    expect(pool.committed.value.posts.size).toBe(0);
    expect(pool.committed.value.cursor.get("C123")).toBeUndefined();
  });

  it("produces no duplicate domain rows on restart after a crash", async () => {
    const pool = new FakePool();
    const crash = { value: true };
    const pipeline = new IngestPipeline(pool, {
      streamId: "C123",
      bus: new EventBus(),
      domainProcessor: postProcessor(crash),
    });

    const batch = [makeEvent(10, 0, "alice"), makeEvent(10, 1, "bob")];

    // First attempt crashes mid-batch and rolls back entirely.
    await expect(pipeline.processBatch(batch)).rejects.toThrow();
    expect(pool.committed.value.posts.size).toBe(0);

    // Restart: replay the same batch — succeeds this time.
    const res = await pipeline.processBatch(batch);
    expect(res.committed).toBe(true);

    // Exactly two posts, two raw rows — no duplicates despite the replay.
    expect(pool.committed.value.posts.size).toBe(2);
    expect(pool.committed.value.raw.size).toBe(2);
    expect(pool.committed.value.cursor.get("C123")).toBe(10);
  });

  it("is idempotent when the identical batch is replayed after commit", async () => {
    const pool = new FakePool();
    const pipeline = new IngestPipeline(pool, {
      streamId: "C123",
      bus: new EventBus(),
      domainProcessor: postProcessor({ value: false }),
    });

    const batch = [makeEvent(20, 0, "carol")];
    await pipeline.processBatch(batch);
    const second = await pipeline.processBatch(batch); // duplicate delivery

    expect(second.inserted).toBe(0); // raw ON CONFLICT skipped
    expect(pool.committed.value.posts.size).toBe(1);
    expect(pool.committed.value.raw.size).toBe(1);
  });

  it("publishes to the bus only after commit", async () => {
    const pool = new FakePool();
    const busInstance = new EventBus();
    const received: number[] = [];
    busInstance.onAny((e) => received.push(e.ledgerSequence));

    const pipeline = new IngestPipeline(pool, {
      streamId: "C123",
      bus: busInstance,
      domainProcessor: postProcessor({ value: true }), // crash first
    });

    const batch = [makeEvent(30, 0, "dave")];
    await expect(pipeline.processBatch(batch)).rejects.toThrow();
    expect(received).toEqual([]); // nothing published on rollback

    await pipeline.processBatch(batch);
    expect(received).toEqual([30]); // published exactly once, after commit
  });

  it("readCursor reflects the last committed cursor", async () => {
    const pool = new FakePool();
    const pipeline = new IngestPipeline(pool, {
      streamId: "C123",
      bus: new EventBus(),
      domainProcessor: postProcessor({ value: false }),
    });

    expect(await pipeline.readCursor()).toBe(0);
    await pipeline.processBatch([makeEvent(42, 0, "erin")]);
    expect(await pipeline.readCursor()).toBe(42);
  });
});
