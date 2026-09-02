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
import { serializationRetriesTotal } from "../metrics";

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

    if (sql.startsWith("UPDATE raw_events") && sql.includes("SET processed_at")) {
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

class ConflictOncePool implements PgPoolLike {
  readonly committed = { value: emptyStore() };
  readonly beginStatements: string[] = [];
  private conflictPending: boolean;

  constructor(conflictPending = true) {
    this.conflictPending = conflictPending;
  }

  async connect(): Promise<PgClientLike> {
    const delegate = new FakeClient(this.committed);
    return {
      query: async (text: string, params?: unknown[]) => {
        if (text.startsWith("BEGIN")) {
          this.beginStatements.push(text);
          if (this.conflictPending) {
            this.conflictPending = false;
            const error = new Error("serialization failure") as Error & { code: string };
            error.code = "40001";
            throw error;
          }
        }
        return delegate.query(text, params);
      },
      release: () => delegate.release(),
    };
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

  it("invokes onCommit with the new cursor only after a durable commit", async () => {
    const pool = new FakePool();
    const commits: number[] = [];

    const pipeline = new IngestPipeline(pool, {
      streamId: "C123",
      bus: new EventBus(),
      domainProcessor: postProcessor({ value: true }), // crash first
      onCommit: (cursor) => {
        commits.push(cursor);
      },
    });

    const batch = [makeEvent(40, 0, "heidi")];
    await expect(pipeline.processBatch(batch)).rejects.toThrow();
    expect(commits).toEqual([]); // not invoked on rollback — no root emission

    await pipeline.processBatch(batch);
    expect(commits).toEqual([40]); // invoked exactly once, after commit
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

  it("retries a serializable transaction after SQLSTATE 40001", async () => {
    const pool = new ConflictOncePool();
    const backoffs: number[] = [];
    serializationRetriesTotal.reset();
    const pipeline = new IngestPipeline(pool, {
      streamId: "C123",
      bus: new EventBus(),
      transactionIsolation: "serializable",
      serializationRetryAttempts: 3,
      sleep: async (ms) => backoffs.push(ms),
      domainProcessor: postProcessor({ value: false }),
    });

    const result = await pipeline.processBatch([makeEvent(50, 0, "frank")]);

    expect(result.committed).toBe(true);
    expect(pool.beginStatements).toEqual([
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
      "BEGIN ISOLATION LEVEL SERIALIZABLE",
    ]);
    expect(backoffs).toEqual([50]);
    expect(serializationRetriesTotal.getValue()).toBe(1);
    expect(pool.committed.value.raw.size).toBe(1);
  });

  it("uses READ COMMITTED for ordinary batches", async () => {
    const pool = new ConflictOncePool(false);
    const pipeline = new IngestPipeline(pool, {
      streamId: "C123",
      bus: new EventBus(),
      domainProcessor: postProcessor({ value: false }),
    });

    await pipeline.processBatch([makeEvent(60, 0, "gina")]);

    expect(pool.beginStatements).toEqual(["BEGIN ISOLATION LEVEL READ COMMITTED"]);
  });
});

// ---------------------------------------------------------------------------
// Integration tests: tip and like handlers through the pipeline
//
// These tests verify that tip/like events commit atomically within the
// pipeline batch — no handler-level BEGIN/COMMIT, no premature commit,
// and rollback reverts every write including tip/like rows.
// ---------------------------------------------------------------------------

import { createDomainProcessor } from "../domain-processor";
import { Database } from "../db";
import { NotificationService } from "../notifications/service";

type TipLikeStore = {
  raw: Map<string, IngestEvent>;
  tips: Map<string, { post_id: string; tipper: string; amount: string; tx_hash: string }>;
  likes: Map<string, { post_id: string; user_address: string; tx_hash: string }>;
  posts: Map<string, { id: string; tip_total: bigint; like_count: bigint }>;
  cursor: Map<string, number>;
};

function emptyTipLikeStore(): TipLikeStore {
  return {
    raw: new Map(),
    tips: new Map(),
    likes: new Map(),
    posts: new Map(),
    cursor: new Map(),
  };
}

function cloneTipLikeStore(s: TipLikeStore): TipLikeStore {
  return {
    raw: new Map(s.raw),
    tips: new Map(s.tips),
    likes: new Map(s.likes),
    posts: new Map(s.posts),
    cursor: new Map(s.cursor),
  };
}

class TipLikeFakeClient implements PgClientLike {
  private overlay: TipLikeStore | null = null;

  constructor(private readonly committed: { value: TipLikeStore; log: string[] }) {}

  private active(): TipLikeStore {
    return this.overlay ?? this.committed.value;
  }

  async query(text: string, params: unknown[] = []): Promise<QueryResultLike> {
    const sql = text.trim();
    // Log is stored outside the transactional store so every SQL statement
    // (including COMMIT itself) is captured regardless of transaction state.
    this.committed.log.push(sql.split("\n")[0].trim());

    if (sql.startsWith("BEGIN")) {
      this.overlay = cloneTipLikeStore(this.committed.value);
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
      if (store.raw.has(key)) return { rowCount: 0, rows: [] };
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

    if (sql.startsWith("INSERT INTO tips")) {
      const tx_hash = String(params[5]);
      const store = this.active();
      if (store.tips.has(tx_hash)) return { rowCount: 0, rows: [] };
      store.tips.set(tx_hash, {
        post_id: String(params[0]),
        tipper: String(params[1]),
        amount: String(params[2]),
        tx_hash,
      });
      return { rowCount: 1, rows: [{ id: store.tips.size }] };
    }

    if (sql.startsWith("INSERT INTO likes")) {
      const post_id = String(params[0]);
      const user_address = String(params[1]);
      const key = `${post_id}:${user_address}`;
      const store = this.active();
      if (store.likes.has(key)) return { rowCount: 0, rows: [] };
      store.likes.set(key, { post_id, user_address, tx_hash: String(params[3]) });
      return { rowCount: 1, rows: [{ id: store.likes.size }] };
    }

    if (sql.startsWith("UPDATE posts") && sql.includes("tip_total")) {
      // tip_total += amount for the given post_id
      const amount = BigInt(String(params[0]));
      const post_id = String(params[1]);
      const store = this.active();
      const row = store.posts.get(post_id) ?? { id: post_id, tip_total: 0n, like_count: 0n };
      store.posts.set(post_id, { ...row, tip_total: row.tip_total + amount });
      return { rowCount: 1, rows: [] };
    }

    if (sql.startsWith("UPDATE posts") && sql.includes("like_count")) {
      const post_id = String(params[0]);
      const store = this.active();
      const row = store.posts.get(post_id) ?? { id: post_id, tip_total: 0n, like_count: 0n };
      store.posts.set(post_id, { ...row, like_count: row.like_count + 1n });
      return { rowCount: 1, rows: [] };
    }

    if (sql.startsWith("UPDATE raw_events") && sql.includes("SET processed_at")) {
      return { rowCount: 1, rows: [] };
    }

    if (sql.startsWith("INSERT INTO indexer_cursor")) {
      const store = this.active();
      const streamId = String(params[0]);
      const next = Number(params[1]);
      const prev = store.cursor.get(streamId) ?? 0;
      store.cursor.set(streamId, Math.max(prev, next));
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

    // Ignore notification-related queries (sent_notifications, device_tokens, etc.)
    if (
      sql.startsWith("SELECT") ||
      sql.startsWith("INSERT INTO sent_notifications") ||
      sql.startsWith("INSERT INTO device_tokens") ||
      sql.startsWith("SELECT") ||
      sql.toLowerCase().includes("device_token") ||
      sql.toLowerCase().includes("sent_notification")
    ) {
      return { rowCount: 0, rows: [] };
    }

    throw new Error(`TipLikeFakeClient: unhandled SQL: ${sql}`);
  }

  release(): void {
    /* no-op */
  }
}

class TipLikeFakePool implements PgPoolLike {
  readonly committed = { value: emptyTipLikeStore(), log: [] as string[] };
  async connect(): Promise<PgClientLike> {
    return new TipLikeFakeClient(this.committed);
  }
}

function makeTipEvent(ledger: number, index: number, postId: string, txHash: string): IngestEvent {
  return {
    ledgerSequence: ledger,
    eventIndex: index,
    contractId: "C123",
    type: "tip",
    topic: ["tip"],
    data: {
      tipper: "GTIPPER1111111111111111111111111111111111111111111",
      post_id: postId,
      amount: "1000000",
      fee: "25000",
      tx_hash: txHash,
    },
  };
}

function makeLikeEvent(ledger: number, index: number, postId: string, txHash: string): IngestEvent {
  return {
    ledgerSequence: ledger,
    eventIndex: index,
    contractId: "C123",
    type: "like",
    topic: ["like"],
    data: {
      user: "GLIKER1111111111111111111111111111111111111111111111",
      post_id: postId,
      tx_hash: txHash,
    },
  };
}

/** Minimal notification-service stub that does nothing. */
const noopNotificationService = {
  sendPushNotification: async () => {},
  getDeviceTokens: async () => [],
} as unknown as NotificationService;

describe("IngestPipeline — tip/like batch atomicity", () => {
  it("commits tip and like writes atomically within a single pipeline batch", async () => {
    const pool = new TipLikeFakePool();

    const domainProcessor = createDomainProcessor(
      pool as never,
      noopNotificationService
    );

    const pipeline = new IngestPipeline(pool, {
      streamId: "C123",
      bus: new EventBus(),
      domainProcessor,
    });

    const batch = [
      makeTipEvent(100, 0, "42", "0xabc001"),
      makeLikeEvent(100, 1, "42", "0xabc002"),
    ];

    const result = await pipeline.processBatch(batch);

    expect(result.committed).toBe(true);
    expect(result.cursor).toBe(100);

    // Both raw events persisted.
    expect(pool.committed.value.raw.size).toBe(2);

    // Tip row committed.
    expect(pool.committed.value.tips.size).toBe(1);
    const tip = pool.committed.value.tips.get("0xabc001")!;
    expect(tip.post_id).toBe("42");
    expect(tip.amount).toBe("1000000");

    // Like row committed.
    expect(pool.committed.value.likes.size).toBe(1);

    // Post counters updated.
    const post = pool.committed.value.posts.get("42")!;
    expect(post.tip_total).toBe(1000000n);
    expect(post.like_count).toBe(1n);

    // Cursor advanced.
    expect(pool.committed.value.cursor.get("C123")).toBe(100);
  });

  it("rolls back tip and like writes when the batch fails mid-flight", async () => {
    const pool = new TipLikeFakePool();
    let callCount = 0;

    // Crash after the tip but before the like.
    const crashingProcessor: DomainProcessor = async (client, event) => {
      callCount += 1;
      if (callCount === 1) {
        // Process the tip normally via the real domain processor.
        const real = createDomainProcessor(pool as never, noopNotificationService);
        await real(client, event);
      } else {
        throw new Error("simulated crash on like event");
      }
    };

    const pipeline = new IngestPipeline(pool, {
      streamId: "C123",
      bus: new EventBus(),
      domainProcessor: crashingProcessor,
    });

    const batch = [
      makeTipEvent(100, 0, "42", "0xabc001"),
      makeLikeEvent(100, 1, "42", "0xabc002"),
    ];

    await expect(pipeline.processBatch(batch)).rejects.toThrow(/simulated crash/);

    // Nothing persisted — the entire batch including the tip rolled back.
    expect(pool.committed.value.raw.size).toBe(0);
    expect(pool.committed.value.tips.size).toBe(0);
    expect(pool.committed.value.likes.size).toBe(0);
    expect(pool.committed.value.cursor.get("C123")).toBeUndefined();
  });

  it("does not issue nested BEGIN or COMMIT inside a pipeline batch", async () => {
    const pool = new TipLikeFakePool();

    const domainProcessor = createDomainProcessor(
      pool as never,
      noopNotificationService
    );

    const pipeline = new IngestPipeline(pool, {
      streamId: "C123",
      bus: new EventBus(),
      domainProcessor,
    });

    await pipeline.processBatch([
      makeTipEvent(100, 0, "42", "0xabc001"),
      makeLikeEvent(100, 1, "42", "0xabc002"),
    ]);

    const log = pool.committed.log;
    const begins = log.filter((s) => s.startsWith("BEGIN"));
    const commits = log.filter((s) => s.startsWith("COMMIT"));

    // Exactly one BEGIN and one COMMIT — from the pipeline, not the handlers.
    expect(begins).toHaveLength(1);
    expect(commits).toHaveLength(1);
  });

  it("is idempotent when the tip/like batch is replayed after commit", async () => {
    const pool = new TipLikeFakePool();

    const domainProcessor = createDomainProcessor(
      pool as never,
      noopNotificationService
    );

    const pipeline = new IngestPipeline(pool, {
      streamId: "C123",
      bus: new EventBus(),
      domainProcessor,
    });

    const batch = [
      makeTipEvent(100, 0, "42", "0xabc001"),
      makeLikeEvent(100, 1, "42", "0xabc002"),
    ];

    await pipeline.processBatch(batch);
    const second = await pipeline.processBatch(batch); // replay

    expect(second.inserted).toBe(0); // raw ON CONFLICT skipped both

    // Still exactly one tip and one like — no duplicates.
    expect(pool.committed.value.tips.size).toBe(1);
    expect(pool.committed.value.likes.size).toBe(1);

    // Post counters not double-counted.
    const post = pool.committed.value.posts.get("42")!;
    expect(post.tip_total).toBe(1000000n);
    expect(post.like_count).toBe(1n);
  });
});
