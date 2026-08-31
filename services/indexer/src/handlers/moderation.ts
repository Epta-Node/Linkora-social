/**
 * Moderation Event Handlers
 * Handles PostReportedEvent, ReportDismissedEvent, and PostRemovedByModerationEvent
 */

import { Pool } from "pg";
import { Database } from "../db";

export interface PostReportedEvent {
  post_id: bigint;
  reporter_address: string;
  reason: string;
}

export interface ReportDismissedEvent {
  post_id: bigint;
  reporter_address: string;
  moderator_address: string;
  moderator_notes?: string;
}

export interface PostRemovedByModerationEvent {
  post_id: bigint;
  moderator_address: string;
  reason: string;
}

export interface ModerationEventContext {
  txHash: string;
  ledgerSeq: number;
  timestamp: Date;
}

/**
 * Handle PostReportedEvent
 * Inserts a new report into the reports table
 * Idempotent: Uses ON CONFLICT to prevent duplicate reports from same reporter
 */
export async function handlePostReported(
  pool: Pool,
  event: PostReportedEvent,
  _context: ModerationEventContext,
  db: Database
): Promise<void> {
  const { post_id, reporter_address, reason } = event;
  const now = new Date();

  try {
    await db.insertReport({
      post_id,
      reporter_address,
      reason,
      status: "pending",
      created_at: now,
      updated_at: now,
    });

    console.log(`Post ${post_id} reported by ${reporter_address}: ${reason}`);

    // TODO: Dispatch notification to post author
    // await dispatchNotification(post_author, 'post_reported', { post_id, reason });
  } catch (error) {
    console.error(`Error handling PostReportedEvent for post ${post_id}:`, error);
    throw error;
  }
}

/**
 * Handle ReportDismissedEvent
 * Updates report status to 'dismissed'
 * Idempotent: Only updates if status is still 'pending'
 */
export async function handleReportDismissed(
  pool: Pool,
  event: ReportDismissedEvent,
  _context: ModerationEventContext,
  db: Database
): Promise<void> {
  const { post_id, reporter_address, moderator_address, moderator_notes } = event;

  try {
    await db.updateReportStatus(
      post_id,
      reporter_address,
      "dismissed",
      moderator_address,
      moderator_notes
    );

    console.log(
      `Report for post ${post_id} by ${reporter_address} dismissed by ${moderator_address}`
    );

    // TODO: Dispatch notification to reporter
    // await dispatchNotification(reporter_address, 'report_dismissed', { post_id, moderator_notes });
  } catch (error) {
    console.error(`Error handling ReportDismissedEvent for post ${post_id}:`, error);
    throw error;
  }
}

/**
 * Handle PostRemovedByModerationEvent
 * Updates all pending reports for the post to 'action_taken' and marks post as deleted
 * Idempotent: Only updates reports with 'pending' status
 */
export async function handlePostRemovedByModeration(
  pool: Pool,
  event: PostRemovedByModerationEvent,
  context: ModerationEventContext,
  db: Database
): Promise<void> {
  const { post_id, moderator_address, reason } = event;
  const { ledgerSeq } = context;

  try {
    // 1. Mark the post as deleted
    await db.markPostDeleted(post_id, ledgerSeq);

    // 2. Update all pending reports for this post to 'action_taken'
    const reports = await db.getPostReports(post_id);
    const pendingReports = reports.filter((r) => r.status === "pending");

    for (const report of pendingReports) {
      await db.updateReportStatus(
        post_id,
        report.reporter_address,
        "action_taken",
        moderator_address,
        reason
      );

      // TODO: Dispatch notification to reporter
      // await dispatchNotification(report.reporter_address, 'post_removed_by_moderation', { post_id, reason });
    }

    console.log(`Post ${post_id} removed by moderation (${moderator_address}): ${reason}`);
  } catch (error) {
    console.error(`Error handling PostRemovedByModerationEvent for post ${post_id}:`, error);
    throw error;
  }
}

/**
 * Unit test helper: Mock event data
 */
export function createMockPostReportedEvent(
  post_id: bigint = 1n,
  reporter_address: string = "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  reason: string = "Spam"
): { event: PostReportedEvent; context: ModerationEventContext } {
  return {
    event: { post_id, reporter_address, reason },
    context: {
      txHash: "0x1234567890abcdef",
      ledgerSeq: 12345,
      timestamp: new Date(),
    },
  };
}

export function createMockReportDismissedEvent(
  post_id: bigint = 1n,
  reporter_address: string = "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  moderator_address: string = "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  moderator_notes?: string
): { event: ReportDismissedEvent; context: ModerationEventContext } {
  return {
    event: { post_id, reporter_address, moderator_address, moderator_notes },
    context: {
      txHash: "0xabcdef1234567890",
      ledgerSeq: 12346,
      timestamp: new Date(),
    },
  };
}

export function createMockPostRemovedByModerationEvent(
  post_id: bigint = 1n,
  moderator_address: string = "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  reason: string = "Violates community guidelines"
): { event: PostRemovedByModerationEvent; context: ModerationEventContext } {
  return {
    event: { post_id, moderator_address, reason },
    context: {
      txHash: "0xfedcba0987654321",
      ledgerSeq: 12347,
      timestamp: new Date(),
    },
  };
}
