/**
 * Background job for cleaning up expired messages.
 */

import * as cron from "node-cron";
import { Database } from "./database";
import { logger } from "./logger";

export class CleanupService {
  private database: Database;
  private ttlDays: number;
  private idempotencyTtlHours: number;
  private task: cron.ScheduledTask | null = null;

  constructor(database: Database, ttlDays: number = 7, idempotencyTtlHours: number = 24) {
    this.database = database;
    this.ttlDays = ttlDays;
    this.idempotencyTtlHours = idempotencyTtlHours;
  }

  /**
   * Start the cleanup cron job.
   * Runs daily at 2:00 AM to clean up expired messages.
   */
  start(): void {
    if (this.task) {
      logger.warn("Cleanup service is already running");
      return;
    }

    // Run daily at 2:00 AM
    this.task = cron.schedule(
      "0 2 * * *",
      async () => {
        await this.performCleanup();
      },
      {
        scheduled: true,
        timezone: "UTC",
      }
    );

    logger.info({ ttlDays: this.ttlDays }, "Cleanup service started");
  }

  /**
   * Stop the cleanup cron job.
   */
  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
      logger.info("Cleanup service stopped");
    }
  }

  /**
   * Manually trigger cleanup (useful for testing).
   */
  async performCleanup(): Promise<number> {
    try {
      logger.info({ ttlDays: this.ttlDays }, "Starting cleanup of messages");

      const deletedCount = await this.database.deleteExpiredMessages(this.ttlDays);

      if (deletedCount > 0) {
        logger.info({ deletedCount }, "Cleanup completed: expired messages deleted");
      } else {
        logger.info("Cleanup completed: no expired messages found");
      }

      await this.performIdempotencyCleanup();

      return deletedCount;
    } catch (error) {
      logger.error({ error }, "Cleanup failed");
      throw error;
    }
  }

  /**
   * Remove idempotency keys older than the configured TTL so retried
   * requests eventually stop being deduplicated and the table doesn't
   * grow unbounded.
   */
  async performIdempotencyCleanup(): Promise<number> {
    logger.info(
      { idempotencyTtlHours: this.idempotencyTtlHours },
      "Starting cleanup of idempotency keys"
    );

    const deletedCount = await this.database.deleteExpiredIdempotencyKeys(this.idempotencyTtlHours);

    if (deletedCount > 0) {
      logger.info({ deletedCount }, "Idempotency cleanup completed: expired keys deleted");
    } else {
      logger.info("Idempotency cleanup completed: no expired keys found");
    }

    return deletedCount;
  }

  /**
   * Get cleanup service status.
   */
  getStatus(): { running: boolean; ttlDays: number; nextRun?: string } {
    return {
      running: this.task !== null,
      ttlDays: this.ttlDays,
      // Note: node-cron doesn't expose next run time easily
    };
  }
}
