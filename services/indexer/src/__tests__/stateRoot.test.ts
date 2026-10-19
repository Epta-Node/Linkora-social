/**
 * Tests for the cryptographic state root — both the full-scan path (used by
 * verify-state CLI) and the incremental XOR-accumulator path (used on the
 * commit hot path).
 *
 * Covers:
 * 1. merkleRoot helper edge cases.
 * 2. xorHex correctness.
 * 3. computeStateRoot determinism (full-scan, mock DB).
 * 4. extractDeltas — mapping events to RowDelta entries.
 * 5. applyStateRootDelta — incremental update correctness.
 * 6. Benchmark: per-batch cost is near-constant as table grows.
 */

import { merkleRoot, computeStateRoot, xorHex, extractDeltas, applyStateRootDelta } from "../stateRoot";
import { Pool as PgPool } from "pg";
import type { IngestEvent } from "../pipeline";

// ── merkleRoot unit tests ─────────────────────────────────────────────────────

describe("merkleRoot", () => {
  it("returns all-zeros for empty input", () => {
    expect(merkleRoot([])).toBe("0".repeat(64));
  });

  it("returns the single leaf for a one-element input", () => {
    const leaf = "abc123";
    expect(merkleRoot([leaf])).toBe(leaf);
  });

  it("is order-independent (sorts leaves before building the tree)", () => {
    const a = merkleRoot(["leaf1", "leaf2", "leaf3"]);
    const b = merkleRoot(["leaf3", "leaf1", "leaf2"]);
    expect(a).toBe(b);
  });

  it("produces different roots for different leaf sets", () => {
    const a = merkleRoot(["leaf1"]);
    const b = merkleRoot(["leaf2"]);
    expect(a).not.toBe(b);
  });
});

// ── xorHex ───────────────────────────────────────────────────────────────────

describe("xorHex", () => {
  it("XOR with itself gives all zeros", () => {
    const h = "a".repeat(64);
    expect(xorHex(h, h)).toBe("0".repeat(64));
  });

  it("XOR with all-zeros is identity", () => {
    const h = "deadbeef".padEnd(64, "0");
    expect(xorHex(h, "0".repeat(64))).toBe(h);
  });

  it("is commutative", () => {
    const a = "cafebabe".padEnd(64, "0");
    const b = "deadbeef".padEnd(64, "0");
    expect(xorHex(a, b)).toBe(xorHex(b, a));
  });

  it("is self-inverse: XOR-in then XOR-out restores the original", () => {
    const acc = "1234567890abcdef".repeat(4);
    const hash = "fedcba0987654321".repeat(4);
    expect(xorHex(xorHex(acc, hash), hash)).toBe(acc);
  });
});

// ── computeStateRoot determinism test ────────────────────────────────────────

describe("computeStateRoot determinism", () => {
  function buildMockPg(rows: Record<string, { rows: { h: string }[] }>): PgPool {
    const mockQuery = jest.fn().mockImplementation((sql: string) => {
      const table = Object.keys(rows).find((t) => sql.includes(t));
      if (!table) return Promise.resolve({ rows: [] });
      return Promise.resolve(rows[table]);
    });
    return { query: mockQuery } as unknown as PgPool;
  }

  it("produces identical roots for the same data on two independent calls", async () => {
    const syntheticRows = {
      posts:    { rows: [{ h: "posthash1" }, { h: "posthash2" }] },
      follows:  { rows: [{ h: "followhash1" }] },
      profiles: { rows: [{ h: "profilehash1" }, { h: "profilehash2" }] },
      pools:    { rows: [] },
    };

    const root1 = await computeStateRoot(buildMockPg(syntheticRows));
    const root2 = await computeStateRoot(buildMockPg(syntheticRows));

    expect(root1).toBe(root2);
    expect(root1).toHaveLength(64);
  });

  it("produces different roots when data differs", async () => {
    const rowsA = {
      posts:    { rows: [{ h: "posthash1" }] },
      follows:  { rows: [] },
      profiles: { rows: [] },
      pools:    { rows: [] },
    };
    const rowsB = {
      posts:    { rows: [{ h: "posthash_DIFFERENT" }] },
      follows:  { rows: [] },
      profiles: { rows: [] },
      pools:    { rows: [] },
    };

    const rootA = await computeStateRoot(buildMockPg(rowsA));
    const rootB = await computeStateRoot(buildMockPg(rowsB));

    expect(rootA).not.toBe(rootB);
  });
});

