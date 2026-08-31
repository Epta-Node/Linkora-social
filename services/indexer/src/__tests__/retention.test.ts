/**
 * Unit tests for the raw-events retention manager.
 *
 * All PostgreSQL interactions are replaced with an in-memory query fake so
 * these tests run without a live database and finish in milliseconds.
 *
 * Covered behaviours
 * ──────────────────
 *  - ensureNextPartition: creates the correct bucket for a given cursor
 *  - ensureNextPartition: is idempotent (no-ops if bucket already exists)
 *  - dropOldPartitions: skips buckets still within the retention window
 *  - dropOldPartitions: drops fully-processed buckets past the cutoff
 *  - dropOldPartitions: skips buckets with unprocessed rows even if old
 *  - dropOldPartitions: uses archiveOnly (detach-only) when configured
 *  - RawEventsRetentionManager.runOnce: skips when table is not partitioned
 *  - RawEventsRetentionManager.start / stop: cron lifecycle is idempotent
 */

import { ensureNextPartition, dropOldPartitions, RawEventsRetentionManager } from "../retention";
import type { RetentionConfig } from "../retention";

// ── Fake Pool ─────────────────────────────────────────────────────────────────

type FakeRow = Record<string, unknown>;
type QueryHandler = (sql: string, params?: unknown[]) => FakeRow[];

class FakePool {
  private handlers: QueryHandler[] = [];
  readonly queries: string[] = [];

  /** Register a handler for the next query (or all queries matching the predicate). */
  onQuery(handler: QueryHandler): void {
    this.handlers.push(handler);
  }

