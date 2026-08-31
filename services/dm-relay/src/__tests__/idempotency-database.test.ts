import { Database } from "../database";

interface FakeRow {
  sender_address: string;
  idempotency_key: string;
  response_status: number;
  response_body: unknown;
  request_fingerprint: string;
  created_at: Date;
}

interface FakeQueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

/**
 * Minimal in-memory stand-in for the subset of Postgres semantics the
 * idempotency queries rely on (INSERT ... ON CONFLICT DO NOTHING RETURNING,
 * conditional SELECT, UPDATE, and TTL-based DELETE), keyed on the composite
 * (sender_address, idempotency_key) primary key.
 */
class FakePool {
  rows = new Map<string, FakeRow>();

  private rowKey(sender: string, key: string): string {
    return `${sender} ${key}`;
  }

  async query(text: string, values: unknown[] = []): Promise<FakeQueryResult> {
    if (text.includes("INSERT INTO message_idempotency")) {
      const [sender, key, pendingStatus, fingerprint] = values as [string, string, number, string];
      const rowKey = this.rowKey(sender, key);
      if (this.rows.has(rowKey)) {
        return { rows: [], rowCount: 0 };
      }
      this.rows.set(rowKey, {
        sender_address: sender,
        idempotency_key: key,
        response_status: pendingStatus,
        response_body: {},
        request_fingerprint: fingerprint,
        created_at: new Date(),
      });
      return { rows: [{ idempotency_key: key }], rowCount: 1 };
    }

    if (text.includes("SELECT response_status, response_body, request_fingerprint")) {
      const [sender, key] = values as [string, string];
      const row = this.rows.get(this.rowKey(sender, key));
      if (!row) return { rows: [], rowCount: 0 };
      return {
        rows: [
          {
            response_status: row.response_status,
            response_body: row.response_body,
            request_fingerprint: row.request_fingerprint,
          },
        ],
        rowCount: 1,
      };
    }

    if (text.includes("SELECT response_status, response_body")) {
      const [sender, key, pendingStatus] = values as [string, string, number];
      const row = this.rows.get(this.rowKey(sender, key));
      if (!row || row.response_status === pendingStatus) {
        return { rows: [], rowCount: 0 };
      }
      return {
        rows: [{ response_status: row.response_status, response_body: row.response_body }],
        rowCount: 1,
      };
    }

    if (text.includes("UPDATE message_idempotency")) {
      const [sender, key, status, body] = values as [string, string, number, string];
      const row = this.rows.get(this.rowKey(sender, key));
      if (!row) return { rows: [], rowCount: 0 };
      row.response_status = status;
      row.response_body = JSON.parse(body);
      return { rows: [], rowCount: 1 };
    }

    if (text.includes("DELETE FROM message_idempotency")) {
      // The real query uses: NOW() - $1::integer * INTERVAL '1 hour'
      // Extract hours from the values parameter
      const [ttlHours] = values as [number];
      const hours = Math.max(0, Math.floor(ttlHours));
      const cutoff = Date.now() - hours * 3_600_000;
      let deleted = 0;
      for (const [rowKey, row] of this.rows) {
        if (row.created_at.getTime() < cutoff) {
          this.rows.delete(rowKey);
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

const SENDER_A = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const SENDER_B = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const FINGERPRINT_1 = "fp-1";
const FINGERPRINT_2 = "fp-2";

describe("Database idempotency methods", () => {
  it("claims a brand-new key", async () => {
    const db = createTestDatabase(new FakePool());
    const result = await db.claimIdempotencyKey(
      SENDER_A,
      "11111111-1111-1111-1111-111111111111",
      FINGERPRINT_1
    );
    expect(result.status).toBe("claimed");
  });

  it("replays the cached response for a completed duplicate key from the same sender", async () => {
    const pool = new FakePool();
    const db = createTestDatabase(pool);
    const key = "22222222-2222-2222-2222-222222222222";

    const first = await db.claimIdempotencyKey(SENDER_A, key, FINGERPRINT_1);
    expect(first.status).toBe("claimed");
    await db.completeIdempotencyKey(SENDER_A, key, 201, { message_id: "abc" });

    const second = await db.claimIdempotencyKey(SENDER_A, key, FINGERPRINT_1);
    expect(second).toEqual({
      status: "cached",
      responseStatus: 201,
      responseBody: { message_id: "abc" },
    });
  });

  it("treats a different idempotency key as a brand-new message", async () => {
    const pool = new FakePool();
    const db = createTestDatabase(pool);

    await db.claimIdempotencyKey(SENDER_A, "33333333-3333-3333-3333-333333333333", FINGERPRINT_1);
    await db.completeIdempotencyKey(SENDER_A, "33333333-3333-3333-3333-333333333333", 201, {
      message_id: "a",
    });

    const other = await db.claimIdempotencyKey(
      SENDER_A,
      "44444444-4444-4444-4444-444444444444",
      FINGERPRINT_1
    );
    expect(other.status).toBe("claimed");
  });

  it("treats the same key from a different sender as independent (not a collision)", async () => {
    const pool = new FakePool();
    const db = createTestDatabase(pool);
    const key = "88888888-8888-8888-8888-888888888888";

    const first = await db.claimIdempotencyKey(SENDER_A, key, FINGERPRINT_1);
    expect(first.status).toBe("claimed");
    await db.completeIdempotencyKey(SENDER_A, key, 201, { message_id: "from-a" });

    // Sender B reusing the exact same key must not be dropped or merged with A's message.
    const second = await db.claimIdempotencyKey(SENDER_B, key, FINGERPRINT_2);
    expect(second.status).toBe("claimed");
  });

  it("returns a conflict when the same sender reuses a key with a different payload", async () => {
    const pool = new FakePool();
    const db = createTestDatabase(pool);
    const key = "99999999-9999-9999-9999-999999999999";

    const first = await db.claimIdempotencyKey(SENDER_A, key, FINGERPRINT_1);
    expect(first.status).toBe("claimed");

    const second = await db.claimIdempotencyKey(SENDER_A, key, FINGERPRINT_2);
    expect(second.status).toBe("conflict");
  });

  it("reports in_progress for a concurrent duplicate before completion", async () => {
    const pool = new FakePool();
    const db = createTestDatabase(pool);
    const key = "55555555-5555-5555-5555-555555555555";

    const first = await db.claimIdempotencyKey(SENDER_A, key, FINGERPRINT_1);
    expect(first.status).toBe("claimed");

    // A second request racing in before the first has finished processing.
    const second = await db.claimIdempotencyKey(SENDER_A, key, FINGERPRINT_1);
    expect(second.status).toBe("in_progress");

    expect(await db.getIdempotencyResponse(SENDER_A, key)).toBeNull();
  });

  it("allows reprocessing a key after it has expired and been cleaned up", async () => {
    const pool = new FakePool();
    const db = createTestDatabase(pool);
    const key = "66666666-6666-6666-6666-666666666666";

    await db.claimIdempotencyKey(SENDER_A, key, FINGERPRINT_1);
    await db.completeIdempotencyKey(SENDER_A, key, 201, { message_id: "xyz" });

    // Backdate the entry past the 24h TTL window.
    pool.rows.get(`${SENDER_A} ${key}`)!.created_at = new Date(Date.now() - 25 * 3_600_000);

    const deleted = await db.deleteExpiredIdempotencyKeys(24);
    expect(deleted).toBe(1);

    const reclaimed = await db.claimIdempotencyKey(SENDER_A, key, FINGERPRINT_1);
    expect(reclaimed.status).toBe("claimed");
  });

  it("does not delete keys within the TTL window", async () => {
    const pool = new FakePool();
    const db = createTestDatabase(pool);
    const key = "77777777-7777-7777-7777-777777777777";

    await db.claimIdempotencyKey(SENDER_A, key, FINGERPRINT_1);
    await db.completeIdempotencyKey(SENDER_A, key, 201, {});

    const deleted = await db.deleteExpiredIdempotencyKeys(24);
    expect(deleted).toBe(0);
    expect(await db.getIdempotencyResponse(SENDER_A, key)).not.toBeNull();
  });
});
