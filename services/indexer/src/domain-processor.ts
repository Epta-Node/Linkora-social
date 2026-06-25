/**
 * Domain processor — bridges the exactly-once ingestion pipeline to the
 * Linkora contract event handlers.
 *
 * All database writes happen through the pipeline's shared transaction
 * client (`PgClientLike`).  After each domain handler succeeds, the
 * notification dispatcher is called with the raw ingested event so it can
 * perform its own idempotency check (via `sent_notifications`) before
 * calling the Expo push API.
 */

import { PgClientLike } from "./pipeline";
import { IngestEvent, QueryResultLike } from "./pipeline";
import { handleFollow } from "./handlers/follow";
import { handleTip } from "./handlers/tip";
import { handleLike } from "./handlers/like";
import { dispatchNotificationForBusEvent } from "./notifications/events";

const TOPIC_FOLLOW = "follow";
const TOPIC_UNFOLLOW = "unfollow";
const TOPIC_TIP = "tip";
const TOPIC_TIP_RECEIVED = "tip_received";
const TOPIC_LIKE = "like";
const TOPIC_LIKE_RECEIVED = "like_received";

function toBusEvent(ev: IngestEvent): import("./bus").BusEvent {
  return {
    type: ev.type,
    ledgerSequence: ev.ledgerSequence,
    eventIndex: ev.eventIndex,
    contractId: ev.contractId,
    topic: ev.topic,
    data: ev.data,
  };
}

function asBigInt(value: unknown): bigint {
  return typeof value === "bigint"
    ? value
    : BigInt(Number.isFinite(Number(value)) ? Number(value) : 0);
}

function asString(value: unknown): string {
  return String(value ?? "");
}

export function createDomainProcessor(
  pool: { query: (sql: string, params?: unknown[]) => Promise<QueryResultLike> },
  notificationService: import("./notifications/service").NotificationService
): (client: PgClientLike, event: IngestEvent) => Promise<void> {
  return async (client: PgClientLike, event: IngestEvent): Promise<void> => {
    const data = event.data as Record<string, unknown>;
    const topic = (event.topic[0] ?? "").toLowerCase();
    const busEvent = toBusEvent(event);

    switch (topic) {
      case TOPIC_FOLLOW:
      case TOPIC_UNFOLLOW: {
        const follower = asString(data.follower ?? data.from);
        const followee = asString(data.followee ?? data.to);

        await handleFollow(client as never, {
          follower,
          followee,
          ledger: event.ledgerSequence,
        });

        if (topic === TOPIC_FOLLOW) {
          await dispatchNotificationForBusEvent(pool as never, notificationService, busEvent);
        }
        break;
      }

      case TOPIC_TIP:
      case TOPIC_TIP_RECEIVED: {
        const tipper = asString(data.tipper ?? data.from);
        const postId = asBigInt(data.post_id);
        const amount = asBigInt(data.amount);
        const fee = asBigInt(data.fee);
        const txHash = asString(data.txHash ?? data.tx_hash);

        await handleTip(
          client as never,
          {
            tipper,
            post_id: postId,
            amount,
            fee,
          },
          {
            txHash,
            ledgerSeq: event.ledgerSequence,
            timestamp: new Date(),
          },
          {
            client: client as never,
          }
        );

        await dispatchNotificationForBusEvent(pool as never, notificationService, busEvent);
        break;
      }

      case TOPIC_LIKE:
      case TOPIC_LIKE_RECEIVED: {
        const user = asString(data.user ?? data.actor);
        const postId = asBigInt(data.post_id);
        const txHash = asString(data.txHash ?? data.tx_hash);

        await handleLike(
          client as never,
          {
            user,
            post_id: postId,
          },
          {
            txHash,
            ledgerSeq: event.ledgerSequence,
            timestamp: new Date(),
          },
          {
            client: client as never,
          }
        );

        await dispatchNotificationForBusEvent(pool as never, notificationService, busEvent);
        break;
      }

      default:
        break;
    }
  };
}
