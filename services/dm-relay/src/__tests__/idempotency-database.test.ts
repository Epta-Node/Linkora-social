import { Database } from "../database";

interface FakeRow {
  response_status: number;
  response_body: unknown;
  created_at: Date;
}

interface FakeQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

/**
 * Minimal in-memory stand-in for the subset of Postgres semantics the
 * idempotency queries rely on (INSERT ... ON CONFLICT DO NOTHING RETURNING,
 * conditional SELECT, UPDATE, and TTL-based DELETE).
 */
class FakePool {
  rows = new Map<string, FakeRow>();

  async query(text: string, values: unknown[] = []): Promise<FakeQueryResult> {
    if (text.includes("INSERT INTO message_idempotency")) {
      const [key, pendingStatus] = values as [string, number];
      if (this.rows.has(key)) {
        return { rows: [], rowCount: 0 };
      }
      this.rows.set(key, {
        response_status: pendingStatus,
        response_body: {},
        created_at: new Date(),
      });
      return { rows: [{ idempotency_key: key }], rowCount: 1 };
    }

    if (text.includes("SELECT response_status, response_body")) {
      const [key, pendingStatus] = values as [string, number];
      const row = this.rows.get(key);
      if (!row || row.response_status === pendingStatus) {
        return { rows: [], rowCount: 0 };
      }
      return {
        rows: [{ response_status: row.response_status, response_body: row.response_body }],
        rowCount: 1,
      };
    }

    if (text.includes("UPDATE message_idempotency")) {
      const [key, status, body] = values as [string, number, string];
      const row = this.rows.get(key);
      if (!row) return { rows: [], rowCount: 0 };
      row.response_status = status;
      row.response_body = JSON.parse(body);
      return { rows: [], rowCount: 1 };
    }

    if (text.includes("DELETE FROM message_idempotency")) {
      const match = text.match(/INTERVAL '(\d+) hours'/);
      const hours = match ? parseInt(match[1], 10) : 0;
      const cutoff = Date.now() - hours * 3_600_000;
      let deleted = 0;
      for (const [key, row] of this.rows) {
        if (row.created_at.getTime() < cutoff) {
          this.rows.delete(key);
          deleted++;
        }
      }
      return { rows: [], rowCount: deleted };
    }

    throw new Error(`FakePool: unhandled query: ${text}`);
  }
}

function createTestDatabase(pool: FakePool): Database {
  const db = Object.create(Database.prototype) as Database;
  (db as unknown as { pool: FakePool }).pool = pool;
  return db;
}

describe("Database idempotency methods", () => {
  it("claims a brand-new key", async () => {
    const db = createTestDatabase(new FakePool());
    const result = await db.claimIdempotencyKey("11111111-1111-1111-1111-111111111111");
    expect(result.status).toBe("claimed");
  });

  it("replays the cached response for a completed duplicate key", async () => {
    const pool = new FakePool();
    const db = createTestDatabase(pool);
    const key = "22222222-2222-2222-2222-222222222222";

    const first = await db.claimIdempotencyKey(key);
    expect(first.status).toBe("claimed");
    await db.completeIdempotencyKey(key, 201, { message_id: "abc" });

    const second = await db.claimIdempotencyKey(key);
    expect(second).toEqual({
      status: "cached",
      responseStatus: 201,
      responseBody: { message_id: "abc" },
    });
  });

  it("treats a different idempotency key as a brand-new message", async () => {
    const pool = new FakePool();
    const db = createTestDatabase(pool);

    await db.claimIdempotencyKey("33333333-3333-3333-3333-333333333333");
    await db.completeIdempotencyKey("33333333-3333-3333-3333-333333333333", 201, {
      message_id: "a",
    });

    const other = await db.claimIdempotencyKey("44444444-4444-4444-4444-444444444444");
    expect(other.status).toBe("claimed");
  });

  it("reports in_progress for a concurrent duplicate before completion", async () => {
    const pool = new FakePool();
    const db = createTestDatabase(pool);
    const key = "55555555-5555-5555-5555-555555555555";

    const first = await db.claimIdempotencyKey(key);
    expect(first.status).toBe("claimed");

    // A second request racing in before the first has finished processing.
    const second = await db.claimIdempotencyKey(key);
    expect(second.status).toBe("in_progress");

    expect(await db.getIdempotencyResponse(key)).toBeNull();
  });

  it("allows reprocessing a key after it has expired and been cleaned up", async () => {
    const pool = new FakePool();
    const db = createTestDatabase(pool);
    const key = "66666666-6666-6666-6666-666666666666";

    await db.claimIdempotencyKey(key);
    await db.completeIdempotencyKey(key, 201, { message_id: "xyz" });

    // Backdate the entry past the 24h TTL window.
    pool.rows.get(key)!.created_at = new Date(Date.now() - 25 * 3_600_000);

    const deleted = await db.deleteExpiredIdempotencyKeys(24);
    expect(deleted).toBe(1);

    const reclaimed = await db.claimIdempotencyKey(key);
    expect(reclaimed.status).toBe("claimed");
  });

  it("does not delete keys within the TTL window", async () => {
    const pool = new FakePool();
    const db = createTestDatabase(pool);
    const key = "77777777-7777-7777-7777-777777777777";

    await db.claimIdempotencyKey(key);
    await db.completeIdempotencyKey(key, 201, {});

    const deleted = await db.deleteExpiredIdempotencyKeys(24);
    expect(deleted).toBe(0);
    expect(await db.getIdempotencyResponse(key)).not.toBeNull();
  });
});
