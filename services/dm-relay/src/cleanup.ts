/**
 * Background job for cleaning up expired messages.
 */

import * as cron from 'node-cron';
import { Database } from './database';

export class CleanupService {
  private database: Database;
  private ttlDays: number;
  private task: cron.ScheduledTask | null = null;

  constructor(database: Database, ttlDays: number = 7) {
    this.database = database;
    this.ttlDays = ttlDays;
  }

  /**
   * Start the cleanup cron job.
   * Runs daily at 2:00 AM to clean up expired messages.
   */
  start(): void {
    if (this.task) {
      console.warn('Cleanup service is already running');
      return;
    }

    // Run daily at 2:00 AM
    this.task = cron.schedule('0 2 * * *', async () => {
      await this.performCleanup();
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    console.log(`Cleanup service started (TTL: ${this.ttlDays} days)`);
  }

  /**
   * Stop the cleanup cron job.
   */
  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
      console.log('Cleanup service stopped');
    }
  }

  /**
   * Manually trigger cleanup (useful for testing).
   */
  async performCleanup(): Promise<number> {
    try {
      console.log(`Starting cleanup of messages older than ${this.ttlDays} days...`);
      
      const deletedCount = await this.database.deleteExpiredMessages(this.ttlDays);
      
      if (deletedCount > 0) {
        console.log(`Cleanup completed: ${deletedCount} expired messages deleted`);
      } else {
        console.log('Cleanup completed: no expired messages found');
      }
      
      return deletedCount;
    } catch (error) {
      console.error('Cleanup failed:', error);
      throw error;
    }
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