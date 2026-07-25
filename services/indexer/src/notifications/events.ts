import { Pool } from "pg";
import { scValToNative, xdr } from "@stellar/stellar-sdk";
import { ALL_EVENTS, EventBus, BusEvent } from "../bus";
import { NotificationService } from "./service";

type LinkoraNotificationEvent =
  | {
      type: "follow";
      follower: string;
      followee: string;
    }
  | {
      type: "tip";
      tipper: string;
      post_id: bigint;
      amount: bigint;
    }
  | {
      type: "like";
      user: string;
      post_id: bigint;
    }
  | {
      type: "post_reported";
      post_id: bigint;
      reporter_address: string;
      reason: string;
    }
  | {
      type: "report_dismissed";
      post_id: bigint;
      reporter_address: string;
      moderator_notes?: string;
    }
  | {
      type: "post_removed_by_moderation";
      post_id: bigint;
      moderator_address: string;
      reason: string;
    };

const EVENT_NAMES: Record<string, LinkoraNotificationEvent["type"]> = {
  follow: "follow",
  Follow: "follow",
  tip: "tip",
  Tip: "tip",
  like: "like",
  Like: "like",
  post_reported: "post_reported",
  PostReported: "post_reported",
  report_dismissed: "report_dismissed",
  ReportDismissed: "report_dismissed",
  post_removed_by_moderation: "post_removed_by_moderation",
  PostRemovedByModeration: "post_removed_by_moderation",
};

function decodeScVal(encoded: string): unknown {
  return scValToNative(xdr.ScVal.fromXDR(encoded, "base64"));
}

function decodeTopics(topics: string[]): unknown[] {
  const decoded: unknown[] = [];
  for (const topic of topics) {
    try {
      decoded.push(decodeScVal(topic));
    } catch {
      decoded.push(topic);
    }
  }
  return decoded;
}

function decodeData(data: unknown): Record<string, unknown> {
  const encoded =
    typeof data === "string"
      ? data
      : data && typeof data === "object" && "value" in data
        ? (data as { value?: unknown }).value
        : undefined;

  if (typeof encoded !== "string") {
    return {};
  }

  try {
    const decoded = decodeScVal(encoded);
    if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
      return decoded as Record<string, unknown>;
    }
  } catch {
    return {};
  }

  return {};
}

function payloadFrom(topics: unknown[], data: Record<string, unknown>): Record<string, unknown> {
  const payload = { ...data };
  for (const topic of topics) {
    if (topic && typeof topic === "object" && !Array.isArray(topic)) {
      Object.assign(payload, topic);
    }
  }
  return payload;
}

function findEventType(topics: unknown[]): LinkoraNotificationEvent["type"] | null {
  for (const topic of topics) {
    if (typeof topic === "string" && EVENT_NAMES[topic]) {
      return EVENT_NAMES[topic];
    }
  }

  return null;
}

function asString(value: unknown): string {
  return String(value);
}

function asBigInt(value: unknown): bigint {
  return typeof value === "bigint" ? value : BigInt(String(value));
}

