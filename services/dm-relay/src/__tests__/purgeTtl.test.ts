/**
 * Tests for the TTL purge job (#1649)
 *
 * Verifies the SQL cutoff logic without a real Postgres instance by
 * providing a mock pg Pool.
 */

import { purgeExpiredMessages } from "../jobs/purgeTtl";
import { Pool } from "pg";

function makeMockPool(rowCount: number): Pool {
  return {
    query: jest.fn().mockResolvedValue({ rowCount }),
  } as unknown as Pool;
}

describe("purgeExpiredMessages", () => {
  it("issues a DELETE with the correct TTL interval", async () => {
    const db = makeMockPool(3);

    const count = await purgeExpiredMessages(db, 86400);

    expect(count).toBe(3);

    const mockQuery = (db.query as jest.Mock).mock.calls[0];
    const sql: string = mockQuery[0];
    const params: string[] = mockQuery[1];

    expect(sql).toMatch(/DELETE FROM messages/i);
    expect(sql).toMatch(/created_at < NOW\(\)/i);
    expect(params[0]).toBe("86400");
  });

  it("returns 0 when no rows are deleted", async () => {
    const db = makeMockPool(0);
    const count = await purgeExpiredMessages(db, 3600);
    expect(count).toBe(0);
  });

  it("uses the provided TTL value (configurable)", async () => {
    const db = makeMockPool(5);
    await purgeExpiredMessages(db, 604800); // 7 days

    const params = (db.query as jest.Mock).mock.calls[0][1];
    expect(params[0]).toBe("604800");
  });

  it("propagates database errors", async () => {
    const db = {
      query: jest.fn().mockRejectedValue(new Error("db error")),
    } as unknown as Pool;

    await expect(purgeExpiredMessages(db, 3600)).rejects.toThrow("db error");
  });
});
