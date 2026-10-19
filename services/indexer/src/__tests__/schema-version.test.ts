import { Pool } from "pg";
import { assertSchemaVersion } from "../schema-version";

// ── Logger mock ───────────────────────────────────────────────────────────────

const mockInfo = jest.fn();
const mockError = jest.fn();

jest.mock("../logger", () => ({
  logger: {
    info: (...args: unknown[]) => mockInfo(...args),
    error: (...args: unknown[]) => mockError(...args),
    warn: jest.fn(),
  },
}));

// ── process.exit mock ─────────────────────────────────────────────────────────

const mockExit = jest
  .spyOn(process, "exit")
  .mockImplementation((_code?: string | number | null | undefined) => {
    throw new Error(`process.exit(${_code})`);
  });

// ── Helpers ───────────────────────────────────────────────────────────────────

const ALL_TABLES = [
  "raw_events",
  "indexer_cursor",
  "indexer_state",
  "device_tokens",
  "sent_notifications",
  "blocks",
  "dm_keys",
  "notification_preferences",
];

function makePool(tables: string[], hasContentTsv = true): Pool {
  const pool = { query: jest.fn() } as unknown as Pool;
  (pool.query as jest.Mock).mockImplementation((sql: string, _params?: unknown[]) => {
    if (typeof sql === "string" && sql.includes("pg_tables")) {
      return Promise.resolve({ rows: tables.map((t) => ({ tablename: t })) });
    }
    if (typeof sql === "string" && sql.includes("information_schema.columns")) {
      const count = hasContentTsv ? 1 : 0;
      return Promise.resolve({ rows: [{ count }] });
    }
    return Promise.resolve({ rows: [] });
  });
  return pool;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("assertSchemaVersion", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    mockExit.mockRestore();
  });

  it("resolves without error when all sentinel tables and columns are present", async () => {
    const pool = makePool(ALL_TABLES, true);
    await expect(assertSchemaVersion(pool)).resolves.toBeUndefined();
    expect(mockExit).not.toHaveBeenCalled();
    expect(mockInfo).toHaveBeenCalledWith(
      expect.objectContaining({ requiredTables: ALL_TABLES.length }),
      "Schema version check passed"
    );
  });

  it("calls process.exit(1) when a required table is missing", async () => {
    const missingTable = "notification_preferences";
    const pool = makePool(ALL_TABLES.filter((t) => t !== missingTable), true);
    await expect(assertSchemaVersion(pool)).rejects.toThrow("process.exit(1)");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockError).toHaveBeenCalledWith(
      expect.objectContaining({ missingTables: [missingTable] }),
      expect.stringContaining("out of date")
    );
  });

  it("calls process.exit(1) when the sentinel column posts.content_tsv is missing", async () => {
    const pool = makePool(ALL_TABLES, false);
    await expect(assertSchemaVersion(pool)).rejects.toThrow("process.exit(1)");
    expect(mockExit).toHaveBeenCalledWith(1);
    expect(mockError).toHaveBeenCalledWith(
      expect.objectContaining({ table: "posts", column: "content_tsv" }),
      expect.stringContaining("out of date")
    );
  });

  it("calls process.exit(1) with a list of all missing tables when multiple are absent", async () => {
    const pool = makePool(["raw_events", "indexer_cursor"], true);
    await expect(assertSchemaVersion(pool)).rejects.toThrow("process.exit(1)");
    expect(mockExit).toHaveBeenCalledWith(1);
    const [logObj] = mockError.mock.calls[0] as [{ missingTables: string[] }];
    expect(logObj.missingTables.length).toBeGreaterThan(1);
  });

  it("does not call process.exit(1) when the table list is a superset of required tables", async () => {
    const pool = makePool([...ALL_TABLES, "some_extra_table"], true);
    await expect(assertSchemaVersion(pool)).resolves.toBeUndefined();
    expect(mockExit).not.toHaveBeenCalled();
  });
});
