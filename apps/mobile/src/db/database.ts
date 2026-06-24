import { DATABASE_NAME, MIGRATIONS } from "./schema";

/**
 * Minimal async SQL driver interface used by {@link ./SqlitePostStore}.
 *
 * It mirrors the promise-based surface of modern `expo-sqlite` while remaining
 * decoupled from it, so the store can be exercised against any driver.
 */
export interface SqlDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: unknown[]): Promise<void>;
  getAllAsync<T>(sql: string, params?: unknown[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params?: unknown[]): Promise<T | null>;
}

/**
 * Opens `linkora.db` and applies migrations.
 *
 * `expo-sqlite` is imported lazily so that environments without the native
 * module (web, Jest) can fall back to the in-memory store without crashing at
 * import time. Returns `null` when the module is unavailable.
 */
export async function openLinkoraDatabase(): Promise<SqlDatabase | null> {
  let SQLite: typeof import("expo-sqlite") | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    SQLite = require("expo-sqlite");
  } catch {
    return null;
  }
  if (!SQLite) return null;

  const driver = createDriver(SQLite);
  if (!driver) return null;

  for (const migration of MIGRATIONS) {
    await driver.execAsync(migration);
  }
  return driver;
}

/**
 * Adapts whichever `expo-sqlite` API surface is present (the modern
 * `openDatabaseAsync` or the legacy `openDatabase` callback API) to
 * {@link SqlDatabase}.
 */
function createDriver(SQLite: typeof import("expo-sqlite")): SqlDatabase | null {
  const sqlite = SQLite as unknown as Record<string, unknown>;

  // Modern async API (expo-sqlite >= SDK 50): already promise based.
  if (typeof sqlite.openDatabaseSync === "function") {
    const db = (sqlite.openDatabaseSync as (name: string) => SqlDatabase)(DATABASE_NAME);
    if (db && typeof db.getAllAsync === "function") {
      return db;
    }
  }

  // Legacy callback API (expo-sqlite SDK 49): wrap `transaction`/`executeSql`.
  if (typeof sqlite.openDatabase === "function") {
    const legacy = (sqlite.openDatabase as (name: string) => LegacyDatabase)(DATABASE_NAME);
    return wrapLegacyDatabase(legacy);
  }

  return null;
}

interface LegacyResultSet {
  rows: { _array?: unknown[]; length: number; item: (i: number) => unknown };
}
interface LegacyTransaction {
  executeSql: (
    sql: string,
    params: unknown[],
    success: (tx: LegacyTransaction, result: LegacyResultSet) => void,
    error: (tx: LegacyTransaction, err: unknown) => boolean
  ) => void;
}
interface LegacyDatabase {
  transaction: (
    cb: (tx: LegacyTransaction) => void,
    error?: (err: unknown) => void,
    success?: () => void
  ) => void;
}

function wrapLegacyDatabase(db: LegacyDatabase): SqlDatabase {
  const run = <T>(sql: string, params: unknown[]): Promise<T[]> =>
    new Promise((resolve, reject) => {
      db.transaction(
        (tx) => {
          tx.executeSql(
            sql,
            params,
            (_tx, result) => {
              const rows = result.rows._array ?? [];
              resolve(rows as T[]);
            },
            (_tx, err) => {
              reject(err);
              return true;
            }
          );
        },
        (err) => reject(err)
      );
    });

  return {
    async execAsync(sql) {
      // The legacy API does not run multi-statement strings, but every
      // migration here is a single statement so this is safe.
      await run(sql, []);
    },
    async runAsync(sql, params = []) {
      await run(sql, params);
    },
    async getAllAsync<T>(sql: string, params: unknown[] = []) {
      return run<T>(sql, params);
    },
    async getFirstAsync<T>(sql: string, params: unknown[] = []) {
      const rows = await run<T>(sql, params);
      return rows.length > 0 ? rows[0] : null;
    },
  };
}
