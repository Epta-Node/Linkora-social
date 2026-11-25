import { Pool } from "pg";
import { logger } from "./logger";

/**
 * Tables that must exist for the indexer to function correctly.
 * Each table is the primary deliverable of the numbered migration indicated
 * in the comment. The last entry acts as the forward-progress sentinel:
 * its presence proves that *all* migrations up to that point have been applied.
 */
const REQUIRED_TABLES: ReadonlyArray<string> = [
  "raw_events", // 008_raw_events
  "indexer_cursor", // 006_indexer_cursor
  "indexer_state", // 007_indexer_state
  "device_tokens", // 009_device_tokens
  "sent_notifications", // 010_sent_notifications
  "blocks", // 015_blocks_dm_keys
  "dm_keys", // 015_blocks_dm_keys
  "notification_preferences", // 016_notification_preferences — sentinel for complete migration set
];

/**
 * Column-level checks that guard against a DB that has the right table names
 * but is still missing a later additive column (e.g. 013_posts_fts).
 */
const REQUIRED_COLUMNS: ReadonlyArray<{ table: string; column: string; migration: string }> = [
  { table: "posts", column: "content_tsv", migration: "013_posts_fts" },
];

export interface SchemaVersionStatus {
  status: "up" | "pending";
  missingTables: string[];
  missingColumns: Array<{ table: string; column: string; migration: string }>;
}

/** Inspect migration prerequisites without terminating the process. */
export async function inspectSchemaVersion(pool: Pool): Promise<SchemaVersionStatus> {
  const { rows: tableRows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  );
  const existing = new Set(tableRows.map((row) => row.tablename));
  const missingTables = REQUIRED_TABLES.filter((table) => !existing.has(table));
  const missingColumns: SchemaVersionStatus["missingColumns"] = [];

  for (const requirement of REQUIRED_COLUMNS) {
    const { rows } = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = $1
          AND column_name  = $2`,
      [requirement.table, requirement.column]
    );
    if ((rows[0]?.count ?? 0) === 0) missingColumns.push(requirement);
  }

  return {
    status: missingTables.length === 0 && missingColumns.length === 0 ? "up" : "pending",
    missingTables,
    missingColumns,
  };
}

/**
 * Verifies that the database schema is up to date before the indexer begins
 * processing events.  Exits the process with a descriptive error if any
 * required table or column is missing so that an operator knows immediately
 * that migrations need to be run rather than silently starting against a stale
 * schema.
 *
 * Call this once during startup, after the pool is established and before any
 * application queries are issued.
 */
export async function assertSchemaVersion(pool: Pool): Promise<void> {
  const { missingTables, missingColumns } = await inspectSchemaVersion(pool);
  if (missingTables.length > 0) {
    logger.error(
      { missingTables },
      "DB schema is out of date — run migrations before starting the indexer:\n" +
        "  bash services/indexer/migrate.sh\n" +
        "  (or: docker compose run --rm migrate)"
    );
    process.exit(1);
  }

  if (missingColumns.length > 0) {
    logger.error(
      { missingColumns },
      "DB schema is out of date — required columns are missing. Run migrations before starting the indexer."
    );
    process.exit(1);
  }

  logger.info(
    { requiredTables: REQUIRED_TABLES.length, requiredColumns: REQUIRED_COLUMNS.length },
    "Schema version check passed"
  );
}