// ── extractDeltas ─────────────────────────────────────────────────────────────

function makeEvent(topic: string, data: Record<string, unknown>): IngestEvent {
  return {
    ledgerSequence: 100,
    eventIndex: 0,
    contractId: "C_TEST",
    type: topic,
    topic: [topic],
    data,
  };
}

describe("extractDeltas", () => {
  it("returns empty array for unrecognised topics", () => {
    const deltas = extractDeltas([makeEvent("unknown_topic", {})]);
    expect(deltas).toHaveLength(0);
  });

  it("emits a posts delta for post_created", () => {
    const deltas = extractDeltas([makeEvent("post_created", { id: "42", author: "GTEST", content: "hello" })]);
    expect(deltas).toHaveLength(1);
    expect(deltas[0].tableName).toBe("posts");
    expect(deltas[0].rowKey).toBe("post:42");
    expect(deltas[0].newHash).toBeDefined();
    expect(deltas[0].newHash).toHaveLength(64);
  });

  it("marks post row for DB fetch on post_deleted (tip/like counts unknown)", () => {
    const deltas = extractDeltas([makeEvent("post_deleted", { post_id: "7" })]);
    expect(deltas[0].tableName).toBe("posts");
    expect(deltas[0].newHash).toBeUndefined();
  });

  it("deduplicates multiple events for the same row — last wins", () => {
    const events = [
      makeEvent("post_created", { id: "5", author: "GA", content: "first" }),
      makeEvent("tip", { post_id: "5", amount: "100" }),
    ];
    const deltas = extractDeltas(events);
    // Both events touch post:5 — should collapse to one delta
    const postDeltas = deltas.filter((d) => d.rowKey === "post:5");
    expect(postDeltas).toHaveLength(1);
  });

  it("emits a follows delta for follow", () => {
    const deltas = extractDeltas([makeEvent("follow", { follower: "GA", followee: "GB" })]);
    expect(deltas[0].tableName).toBe("follows");
    expect(deltas[0].rowKey).toBe("follow:GA:GB");
  });

  it("emits a follows delta with undefined newHash for unfollow", () => {
    const deltas = extractDeltas([makeEvent("unfollow", { follower: "GA", followee: "GB" })]);
    expect(deltas[0].tableName).toBe("follows");
    expect(deltas[0].newHash).toBeUndefined();
  });

  it("emits a profiles delta for profile_set", () => {
    const deltas = extractDeltas([makeEvent("profile_set", { user: "GADDR" })]);
    expect(deltas[0].tableName).toBe("profiles");
    expect(deltas[0].rowKey).toBe("profile:GADDR");
  });

  it("emits a pools delta for pool_deposit", () => {
    const deltas = extractDeltas([makeEvent("pool_deposit", { pool_id: "pool1", amount: "500" })]);
    expect(deltas[0].tableName).toBe("pools");
    expect(deltas[0].rowKey).toBe("pool:pool1");
  });
});

// ── applyStateRootDelta correctness ───────────────────────────────────────────

