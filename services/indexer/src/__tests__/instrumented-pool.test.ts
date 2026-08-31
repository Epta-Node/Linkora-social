import { Pool, QueryResult } from "pg";
import { InstrumentedPool } from "../instrumented-pool";

// ── Logger mock ───────────────────────────────────────────────────────────────

const mockWarn = jest.fn();
const mockError = jest.fn();

jest.mock("../logger", () => ({
  logger: {
    warn: (...args: unknown[]) => mockWarn(...args),
    error: (...args: unknown[]) => mockError(...args),
    info: jest.fn(),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const FAKE_RESULT: QueryResult = {
  rows: [{ one: 1 }],
  rowCount: 1,
  command: "SELECT",
  oid: 0,
  fields: [],
};

function makePool(thresholdMs: number): InstrumentedPool {
  return new InstrumentedPool(thresholdMs);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("InstrumentedPool", () => {
  let superQuerySpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    superQuerySpy = jest
      .spyOn(Pool.prototype, "query")
      .mockResolvedValue(FAKE_RESULT as never);
  });

  afterEach(() => {
    superQuerySpy.mockRestore();
  });

  it("returns the query result unchanged on success", async () => {
    const pool = makePool(5000);
    const result = await pool.query("SELECT 1");
    expect(result).toBe(FAKE_RESULT);
  });

  it("fires logger.warn when query duration exceeds the threshold", async () => {
    const pool = makePool(50);

    // Fake Date.now so that elapsed = 100 ms > 50 ms threshold.
    const nowSpy = jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(0)   // start
      .mockReturnValueOnce(100); // end

    await pool.query("SELECT slow_thing FROM big_table");

    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ dur: 100, sql: "SELECT slow_thing FROM big_table" }),
      "slow-query"
    );
    nowSpy.mockRestore();
  });

  it("does not fire logger.warn when query duration is below the threshold", async () => {
    const pool = makePool(5000);

    const nowSpy = jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(10); // 10 ms < 5000 ms threshold

    await pool.query("SELECT fast FROM table");

    expect(mockWarn).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });

  it("truncates the sql snippet in the log to 120 characters", async () => {
    const pool = makePool(50);
    const longSql = "SELECT " + "x, ".repeat(100) + "1";

    const nowSpy = jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(200);

    await pool.query(longSql);

    const logged: { sql: string } = mockWarn.mock.calls[0][0];
    expect(logged.sql.length).toBeLessThanOrEqual(120);
    nowSpy.mockRestore();
  });

  it("logs '(prepared)' for QueryConfig objects", async () => {
    const pool = makePool(50);

    const nowSpy = jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(200);

    await pool.query({ text: "SELECT $1", values: [1] });

    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ sql: "(prepared)" }),
      "slow-query"
    );
    nowSpy.mockRestore();
  });

  it("fires logger.error and re-throws when the underlying query rejects", async () => {
    superQuerySpy.mockRejectedValue(new Error("connection reset") as never);
    const pool = makePool(5000);

    const nowSpy = jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(25);

    await expect(pool.query("SELECT 1")).rejects.toThrow("connection reset");

    expect(mockError).toHaveBeenCalledTimes(1);
    expect(mockError).toHaveBeenCalledWith(
      expect.objectContaining({ dur: 25, sql: "SELECT 1" }),
      "query-error"
    );
    // warn must NOT fire on the error path
    expect(mockWarn).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });

  it("does not swallow the error — caller receives the original rejection", async () => {
    const boom = new Error("timeout");
    superQuerySpy.mockRejectedValue(boom as never);
    const pool = makePool(5000);

    await expect(pool.query("SELECT 1")).rejects.toBe(boom);
  });
});
