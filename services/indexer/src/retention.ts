/**
 * Raw-events retention manager.
 *
 * Responsibilities
 * ────────────────
 *  1. Proactively create the next partition bucket before the live ledger
 *     cursor reaches it, so the "default" catch-all partition is never the
 *     destination of normal writes.
 *
 *  2. Drop (or detach) partitions whose entire ledger range is older than the
 *     configured retention window AND where every row has been processed
 *     (processed_at IS NOT NULL for all rows in that partition).  Only
 *     fully-processed partitions are dropped; if any row in a partition is
 *     still NULL the partition is left in place even if its ledger range has
 *     passed the retention threshold.
 *
 * Partition naming convention (set by migration 012):
 *   raw_events_p<lo>_<hi>   e.g.  raw_events_p0_1000000
 *
 * Configuration (IndexerConfig.retention):
 *   RAW_EVENTS_RETENTION_LEDGERS  — number of ledgers to keep (default 4 000 000,
 *                                   ≈ 231 days at mainnet cadence).
 *   RAW_EVENTS_PARTITION_SIZE     — ledger range per partition (default 1 000 000).
 *
 * The job fires every hour via node-cron.  A no-op when raw_events is not yet
 * partitioned (safe to run against an old schema).
 *
 * Drop strategy
 * ─────────────
 *   We use  DETACH PARTITION … CONCURRENTLY  (PG 14+) where available, which
 *   releases the exclusive lock quickly and lets queries continue.  On PG 11–13
 *   we fall back to a regular  ALTER TABLE … DETACH  then  DROP TABLE.
 *   If the caller sets retentionConfig.archiveOnly = true the partition is only
 *   detached (not dropped) so operators can inspect or archive it manually.
 */

import cron from "node-cron";
import { Pool } from "pg";
import { logger } from "./logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RetentionConfig {
  /**
   * Number of ledgers to keep.
   * Default: 4 000 000 (≈ 231 days at ~1 ledger/5 s mainnet cadence).
   */
  retentionLedgers: number;

  /**
   * Ledger range per partition bucket.
   * Must match the value used when partitions were originally created.
   * Default: 1 000 000.
   */
  partitionSize: number;

  /**
   * When true, only detach old partitions instead of dropping them.
   * Useful for operators who want to archive data before deleting.
   * Default: false.
   */
  archiveOnly: boolean;

  /**
   * cron schedule for the retention job.
   * Default: every hour at minute 5.
   */
  cronSchedule: string;
}

/** Parsed information about a raw_events child partition. */
interface PartitionInfo {
  tableName: string;
  loLedger: bigint;
  hiLedger: bigint;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_RETENTION_CONFIG: RetentionConfig = {
  retentionLedgers: 4_000_000,
  partitionSize: 1_000_000,
  archiveOnly: false,
  cronSchedule: "5 * * * *", // every hour at :05
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Return true when the running PostgreSQL version is 14 or higher (supports
 * DETACH PARTITION … CONCURRENTLY).
 */
async function supportsDetachConcurrently(pool: Pool): Promise<boolean> {
  const res = await pool.query<{ server_version_num: string }>(
    "SELECT current_setting('server_version_num')::int AS server_version_num"
  );
  const versionNum = parseInt(res.rows[0]?.server_version_num ?? "0", 10);
  return versionNum >= 140000;
}

/**
 * List all non-default child partitions of raw_events, parsing their ledger
 * bounds out of the table name.
 *
 * Only considers tables named  raw_events_p<lo>_<hi>  (numeric bounds).
 * The "default" partition and any manually-named partitions are ignored.
 */
async function listPartitions(pool: Pool): Promise<PartitionInfo[]> {
  const res = await pool.query<{ relname: string }>(`
    SELECT c.relname
    FROM   pg_inherits i
    JOIN   pg_class    p ON p.oid = i.inhparent
    JOIN   pg_class    c ON c.oid = i.inhrelid
    JOIN   pg_namespace n ON n.oid = p.relnamespace
    WHERE  p.relname = 'raw_events'
      AND  n.nspname = 'public'
      AND  c.relname ~ '^raw_events_p[0-9]+_[0-9]+$'
    ORDER BY c.relname
  `);

  return res.rows
    .map((row) => {
      const m = row.relname.match(/^raw_events_p(\d+)_(\d+)$/);
      if (!m) return null;
      return {
        tableName: row.relname,
        loLedger: BigInt(m[1]),
        hiLedger: BigInt(m[2]),
      } satisfies PartitionInfo;
    })
    .filter((p): p is PartitionInfo => p !== null);
}

/**
 * Return true when all rows in `tableName` have been processed
 * (no NULL processed_at).  Uses a fast  NOT EXISTS  query so it short-circuits
 * as soon as any unprocessed row is found.
 */
async function isFullyProcessed(pool: Pool, tableName: string): Promise<boolean> {
  // Validate table name to prevent SQL injection (only allow the expected pattern).
  if (!/^raw_events_p\d+_\d+$/.test(tableName)) {
    throw new Error(`Invalid partition table name: ${tableName}`);
  }
  const res = await pool.query<{ has_unprocessed: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM ${tableName} WHERE processed_at IS NULL LIMIT 1
    ) AS has_unprocessed
  `);
  return !res.rows[0]?.has_unprocessed;
}

// ── Core logic ────────────────────────────────────────────────────────────────

/**
 * Create the next partition bucket if it does not already exist.
 *
 * @param currentLedger  The indexer's current processed ledger cursor.
 * @param cfg            Retention config (uses partitionSize).
 * @param pool           PG connection pool.
 */
export async function ensureNextPartition(
  currentLedger: bigint,
  cfg: RetentionConfig,
  pool: Pool
): Promise<void> {
  const size = BigInt(cfg.partitionSize);
  // The bucket that will be needed one partition-size ahead of the current cursor.
  const nextBucketLo = (currentLedger / size + 1n) * size;
  const nextBucketHi = nextBucketLo + size;
  const tableName = `raw_events_p${nextBucketLo}_${nextBucketHi}`;

  const exists = await pool.query<{ exists: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS exists",
    [`public.${tableName}`]
  );

  if (!exists.rows[0]?.exists) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${tableName}
        PARTITION OF raw_events
        FOR VALUES FROM (${nextBucketLo}) TO (${nextBucketHi})
    `);
    logger.info(
      { tableName, lo: String(nextBucketLo), hi: String(nextBucketHi) },
      "raw_events: created new partition"
    );
  }
}

