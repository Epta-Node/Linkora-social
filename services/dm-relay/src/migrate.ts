/**
 * Standalone migration runner for the DM relay service.
 *
 * Reads .sql files from the migrations/ directory, applies any that have
 * not yet been recorded in the schema_migrations table, and exits.
 *
 * Usage:
 *   tsx src/migrate.ts           # apply pending migrations
 *   tsx src/migrate.ts rollback  # undo the last applied migration
 */

import { Pool } from "pg";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { logger } from "./logger";

dotenv.config();

const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");

interface Migration {
  filename: string;
  sql: string;
}

function loadMigrations(): Migration[] {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  return files.map((filename) => ({
    filename,
    sql: fs.readFileSync(path.join(MIGRATIONS_DIR, filename), "utf-8"),
  }));
}

async function ensureSchemaMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getAppliedMigrations(pool: Pool): Promise<Set<string>> {
  const result = await pool.query("SELECT filename FROM schema_migrations ORDER BY filename");
  return new Set(result.rows.map((r) => r.filename));
}

async function applyPending(pool: Pool): Promise<number> {
  const migrations = loadMigrations();
  const applied = await getAppliedMigrations(pool);
  let count = 0;

  for (const migration of migrations) {
    if (applied.has(migration.filename)) continue;

    logger.info({ migration: migration.filename }, "Applying migration");
    await pool.query("BEGIN");
    try {
      await pool.query(migration.sql);
      await pool.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [
        migration.filename,
      ]);
      await pool.query("COMMIT");
      logger.info({ migration: migration.filename }, "Migration applied successfully");
      count++;
    } catch (error) {
      await pool.query("ROLLBACK");
      logger.error({ migration: migration.filename, err: error }, "Migration failed");
      throw error;
    }
  }

  return count;
}

async function rollbackLast(pool: Pool): Promise<void> {
  const result = await pool.query(
    "SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1"
  );

  if (result.rows.length === 0) {
    logger.info("No migrations to rollback");
    return;
  }

  const { filename } = result.rows[0];
  const migrations = loadMigrations();
  const migration = migrations.find((m) => m.filename === filename);

  if (!migration) {
    logger.error({ migration: filename }, "Migration file not found on disk — cannot rollback");
    process.exit(1);
  }

  logger.warn({ migration: filename }, "Rolling back migration (manual verification recommended)");

  await pool.query("BEGIN");
  try {
    await pool.query("DELETE FROM schema_migrations WHERE filename = $1", [filename]);
    await pool.query("COMMIT");
    logger.info(
      { migration: filename },
      "Migration record removed — manual table rollback may be needed"
    );
  } catch (error) {
    await pool.query("ROLLBACK");
    logger.error({ migration: filename, err: error }, "Rollback failed");
    throw error;
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    await ensureSchemaMigrationsTable(pool);

    const command = process.argv[2];
    if (command === "rollback") {
      await rollbackLast(pool);
    } else {
      const count = await applyPending(pool);
      if (count === 0) {
        logger.info("All migrations already applied");
      } else {
        logger.info({ count }, "Migrations applied");
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
