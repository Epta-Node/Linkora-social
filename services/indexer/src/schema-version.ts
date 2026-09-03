import { Pool } from "pg";
import { logger } from "./logger";

/**
 * Tables that must exist for the indexer to function correctly.
 * Each table is the primary deliverable of the numbered migration indicated
 * in the comment. The last entry acts as the forward-progress sentinel:
 * its presence proves that *all* migrations up to that point have been applied.
 */
const REQUIRED_TABLES: ReadonlyArray<string> = [
  "raw_events",          // 006_raw_events
  "indexer_cursor",      // 006_indexer_cursor
  "indexer_state",       // 006_indexer_state
  "device_tokens",       // 007_device_tokens
  "sent_notifications",  // 008_sent_notifications
  "blocks",              // 010_blocks_dm_keys
  "dm_keys",             // 010_blocks_dm_keys
  "notification_preferences", // 011_notification_preferences — sentinel for complete migration set
];

/**
 * Column-level checks that guard against a DB that has the right table names
 * but is still missing a later additive column (e.g. 009_posts_fts).
 */
const REQUIRED_COLUMNS: ReadonlyArray<{ table: string; column: string; migration: string }> = [
  { table: "posts", column: "content_tsv", migration: "009_posts_fts" },
];

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
  const { rows: tableRows } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  );
  const existing = new Set(tableRows.map((r) => r.tablename));

  const missingTables = REQUIRED_TABLES.filter((t) => !existing.has(t));
  if (missingTables.length > 0) {
    logger.error(
      { missingTables },
      "DB schema is out of date — run migrations before starting the indexer:\n" +
        "  bash services/indexer/migrate.sh\n" +
        "  (or: docker compose run --rm migrate)"
    );
    process.exit(1);
  }

  for (const { table, column, migration } of REQUIRED_COLUMNS) {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*)::int AS count
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = $1
          AND column_name  = $2`,
      [table, column]
    );
    if ((rows[0]?.count ?? 0) === 0) {
      logger.error(
        { table, column, migration },
        `DB schema is out of date — column ${table}.${column} is missing (added by ${migration}).\n` +
          "  Run migrations before starting the indexer:\n" +
          "  bash services/indexer/migrate.sh\n" +
          "  (or: docker compose run --rm migrate)"
      );
      process.exit(1);
    }
  }

  logger.info(
    { requiredTables: REQUIRED_TABLES.length, requiredColumns: REQUIRED_COLUMNS.length },
    "Schema version check passed"
  );
}