/**
 * Drop (or detach) partitions that are:
 *   – entirely older than  retentionHead - retentionLedgers
 *   – fully processed (no unprocessed rows)
 *
 * The retention head is derived from BOTH the live cursor and the newest
 * partition actually present on disk (`max(currentLedger, newestPartitionHi)`),
 * and the partition list is re-read fresh every cycle.  Anchoring the cutoff
 * to a single pre-loop value taken only from the cursor starves retention
 * when the cursor lags behind migrated partitions (migration 012 replay) or
 * when no new partition has been created yet.
 *
 * @param currentLedger  The indexer's current processed ledger cursor.
 * @param cfg            Retention config.
 * @param pool           PG connection pool.
 * @returns              Names of the partitions that were removed.
 */
export async function dropOldPartitions(
  currentLedger: bigint,
  cfg: RetentionConfig,
  pool: Pool
): Promise<string[]> {
  const retentionLedgers = BigInt(cfg.retentionLedgers);
  const partitionSize = BigInt(cfg.partitionSize);

  const partitions = await listPartitions(pool);
  // No partitions to manage — nothing to drop, and nothing that can error.
  if (partitions.length === 0) return [];

  // Recompute the cutoff against the data actually present rather than a
  // fixed pre-loop value.  The oldest-present/newest-present bounds are
  // derived from the fresh partition list, so a cursor that is far behind
  // existing partitions (migration replay) can never compute a bogus
  // "before epoch" cutoff that silently stops retention.
  const newestHi = partitions.reduce((max, p) => (p.hiLedger > max ? p.hiLedger : max), 0n);
  const retentionHead = currentLedger > newestHi ? currentLedger : newestHi;

  // Underflow guard: when the present data span is smaller than the retention
  // window the cutoff would fall below the first partition's start — that
  // means nothing is old enough to drop yet.
  if (retentionHead <= retentionLedgers) return [];

  const cutoff = retentionHead - retentionLedgers;

  const detachConcurrently = await supportsDetachConcurrently(pool);
  const dropped: string[] = [];

  for (const p of partitions) {
    // Only consider partitions whose entire range is safely below the cutoff.
    // We require hi + partitionSize < cutoff (one bucket of headroom) so that
    // the partition immediately adjacent to the retention boundary is never
    // dropped until a full extra partition-size has elapsed.  The comparison
    // is written additively so it can never underflow.
    if (p.hiLedger + partitionSize >= cutoff) continue;

    const processed = await isFullyProcessed(pool, p.tableName);
    if (!processed) {
      logger.warn(
        { tableName: p.tableName, hiLedger: String(p.hiLedger), cutoff: String(cutoff) },
        "raw_events: partition is past retention window but has unprocessed rows — skipping drop"
      );
      continue;
    }

    try {
      if (cfg.archiveOnly) {
        // Detach only — operator decides what to do with the orphaned table.
        if (detachConcurrently) {
          await pool.query(`ALTER TABLE raw_events DETACH PARTITION ${p.tableName} CONCURRENTLY`);
        } else {
          await pool.query(`ALTER TABLE raw_events DETACH PARTITION ${p.tableName}`);
        }
        logger.info({ tableName: p.tableName }, "raw_events: detached old partition (archiveOnly)");
      } else {
        // Detach then drop.
        if (detachConcurrently) {
          await pool.query(`ALTER TABLE raw_events DETACH PARTITION ${p.tableName} CONCURRENTLY`);
        } else {
          await pool.query(`ALTER TABLE raw_events DETACH PARTITION ${p.tableName}`);
        }
        await pool.query(`DROP TABLE IF EXISTS ${p.tableName}`);
        logger.info({ tableName: p.tableName }, "raw_events: dropped old partition");
      }
      dropped.push(p.tableName);
    } catch (err) {
      logger.error(
        { tableName: p.tableName, err },
        "raw_events: failed to remove old partition — skipping"
      );
    }
  }

  return dropped;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

export class RawEventsRetentionManager {
  private readonly pool: Pool;
  private readonly cfg: RetentionConfig;
  private task: ReturnType<typeof cron.schedule> | null = null;

  constructor(pool: Pool, cfg: Partial<RetentionConfig> = {}) {
    this.pool = pool;
    this.cfg = { ...DEFAULT_RETENTION_CONFIG, ...cfg };
  }

  /**
   * Run one maintenance cycle immediately.  Called by the cron job and also
   * available for direct invocation in tests / CLI.
   *
   * @param currentLedger  Current processed ledger cursor from indexer_cursor.
   */
  async runOnce(currentLedger: bigint): Promise<void> {
    // Skip if raw_events is not yet partitioned (e.g. migration 012 not run).
    const isPartitioned = await this.pool
      .query<{ is_partitioned: boolean }>(
        `SELECT relkind = 'p' AS is_partitioned
           FROM pg_class
          WHERE relname = 'raw_events'
            AND relnamespace = 'public'::regnamespace`
      )
      .then((r) => r.rows[0]?.is_partitioned ?? false);

    if (!isPartitioned) {
      logger.debug("raw_events retention: table is not partitioned yet — skipping");
      return;
    }

    await ensureNextPartition(currentLedger, this.cfg, this.pool);
    const dropped = await dropOldPartitions(currentLedger, this.cfg, this.pool);

    if (dropped.length > 0) {
      logger.info(
        { dropped, retentionLedgers: this.cfg.retentionLedgers },
        "raw_events: retention cycle complete"
      );
    } else {
      logger.debug("raw_events: retention cycle — nothing to drop");
    }
  }

  /**
   * Read the current ledger cursor from the database, then run one cycle.
   * Falls back to 0 if the cursor row does not exist yet.
   */
  private async runWithCurrentCursor(): Promise<void> {
    try {
      const res = await this.pool.query<{ processed_cursor: string }>(
        "SELECT processed_cursor FROM indexer_cursor ORDER BY processed_cursor DESC LIMIT 1"
      );
      const cursor = BigInt(res.rows[0]?.processed_cursor ?? "0");
      await this.runOnce(cursor);
    } catch (err) {
      logger.error({ err }, "raw_events: retention cycle failed");
    }
  }

  /** Start the hourly cron job. Safe to call multiple times (no-op if running). */
  start(): void {
    if (this.task) return;

    if (!cron.validate(this.cfg.cronSchedule)) {
      throw new Error(
        `Invalid cron schedule for RawEventsRetentionManager: "${this.cfg.cronSchedule}"`
      );
    }

    this.task = cron.schedule(this.cfg.cronSchedule, () => {
      void this.runWithCurrentCursor();
    });

    logger.info(
      {
        schedule: this.cfg.cronSchedule,
        retentionLedgers: this.cfg.retentionLedgers,
        partitionSize: this.cfg.partitionSize,
        archiveOnly: this.cfg.archiveOnly,
      },
      "raw_events: retention manager started"
    );
  }

  /** Stop the cron job. */
  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
      logger.info("raw_events: retention manager stopped");
    }
  }
}