describe("applyStateRootDelta", () => {
  /**
   * Build an in-memory mock PgPool that simulates the tables needed by the
   * incremental engine without a live database.
   */
  function buildIncrementalMockPg() {
    const ZERO = "0".repeat(64);

    // In-memory state
    const accumulators: Record<string, string> = {
      posts:              ZERO,
      follows:            ZERO,
      profiles:           ZERO,
      pools:              ZERO,
      __bootstrap_done__: ZERO,
    };
    const rowHashes: Map<string, string> = new Map(); // "table:key" → hash
    const indexerState: Map<number, string> = new Map();

    const mockClient = {
      query: jest.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
        // BEGIN / COMMIT / ROLLBACK
        if (/^\s*BEGIN/i.test(sql)) { return { rows: [], rowCount: 0 }; }
        if (/^\s*COMMIT/i.test(sql)) { return { rows: [], rowCount: 0 }; }
        if (/^\s*ROLLBACK/i.test(sql)) { return { rows: [], rowCount: 0 }; }

        // INSERT INTO state_root_accumulators
        if (/INSERT INTO state_root_accumulators/.test(sql)) {
          const table = params![0] as string;
          const acc   = params![1] as string;
          accumulators[table] = acc;
          return { rows: [], rowCount: 1 };
        }

        // INSERT INTO state_root_row_hashes (upsert)
        if (/INSERT INTO state_root_row_hashes/.test(sql)) {
          const table   = params![0] as string;
          const rowKey  = params![1] as string;
          const rowHash = params![2] as string;
          rowHashes.set(`${table}:${rowKey}`, rowHash);
          return { rows: [], rowCount: 1 };
        }

        // DELETE FROM state_root_row_hashes
        if (/DELETE FROM state_root_row_hashes/.test(sql)) {
          if (params && params.length >= 2) {
            // Targeted delete (table_name, row_key params)
            const table  = params[0] as string;
            const rowKey = params[1] as string;
            rowHashes.delete(`${table}:${rowKey}`);
          } else {
            // Bulk delete (bootstrap truncation — no params)
            rowHashes.clear();
          }
          return { rows: [], rowCount: 1 };
        }

        // INSERT INTO indexer_state
        if (/INSERT INTO indexer_state/.test(sql)) {
          indexerState.set(params![0] as number, params![1] as string);
          return { rows: [], rowCount: 1 };
        }

        // Full-scan SELECT queries (bootstrap — all tables should be empty)
        if (/SELECT .* FROM posts/.test(sql)) return { rows: [], rowCount: 0 };
        if (/SELECT .* FROM follows/.test(sql)) return { rows: [], rowCount: 0 };
        if (/SELECT .* FROM profiles/.test(sql)) return { rows: [], rowCount: 0 };
        if (/SELECT .* FROM pools/.test(sql)) return { rows: [], rowCount: 0 };

        return { rows: [], rowCount: 0 };
      }),
      release: jest.fn(),
    };

    const pg = {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: jest.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
        // Bootstrap sentinel check — uses a literal string in SQL, no params
        if (/SELECT accumulator FROM state_root_accumulators WHERE table_name = '__bootstrap_done__'/.test(sql)) {
          return { rows: [{ accumulator: accumulators["__bootstrap_done__"] ?? ZERO }], rowCount: 1 };
        }

        // Select accumulators for the four named tables
        if (/SELECT table_name, accumulator FROM state_root_accumulators/.test(sql)) {
          const tables = (params as string[][])[0] as string[];
          const rows = tables.map((t) => ({
            table_name: t,
            accumulator: accumulators[t] ?? ZERO,
          }));
          return { rows, rowCount: rows.length };
        }

        // Select row hashes for a given table + keys
        if (/SELECT row_key, row_hash FROM state_root_row_hashes/.test(sql)) {
          const table = params![0] as string;
          const keys  = params![1] as string[];
          const rows  = keys
            .filter((k) => rowHashes.has(`${table}:${k}`))
            .map((k)  => ({ row_key: k, row_hash: rowHashes.get(`${table}:${k}`) }));
          return { rows, rowCount: rows.length };
        }

        // Current post row
        if (/FROM posts\s+WHERE id/.test(sql)) {
          const id = String(params![0]);
          return { rows: [{ id, author: "GTEST", content: "hello", tip_total: "0", like_count: "0", deleted_at: null }], rowCount: 1 };
        }

        // Current follow row
        if (/FROM follows\s+WHERE follower/.test(sql)) {
          const follower = String(params![0]);
          const followee = String(params![1]);
          return { rows: [{ follower, followee, created_at: "2024-01-01T00:00:00.000Z" }], rowCount: 1 };
        }

        // Current profile row
        if (/FROM profiles\s+WHERE address/.test(sql)) {
          const address = String(params![0]);
          return { rows: [{ address, username: "alice", creator_token: "TKN", updated_ledger: "100" }], rowCount: 1 };
        }

        // Current pool row
        if (/FROM pools\s+WHERE pool_id/.test(sql)) {
          const poolId = String(params![0]);
          return { rows: [{ pool_id: poolId, token: "XLM", balance: "1000", admins: "{}", threshold: "1", created_ledger: "1", updated_ledger: "100" }], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
      }),
      _accumulators: accumulators,
      _rowHashes: rowHashes,
      _indexerState: indexerState,
    } as unknown as PgPool & {
      _accumulators: Record<string, string>;
      _rowHashes: Map<string, string>;
      _indexerState: Map<number, string>;
    };

    return pg;
  }

  it("returns a 64-char hex root for an empty batch", async () => {
    const pg = buildIncrementalMockPg();
    // Mark bootstrapped to skip full scan
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pg as any)._accumulators["__bootstrap_done__"] = "1".padStart(64, "0");

    const root = await applyStateRootDelta(pg, 1, []);
    expect(root).toHaveLength(64);
  });

  it("produces different roots when different rows are touched", async () => {
    const pg1 = buildIncrementalMockPg();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pg1 as any)._accumulators["__bootstrap_done__"] = "1".padStart(64, "0");
    const pg2 = buildIncrementalMockPg();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pg2 as any)._accumulators["__bootstrap_done__"] = "1".padStart(64, "0");

    const eventsA = [makeEvent("post_created", { id: "1", author: "GA", content: "hello" })];
    const eventsB = [makeEvent("post_created", { id: "2", author: "GB", content: "world" })];

    const rootA = await applyStateRootDelta(pg1, 1, eventsA);
    const rootB = await applyStateRootDelta(pg2, 1, eventsB);

    expect(rootA).not.toBe(rootB);
  });

  it("is idempotent: applying the same delta twice restores the accumulator", async () => {
    const pg = buildIncrementalMockPg();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pg as any)._accumulators["__bootstrap_done__"] = "1".padStart(64, "0");

    const events = [makeEvent("post_created", { id: "10", author: "GA", content: "x" })];

    // First apply seeds the hash.
    await applyStateRootDelta(pg, 1, events);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after1 = (pg as any)._accumulators["posts"] as string;

    // Second apply with same event data: old hash == new hash → no net change.
    await applyStateRootDelta(pg, 2, events);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after2 = (pg as any)._accumulators["posts"] as string;

    expect(after1).toBe(after2);
  });

  it("XOR-out works: adding then removing a row restores original accumulator", async () => {
    const pg = buildIncrementalMockPg();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pg as any)._accumulators["__bootstrap_done__"] = "1".padStart(64, "0");

    // Track whether the follow row "exists" in the mock DB.
    let followExists = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalImpl = (pg as any).query.getMockImplementation() as (...args: unknown[]) => unknown;

    // Override pool query to consult `followExists` for follows lookups.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pg as any).query = jest.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/FROM follows\s+WHERE follower/.test(sql)) {
        if (!followExists) return { rows: [], rowCount: 0 };
        const follower = String(params![0]);
        const followee = String(params![1]);
        return { rows: [{ follower, followee, created_at: "2024-01-01T00:00:00.000Z" }], rowCount: 1 };
      }
      return originalImpl(sql, params);
    });

    // Add follow (row exists)
    await applyStateRootDelta(pg, 1, [makeEvent("follow", { follower: "GA", followee: "GB" })]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after1 = (pg as any)._accumulators["follows"] as string;
    expect(after1).not.toBe("0".repeat(64)); // accumulator changed

    // Simulate row deletion before unfollow event
    followExists = false;

    await applyStateRootDelta(pg, 2, [makeEvent("unfollow", { follower: "GA", followee: "GB" })]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after2 = (pg as any)._accumulators["follows"] as string;
    // XOR-out: the stored hash for this row is XOR'd out, restoring ZERO
    expect(after2).toBe("0".repeat(64));
  });
});

