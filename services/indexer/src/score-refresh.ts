import { Pool } from "pg";
import cron from "node-cron";

/**
 * Score refresh service
 * Refreshes the post_scores materialized view on a schedule
 */
export class ScoreRefreshService {
  private pool: Pool;
  private cronJob: cron.ScheduledTask | null = null;
  private refreshIntervalMinutes: number;

  constructor(pool: Pool, refreshIntervalMinutes: number = 5) {
    this.pool = pool;
    this.refreshIntervalMinutes = refreshIntervalMinutes;
  }

  /**
   * Refresh the post_scores materialized view
   */
  async refreshScores(): Promise<void> {
    try {
      await this.pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY post_scores");
      console.log("[score-refresh] Successfully refreshed post_scores materialized view");
    } catch (error) {
      console.error("[score-refresh] Failed to refresh post_scores:", error);
      throw error;
    }
  }

  /**
   * Start the scheduled refresh job
   */
  start(): void {
    if (this.cronJob) {
      console.warn("[score-refresh] Score refresh job already running");
      return;
    }

    const cronExpression = `*/${this.refreshIntervalMinutes} * * * *`;
    console.log(
      `[score-refresh] Starting score refresh job with interval: ${this.refreshIntervalMinutes} minutes`
    );

    this.cronJob = cron.schedule(cronExpression, async () => {
      await this.refreshScores();
    });

    // Run initial refresh
    this.refreshScores().catch((err) => {
      console.error("[score-refresh] Initial refresh failed:", err);
    });
  }

  /**
   * Stop the scheduled refresh job
   */
  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      console.log("[score-refresh] Score refresh job stopped");
    }
  }
}
