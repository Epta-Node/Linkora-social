/**
 * Handlers for Follow and Unfollow contract events.
 */

import { Database } from "../db";
import { NotificationService } from "../notifications/service";

export interface FollowEvent {
  follower: string;
  followee: string;
  ledger: number;
}

export interface UnfollowEvent {
  follower: string;
  followee: string;
  ledger: number;
}

/**
 * Handle a Follow event.
 *
 * Inserts a directed edge (follower → followee) into the follow graph.
 * Idempotent: the underlying upsert on (follower, followee) is safe to
 * replay.
 */
export async function handleFollow(
  source: Database | { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  event: FollowEvent,
  options?: { notificationService?: NotificationService }
): Promise<void> {
  if (!event.follower) {
    throw new Error("Follow event missing required field: follower");
  }
  if (!event.followee) {
    throw new Error("Follow event missing required field: followee");
  }

  if ("query" in source) {
    await source.query(
      `
      INSERT INTO follows (follower, followee, created_at)
      VALUES ($1, $2, to_timestamp($3))
      ON CONFLICT (follower, followee) DO NOTHING
      `,
      [event.follower, event.followee, event.ledger]
    );
  } else {
    await source.insertFollow({
      follower: event.follower,
      followee: event.followee,
      ledger: event.ledger,
    });
  }

  if (options?.notificationService) {
    try {
      await options.notificationService.dispatchEventNotification({
        type: "FOLLOW",
        recipient: event.followee,
        payload: {
          followerAddress: event.follower,
          deepLink: `linkora://profile/${event.follower}`,
        },
      });
    } catch (error) {
      console.warn("Failed to dispatch follow notification:", error);
    }
  }
}

/**
 * Handle an Unfollow event.
 *
 * Removes the directed edge (follower → followee) from the follow graph.
 * Idempotent: deleting a non-existent edge is a no-op.
 */
export async function handleUnfollow(
  source: Database | { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  event: UnfollowEvent
): Promise<void> {
  if (!event.follower) {
    throw new Error("Unfollow event missing required field: follower");
  }
  if (!event.followee) {
    throw new Error("Unfollow event missing required field: followee");
  }

  if ("query" in source) {
    await source.query(`DELETE FROM follows WHERE follower = $1 AND followee = $2`, [
      event.follower,
      event.followee,
    ]);
  } else {
    await source.deleteFollow(event.follower, event.followee);
  }
}