// ── Benchmark: near-constant per-batch cost ───────────────────────────────────
//
// This test verifies that the time per batch does NOT grow proportionally with
// "table size" by comparing the cost of applying a 10-event batch against a
// background of 0 rows vs. 10 000 "pre-existing" rows (rows already in the
// accumulator via seeded row hashes).  Because the incremental path only
// touches the rows in the delta, both costs should be in the same order of
// magnitude.
//
// We assert that the large-table run is at most 10× the empty-table run.  In
// practice the ratio is nearly 1× because neither path does a table scan.
// The 10× margin absorbs JIT variance and CI scheduling jitter.

describe("applyStateRootDelta benchmark — per-batch cost is near-constant", () => {
  const BATCH_SIZE = 10;
  const PRESEEDED_ROWS = 10_000;
  const MAX_RATIO = 10;

  /** Build a mock pg with `preseededRows` fake entries already in _rowHashes. */
  function buildMockWithPreseededRows(preseededRows: number) {
    const ZERO = "0".repeat(64);
    const accumulators: Record<string, string> = {
      posts:              ZERO,
      follows:            ZERO,
      profiles:           ZERO,
      pools:              ZERO,
      __bootstrap_done__: "1".padStart(64, "0"), // already bootstrapped
    };
    const rowHashes = new Map<string, string>();

    // Seed the accumulator and row-hash table with preseededRows existing posts.
    const { createHash } = await import("crypto");
    for (let i = 0; i < preseededRows; i++) {
      const h = createHash("sha256").update(`seed:${i}`).digest("hex");
      rowHashes.set(`posts:post:${i}`, h);
      // XOR into accumulator (simplified inline version of xorHex)
      let xored = "";
      const CHUNK = 8;
      for (let c = 0; c < 64; c += CHUNK) {
        const av = parseInt(accumulators["posts"].slice(c, c + CHUNK), 16);
        const bv = parseInt(h.slice(c, c + CHUNK), 16);
        xored += (av ^ bv).toString(16).padStart(CHUNK, "0");
      }
      accumulators["posts"] = xored;
    }

    const mockClient = {
      query: jest.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
        if (/^\s*BEGIN/i.test(sql) || /^\s*COMMIT/i.test(sql) || /^\s*ROLLBACK/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }
        if (/INSERT INTO state_root_accumulators/.test(sql)) {
          accumulators[params![0] as string] = params![1] as string;
          return { rows: [], rowCount: 1 };
        }
        if (/INSERT INTO state_root_row_hashes/.test(sql)) {
          rowHashes.set(`${params![0]}:${params![1]}`, params![2] as string);
          return { rows: [], rowCount: 1 };
        }
        if (/DELETE FROM state_root_row_hashes/.test(sql)) {
          if (params && params.length >= 2) {
            rowHashes.delete(`${params[0]}:${params[1]}`);
          } else {
            rowHashes.clear();
          }
          return { rows: [], rowCount: 1 };
        }
        if (/INSERT INTO indexer_state/.test(sql)) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
      release: jest.fn(),
    };

    const pg = {
      connect: jest.fn().mockResolvedValue(mockClient),
      query: jest.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
        // Bootstrap sentinel check (literal string in SQL, no params)
        if (/SELECT accumulator FROM state_root_accumulators WHERE table_name = '__bootstrap_done__'/.test(sql)) {
          return { rows: [{ accumulator: accumulators["__bootstrap_done__"] ?? ZERO }], rowCount: 1 };
        }
        if (/SELECT table_name, accumulator FROM state_root_accumulators/.test(sql)) {
          const tables = (params as string[][])[0] as string[];
          return { rows: tables.map((t) => ({ table_name: t, accumulator: accumulators[t] ?? ZERO })), rowCount: 4 };
        }
        if (/SELECT row_key, row_hash FROM state_root_row_hashes/.test(sql)) {
          const table = params![0] as string;
          const keys  = params![1] as string[];
          const rows  = keys
            .filter((k) => rowHashes.has(`${table}:${k}`))
            .map((k) => ({ row_key: k, row_hash: rowHashes.get(`${table}:${k}`) }));
          return { rows, rowCount: rows.length };
        }
        if (/FROM posts\s+WHERE id/.test(sql)) {
          const id = String(params![0]);
          return { rows: [{ id, author: "GA", content: "c", tip_total: "0", like_count: "0", deleted_at: null }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as PgPool;

    return pg;
  }

  function makeBatch(size: number, startId: number): IngestEvent[] {
    return Array.from({ length: size }, (_, i) =>
      makeEvent("post_created", {
        id: String(startId + i),
        author: "GBENCH",
        content: `content-${startId + i}`,
      })
    );
  }

  it(
    `batch of ${BATCH_SIZE} events costs <${MAX_RATIO}× more with ${PRESEEDED_ROWS} pre-existing rows than with 0`,
    async () => {
      // ── Empty table baseline ───────────────────────────────────────────────
      const pgEmpty = buildMockWithPreseededRows(0);
      const batchEmpty = makeBatch(BATCH_SIZE, 1_000_000);

      const t0empty = Date.now();
      await applyStateRootDelta(pgEmpty, 1, batchEmpty);
      const durEmpty = Date.now() - t0empty + 1; // +1 avoids division-by-zero

      // ── Large table ────────────────────────────────────────────────────────
      const pgLarge = buildMockWithPreseededRows(PRESEEDED_ROWS);
      const batchLarge = makeBatch(BATCH_SIZE, 2_000_000); // distinct IDs, no row conflict

      const t0large = Date.now();
      await applyStateRootDelta(pgLarge, 1, batchLarge);
      const durLarge = Date.now() - t0large + 1;

      const ratio = durLarge / durEmpty;
      console.log(
        `[stateRoot benchmark] empty=${durEmpty}ms, large(${PRESEEDED_ROWS} rows)=${durLarge}ms, ratio=${ratio.toFixed(2)}x`
      );

      expect(ratio).toBeLessThanOrEqual(MAX_RATIO);
    },
    15_000 // 15 s timeout — generous for slow CI
  );
});