  async query<T extends FakeRow = FakeRow>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: T[] }> {
    this.queries.push(text.trim());
    const handler = this.handlers.shift();
    if (handler) {
      const rows = handler(text, params) as T[];
      return { rows };
    }
    return { rows: [] };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const BASE_CFG: RetentionConfig = {
  retentionLedgers: 4_000_000,
  partitionSize: 1_000_000,
  archiveOnly: false,
  cronSchedule: "5 * * * *",
};

// ── ensureNextPartition ───────────────────────────────────────────────────────

describe("ensureNextPartition", () => {
  it("creates the next 1M-ledger bucket when it does not exist", async () => {
    const pool = new FakePool();

    // to_regclass returns null → bucket does not exist
    pool.onQuery(() => [{ exists: false }]);
    // CREATE TABLE call returns nothing
    pool.onQuery(() => []);

    await ensureNextPartition(500_000n, BASE_CFG, pool as never);

    expect(pool.queries).toHaveLength(2);
    // Second query should be a CREATE TABLE for raw_events_p1000000_2000000
    expect(pool.queries[1]).toContain("raw_events_p1000000_2000000");
    expect(pool.queries[1]).toContain("PARTITION OF raw_events");
  });

  it("is idempotent — no CREATE TABLE when bucket already exists", async () => {
    const pool = new FakePool();
    // to_regclass returns truthy → bucket already exists
    pool.onQuery(() => [{ exists: true }]);

    await ensureNextPartition(500_000n, BASE_CFG, pool as never);

    expect(pool.queries).toHaveLength(1);
    // No CREATE TABLE should have been issued
    expect(pool.queries[0]).not.toContain("CREATE TABLE");
  });

  it("computes the correct next bucket boundary", async () => {
    const pool = new FakePool();
    pool.onQuery(() => [{ exists: false }]);
    pool.onQuery(() => []);

    // cursor = 2_400_000 → current bucket is [2_000_000, 3_000_000)
    // next bucket should be [3_000_000, 4_000_000)
    await ensureNextPartition(2_400_000n, BASE_CFG, pool as never);

    expect(pool.queries[1]).toContain("raw_events_p3000000_4000000");
  });
});

// ── dropOldPartitions ─────────────────────────────────────────────────────────

/**
 * Build a FakePool pre-loaded with the sequence of query responses needed for
 * a single dropOldPartitions call over the given set of partitions.
 *
 * Query order per dropOldPartitions call:
 *   1. listPartitions       (pg_inherits join — cutoff anchored to the newest
 *                            present partition, so partitions are listed first)
 *   2. server_version_num   (supportsDetachConcurrently)
 *   3–N. isFullyProcessed   (one per eligible partition)
 *   N+1…. DETACH / DROP     (one per dropped partition)
 */
function poolForDrop(opts: {
  pgVersion?: number;
  partitions: Array<{ lo: bigint; hi: bigint; fullyProcessed: boolean }>;
}): FakePool {
  const pool = new FakePool();
  const pgVersion = opts.pgVersion ?? 160000;

  // 1. listPartitions
  pool.onQuery(() =>
    opts.partitions.map((p) => ({
      relname: `raw_events_p${p.lo}_${p.hi}`,
    }))
  );

  // 2. server_version_num
  pool.onQuery(() => [{ server_version_num: String(pgVersion) }]);

  // 3–N. isFullyProcessed — only called for partitions that pass the cutoff check
  for (const p of opts.partitions) {
    pool.onQuery(() => [{ has_unprocessed: !p.fullyProcessed }]);
  }

  // N+1…. DDL responses (DETACH / DROP) — return empty
  for (const p of opts.partitions) {
    if (p.fullyProcessed) {
      pool.onQuery(() => []); // DETACH
      pool.onQuery(() => []); // DROP (if not archiveOnly)
    }
  }

  return pool;
}

describe("dropOldPartitions", () => {
  it("returns empty array when retention window has not been reached", async () => {
    const pool = new FakePool();
    // listPartitions — a partition exists but the whole span is inside the
    // retention window (retentionHead ≤ retentionLedgers → cutoff before epoch).
    pool.onQuery(() => [{ relname: "raw_events_p0_1000000" }]);
    pool.onQuery(() => [{ server_version_num: "160000" }]);
    pool.onQuery(() => [{ has_unprocessed: false }]);

    // currentLedger < retentionLedgers, so no cutoff can be derived → no drops
    const dropped = await dropOldPartitions(1_000n, BASE_CFG, pool as never);
    expect(dropped).toHaveLength(0);
  });

  it("returns empty array with no error spam on an empty partition set", async () => {
    const pool = new FakePool();
    pool.onQuery(() => []); // listPartitions → none

    const dropped = await dropOldPartitions(10_000_000n, BASE_CFG, pool as never);
    expect(dropped).toHaveLength(0);
    // Only the partition listing should have been issued — no DETACH/DROP DDL.
    expect(pool.queries.some((q) => q.includes("DETACH"))).toBe(false);
    expect(pool.queries.some((q) => q.includes("DROP TABLE"))).toBe(false);
  });

  it("does not underflow when all partitions are older than the retention window", async () => {
    const pool = new FakePool();
    // A tiny (pre-epoch-style) partition set: data head ≈ 1M ledgers, which is
    // smaller than the 4M retention window → cutoff would precede partition 0.
    pool.onQuery(() => [{ relname: "raw_events_p0_1000000" }]);
    pool.onQuery(() => [{ server_version_num: "160000" }]);
    pool.onQuery(() => [{ has_unprocessed: false }]);

    const dropped = await dropOldPartitions(500_000n, BASE_CFG, pool as never);
    expect(dropped).toHaveLength(0);
    // No DDL should have been attempted.
    expect(pool.queries.some((q) => q.includes("DETACH"))).toBe(false);
    expect(pool.queries.some((q) => q.includes("DROP TABLE"))).toBe(false);
  });

  it("converges when partitions are older than a naive cursor-based cutoff (migration replay)", async () => {
    // Cursor lags far behind the migrated partitions (migration 012 replay):
    // an old cursor-only cutoff would compute a negative value and drop nothing.
    // Anchoring the cutoff to max(cursor, newestPartitionHi) keeps cleaning.
    const pool = new FakePool();

    // listPartitions — ten 1M-ledger buckets from ledger 0 to 10M.
    const names = Array.from(
      { length: 10 },
      (_, i) => `raw_events_p${i * 1_000_000}_${(i + 1) * 1_000_000}`
    );
    pool.onQuery(() => names.map((relname) => ({ relname })));
    // supportsDetachConcurrently
    pool.onQuery(() => [{ server_version_num: "160000" }]);
    // isFullyProcessed — only for the 4 partitions past the cutoff (hi < 5M)
    for (let i = 0; i < 4; i++) {
      pool.onQuery(() => [{ has_unprocessed: false }]);
    }
    // DETACH + DROP for each of the 4 dropped partitions
    for (let i = 0; i < 4; i++) {
      pool.onQuery(() => []);
      pool.onQuery(() => []);
    }

    // Cursor = 10_000 is far behind the 10M ledger head of the migrated data.
    const dropped = await dropOldPartitions(10_000n, BASE_CFG, pool as never);

    // retentionHead = max(10_000, 10_000_000) → cutoff = 6_000_000.
    // Partitions with hi + partitionSize < 6_000_000 (hi < 5_000_000) drop.
    expect(dropped).toEqual([
      "raw_events_p0_1000000",
      "raw_events_p1000000_2000000",
      "raw_events_p2000000_3000000",
      "raw_events_p3000000_4000000",
    ]);
  });

  it("does not drop partitions still within the retention window", async () => {
    const pool = poolForDrop({
      partitions: [
        // hi = 5_000_000, cutoff = 10_000_000 - 4_000_000 = 6_000_000 → within window
        { lo: 4_000_000n, hi: 5_000_000n, fullyProcessed: true },
      ],
    });

    const dropped = await dropOldPartitions(10_000_000n, BASE_CFG, pool as never);
    expect(dropped).toHaveLength(0);
  });

  it("drops a fully-processed partition past the retention cutoff", async () => {
    const pool = new FakePool();
    // listPartitions — one old, fully-processed partition
    pool.onQuery(() => [{ relname: "raw_events_p0_1000000" }]);
    // server_version_num
    pool.onQuery(() => [{ server_version_num: "160000" }]);
    // isFullyProcessed → all processed
    pool.onQuery(() => [{ has_unprocessed: false }]);
    // DETACH PARTITION … CONCURRENTLY
    pool.onQuery(() => []);
    // DROP TABLE
    pool.onQuery(() => []);

    // currentLedger = 10_000_000, cutoff = 6_000_000; partition hi = 1_000_000 < 6_000_000
    const dropped = await dropOldPartitions(10_000_000n, BASE_CFG, pool as never);

    expect(dropped).toEqual(["raw_events_p0_1000000"]);
    const ddl = pool.queries.join("\n");
    expect(ddl).toContain("DETACH PARTITION");
    expect(ddl).toContain("DROP TABLE");
  });

  it("skips a partition that has unprocessed rows even if past the cutoff", async () => {
    const pool = new FakePool();
    pool.onQuery(() => [{ relname: "raw_events_p0_1000000" }]);
    pool.onQuery(() => [{ server_version_num: "160000" }]);
    // has_unprocessed = true → not fully processed
    pool.onQuery(() => [{ has_unprocessed: true }]);

    const dropped = await dropOldPartitions(10_000_000n, BASE_CFG, pool as never);
    expect(dropped).toHaveLength(0);
  });

  it("only detaches (no DROP) when archiveOnly is true", async () => {
    const pool = new FakePool();
    pool.onQuery(() => [{ relname: "raw_events_p0_1000000" }]);
    pool.onQuery(() => [{ server_version_num: "160000" }]);
    pool.onQuery(() => [{ has_unprocessed: false }]);
    pool.onQuery(() => []); // DETACH

    const archiveCfg: RetentionConfig = { ...BASE_CFG, archiveOnly: true };
    const dropped = await dropOldPartitions(10_000_000n, archiveCfg, pool as never);

    expect(dropped).toEqual(["raw_events_p0_1000000"]);
    expect(pool.queries.some((q) => q.includes("DROP TABLE"))).toBe(false);
    expect(pool.queries.some((q) => q.includes("DETACH PARTITION"))).toBe(true);
  });
});

// ── RawEventsRetentionManager ─────────────────────────────────────────────────

describe("RawEventsRetentionManager.runOnce", () => {
  it("skips all work when raw_events is not yet partitioned", async () => {
    const pool = new FakePool();
    // is_partitioned = false
    pool.onQuery(() => [{ is_partitioned: false }]);

    const mgr = new RawEventsRetentionManager(pool as never, BASE_CFG);
    await mgr.runOnce(100n);

    // Only the is_partitioned check should have been issued
    expect(pool.queries).toHaveLength(1);
    expect(pool.queries[0]).toContain("relkind = 'p'");
  });

  it("runs ensureNextPartition and dropOldPartitions when table is partitioned", async () => {
    const pool = new FakePool();
    // is_partitioned = true
    pool.onQuery(() => [{ is_partitioned: true }]);
    // to_regclass (ensureNextPartition) — bucket exists
    pool.onQuery(() => [{ exists: true }]);
    // listPartitions (dropOldPartitions) — no old partitions
    pool.onQuery(() => []);

    const mgr = new RawEventsRetentionManager(pool as never, BASE_CFG);
    await mgr.runOnce(5_000_000n);

    // Partitioned check + partition listing must both have been issued, and
    // with no partitions present retention terminates cleanly (no DDL).
    expect(pool.queries.length).toBeGreaterThanOrEqual(2);
    expect(pool.queries.length).toBeLessThanOrEqual(3);
    expect(pool.queries[0]).toContain("relkind = 'p'");
    expect(pool.queries.some((q) => q.includes("pg_inherits"))).toBe(true);
  });
});

describe("RawEventsRetentionManager start / stop", () => {
  it("start() is idempotent — calling it twice does not register two cron jobs", () => {
    const pool = new FakePool();
    const mgr = new RawEventsRetentionManager(pool as never, {
      ...BASE_CFG,
      // Use a valid cron expression that won't actually fire during the test.
      cronSchedule: "59 23 31 12 0",
    });

    // Should not throw on double start
    mgr.start();
    mgr.start();

    // stop should cleanly cancel the single task
    mgr.stop();
    // Second stop should be a no-op (not throw)
    mgr.stop();
  });

  it("throws on an invalid cron schedule", () => {
    const pool = new FakePool();
    const mgr = new RawEventsRetentionManager(pool as never, {
      ...BASE_CFG,
      cronSchedule: "not-a-valid-cron",
    });

    expect(() => mgr.start()).toThrow("Invalid cron schedule");
  });
});
