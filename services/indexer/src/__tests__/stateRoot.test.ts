/**
 * Tests for the cryptographic state root computation (Phase 2).
 *
 * Covers:
 * 1. Determinism: same synthetic data → same root on two independent runs.
 * 2. merkleRoot helper edge cases.
 */

import { merkleRoot, computeStateRoot } from "../stateRoot";
import { Pool as PgPool } from "pg";

// ── Merkle root unit tests ────────────────────────────────────────────────────

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

// ── computeStateRoot determinism test ────────────────────────────────────────

describe("computeStateRoot determinism", () => {
  /**
   * Build a mock pg Pool that returns the same synthetic rows on every call.
   * We simulate two independent runs by calling computeStateRoot twice with
   * identical mock data and asserting the results are identical.
   */
  function buildMockPg(rows: Record<string, { rows: { h: string }[] }>): PgPool {
    const callCount: Record<string, number> = {};

    const mockQuery = jest.fn().mockImplementation((sql: string) => {
      // Determine which table is being queried.
      const table = Object.keys(rows).find((t) => sql.includes(t));
      if (!table) return Promise.resolve({ rows: [] });

      callCount[table] = (callCount[table] ?? 0) + 1;
      return Promise.resolve(rows[table]);
    });

    return { query: mockQuery } as unknown as PgPool;
  }

  it("produces identical roots for the same data on two independent calls", async () => {
    const syntheticRows = {
      posts: { rows: [{ h: "posthash1" }, { h: "posthash2" }] },
      follows: { rows: [{ h: "followhash1" }] },
      profiles: { rows: [{ h: "profilehash1" }, { h: "profilehash2" }] },
      pools: { rows: [] },
    };

    const pg1 = buildMockPg(syntheticRows);
    const pg2 = buildMockPg(syntheticRows);

    const root1 = await computeStateRoot(pg1);
    const root2 = await computeStateRoot(pg2);

    expect(root1).toBe(root2);
    expect(root1).toHaveLength(64); // sha256 hex
  });

  it("produces different roots when data differs", async () => {
    const rowsA = {
      posts: { rows: [{ h: "posthash1" }] },
      follows: { rows: [] },
      profiles: { rows: [] },
      pools: { rows: [] },
    };
    const rowsB = {
      posts: { rows: [{ h: "posthash_DIFFERENT" }] },
      follows: { rows: [] },
      profiles: { rows: [] },
      pools: { rows: [] },
    };

    const rootA = await computeStateRoot(buildMockPg(rowsA));
    const rootB = await computeStateRoot(buildMockPg(rowsB));

    expect(rootA).not.toBe(rootB);
  });
});