export function parseNotificationEvent(event: BusEvent): LinkoraNotificationEvent | null {
  const topics = decodeTopics(event.topic);
  const type = findEventType(topics);
  if (!type) {
    return null;
  }

  const payload = payloadFrom(topics, decodeData(event.data));

  try {
    switch (type) {
      case "follow":
        return {
          type,
          follower: asString(payload.follower),
          followee: asString(payload.followee),
        };
      case "tip":
        return {
          type,
          tipper: asString(payload.tipper),
          post_id: asBigInt(payload.post_id),
          amount: asBigInt(payload.amount),
        };
      case "like":
        return {
          type,
          user: asString(payload.user),
          post_id: asBigInt(payload.post_id),
        };
      case "post_reported":
        return {
          type,
          post_id: asBigInt(payload.post_id),
          reporter_address: asString(payload.reporter_address ?? payload.reporter),
          reason: asString(payload.reason),
        };
      case "report_dismissed":
        return {
          type,
          post_id: asBigInt(payload.post_id),
          reporter_address: asString(payload.reporter_address ?? payload.reporter),
          moderator_notes: asString(payload.moderator_notes) || undefined,
        };
      case "post_removed_by_moderation":
        return {
          type,
          post_id: asBigInt(payload.post_id),
          moderator_address: asString(payload.moderator_address ?? payload.moderator),
          reason: asString(payload.reason),
        };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

async function getPostAuthor(pool: Pool, postId: bigint): Promise<string | null> {
  const result = await pool.query<{ author: string }>(
    "SELECT author FROM posts WHERE id = $1 AND deleted_at IS NULL",
    [postId.toString()]
  );

  return result.rows[0]?.author ?? null;
}

function makeDispatchKey(eventId: number, eventType: string, recipient: string): string {
  return `${eventId}|${eventType}|${recipient}`;
}

async function isAlreadyDispatched(
  pool: Pool,
  event: BusEvent,
  eventType: string,
  recipient: string
): Promise<boolean> {
  const dispatchKey = makeDispatchKey(
    event.ledgerSequence * 1000 + event.eventIndex,
    eventType,
    recipient
  );

  const result = await pool.query(`SELECT 1 FROM sent_notifications WHERE dispatch_key = $1`, [
    dispatchKey,
  ]);

  return result.rows.length > 0;
}

async function markDispatched(
  pool: Pool,
  event: BusEvent,
  eventType: string,
  recipient: string
): Promise<void> {
  const eventId = event.ledgerSequence * 1000 + event.eventIndex;
  const dispatchKey = makeDispatchKey(eventId, eventType, recipient);

  await pool.query(
    `INSERT INTO sent_notifications (event_id, event_type, recipient, dispatch_key)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (dispatch_key) DO NOTHING`,
    [eventId, eventType, recipient, dispatchKey]
  );
}

export async function dispatchNotificationForBusEvent(
  pool: Pool,
  notificationService: NotificationService,
  event: BusEvent
): Promise<boolean> {
  const parsed = parseNotificationEvent(event);
  if (!parsed) {
    return false;
  }

  switch (parsed.type) {
    case "follow": {
      if (await isAlreadyDispatched(pool, event, "follow", parsed.followee)) {
        return false;
      }
      const followResult = await notificationService.dispatchEventNotification({
        type: "FOLLOW",
        recipient: parsed.followee,
        payload: {
          followerAddress: parsed.follower,
          deepLink: `linkora://profile/${parsed.follower}`,
        },
      });
      if (followResult) {
        await markDispatched(pool, event, "follow", parsed.followee);
      }
      return followResult;
    }
    case "tip": {
      const recipient = await getPostAuthor(pool, parsed.post_id);
      if (!recipient || recipient === parsed.tipper) {
        return false;
      }

      if (await isAlreadyDispatched(pool, event, "tip", recipient)) {
        return false;
      }
      const tipResult = await notificationService.dispatchEventNotification({
        type: "TIP_RECEIVED",
        recipient,
        payload: {
          senderAddress: parsed.tipper,
          postId: parsed.post_id.toString(),
          amount: parsed.amount.toString(),
          deepLink: `linkora://post/${parsed.post_id.toString()}`,
        },
      });
      if (tipResult) {
        await markDispatched(pool, event, "tip", recipient);
      }
      return tipResult;
    }
    case "like": {
      const recipient = await getPostAuthor(pool, parsed.post_id);
      if (!recipient || recipient === parsed.user) {
        return false;
      }

      if (await isAlreadyDispatched(pool, event, "like", recipient)) {
        return false;
      }
      const likeResult = await notificationService.dispatchEventNotification({
        type: "LIKE_RECEIVED",
        recipient,
        payload: {
          senderAddress: parsed.user,
          postId: parsed.post_id.toString(),
          deepLink: `linkora://post/${parsed.post_id.toString()}`,
        },
      });
      if (likeResult) {
        await markDispatched(pool, event, "like", recipient);
      }
      return likeResult;
    }
    case "post_reported": {
      const recipient = await getPostAuthor(pool, parsed.post_id);
      if (!recipient) {
        return false;
      }

      if (await isAlreadyDispatched(pool, event, "post_reported", recipient)) {
        return false;
      }
      const reportResult = await notificationService.dispatchEventNotification({
        type: "POST_REPORTED",
        recipient,
        payload: {
          postId: parsed.post_id.toString(),
          reporterAddress: parsed.reporter_address,
          reason: parsed.reason,
          deepLink: `linkora://post/${parsed.post_id.toString()}`,
        },
      });
      if (reportResult) {
        await markDispatched(pool, event, "post_reported", recipient);
      }
      return reportResult;
    }
    case "report_dismissed": {
      if (await isAlreadyDispatched(pool, event, "report_dismissed", parsed.reporter_address)) {
        return false;
      }
      const dismissResult = await notificationService.dispatchEventNotification({
        type: "REPORT_DISMISSED",
        recipient: parsed.reporter_address,
        payload: {
          postId: parsed.post_id.toString(),
          moderatorNotes: parsed.moderator_notes,
          deepLink: `linkora://post/${parsed.post_id.toString()}`,
        },
      });
      if (dismissResult) {
        await markDispatched(pool, event, "report_dismissed", parsed.reporter_address);
      }
      return dismissResult;
    }
    case "post_removed_by_moderation": {
      // Notify all reporters who had pending reports for this post
      // For simplicity, we'll notify the post author about the removal
      const recipient = await getPostAuthor(pool, parsed.post_id);
      if (!recipient) {
        return false;
      }

      if (await isAlreadyDispatched(pool, event, "post_removed_by_moderation", recipient)) {
        return false;
      }
      const removalResult = await notificationService.dispatchEventNotification({
        type: "POST_REMOVED_BY_MODERATION",
        recipient,
        payload: {
          postId: parsed.post_id.toString(),
          moderatorAddress: parsed.moderator_address,
          reason: parsed.reason,
          deepLink: `linkora://post/${parsed.post_id.toString()}`,
        },
      });
      if (removalResult) {
        await markDispatched(pool, event, "post_removed_by_moderation", recipient);
      }
      return removalResult;
    }
    default:
      return false;
  }
}

export function attachNotificationDispatcher(
  bus: EventBus,
  pool: Pool,
  notificationService: NotificationService
): () => void {
  return bus.on(ALL_EVENTS, (event) => {
    void dispatchNotificationForBusEvent(pool, notificationService, event).catch((error) => {
      console.warn("[notifications] Failed to dispatch event notification:", error);
    });
  });
}
