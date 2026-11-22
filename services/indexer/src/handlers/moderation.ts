/**
 * Moderation Event Handlers
 * Handles PostReportedEvent, ReportDismissedEvent, and PostRemovedByModerationEvent
 */

import { Database } from "../db";
import { logger } from "../logger";

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
  reason?: string;
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
  db: Database,
  event: PostReportedEvent,
  _context: ModerationEventContext
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

    logger.info(
      { postId: post_id.toString(), reporterAddress: reporter_address, reason },
      "Post reported"
    );
  } catch (error) {
    logger.error(
      { postId: post_id.toString(), reporterAddress: reporter_address, err: error },
      "Error handling PostReportedEvent"
    );
    throw error;
  }
}

/**
 * Handle ReportDismissedEvent
 * Updates report status to 'dismissed'
 * Idempotent: Only updates if status is still 'pending'
 */
export async function handleReportDismissed(
  db: Database,
  event: ReportDismissedEvent,
  _context: ModerationEventContext
): Promise<void> {
  const { post_id, reporter_address, moderator_address, moderator_notes, reason } = event;

  try {
    await db.updateReportStatus(
      post_id,
      reporter_address,
      "dismissed",
      moderator_address,
      moderator_notes
    );

    logger.info(
      {
        postId: post_id.toString(),
        reporterAddress: reporter_address,
        moderatorAddress: moderator_address,
        reason,
      },
      "Report dismissed"
    );
  } catch (error) {
    logger.error(
      { postId: post_id.toString(), reporterAddress: reporter_address, err: error },
      "Error handling ReportDismissedEvent"
    );
    throw error;
  }
}

/**
 * Handle PostRemovedByModerationEvent
 * Updates all pending reports for the post to 'action_taken' and marks post as deleted
 * Idempotent: Only updates reports with 'pending' status
 */
export async function handlePostRemovedByModeration(
  db: Database,
  event: PostRemovedByModerationEvent,
  context: ModerationEventContext
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
    }

    logger.info(
      { postId: post_id.toString(), moderatorAddress: moderator_address, reason },
      "Post removed by moderation"
    );
  } catch (error) {
    logger.error(
      { postId: post_id.toString(), moderatorAddress: moderator_address, err: error },
      "Error handling PostRemovedByModerationEvent"
    );
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
