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
import { handleFollow, handleUnfollow } from "./handlers/follow";
import { handleTip } from "./handlers/tip";
import { handleLike } from "./handlers/like";
import {
  handleGovProposalCreated,
  handleGovVote,
  handleGovProposalExecuted,
  handleGovProposalVetoed,
} from "./handlers/governance";
import {
  handlePostReported,
  handleReportDismissed,
  handlePostRemovedByModeration,
} from "./handlers/moderation";
import { handleBlock, handleUnblock, handleDmKeyPublished } from "./handlers/user";
import { handleProfileSet } from "./handlers/profile";
import {
  handlePoolCreated,
  handlePoolDeposit,
  handlePoolWithdraw,
} from "./handlers/pool";
import { Database } from "./db";
import { dispatchNotificationForBusEvent } from "./notifications/events";
import { scValToNative, xdr } from "@stellar/stellar-sdk";

const TOPIC_FOLLOW = "follow";
const TOPIC_UNFOLLOW = "unfollow";
const TOPIC_TIP = "tip";
const TOPIC_TIP_RECEIVED = "tip_received";
const TOPIC_LIKE = "like";
const TOPIC_LIKE_RECEIVED = "like_received";
const TOPIC_POST_REPORTED = "post_reported";
const TOPIC_REPORT_DISMISSED = "report_dismissed";
const TOPIC_POST_REMOVED_BY_MODERATION = "post_removed_by_moderation";
const TOPIC_BLOCK = "block";
const TOPIC_UNBLOCK = "unblock";
const TOPIC_DM_KEY_PUBLISHED = "dm_key_published";
const TOPIC_PROFILE_SET = "profile_set";
const TOPIC_POST_CREATED = "post_created";
const TOPIC_POST_DELETED = "post_deleted";
const TOPIC_PROFILE_DELETED = "profile_deleted";

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

function decodeScVal(encoded: string): unknown {
  try {
    return scValToNative(xdr.ScVal.fromXDR(encoded, "base64"));
  } catch {
    return encoded;
  }
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

export function createDomainProcessor(
  pool: { query: (sql: string, params?: unknown[]) => Promise<QueryResultLike> },
  notificationService: import("./notifications/service").NotificationService,
  db?: Database
): (client: PgClientLike, event: IngestEvent) => Promise<void> {
  return async (client: PgClientLike, event: IngestEvent): Promise<void> => {
    // Decode topics and data so they work with both real RPC XDR and unit test JS objects
    const decodedTopics = decodeTopics(event.topic);
    let data = decodeData(event.data);
    if (Object.keys(data).length === 0 && event.data && typeof event.data === "object") {
      data = event.data as Record<string, unknown>;
    }
    // merge any object topics
    for (const t of decodedTopics) {
      if (t && typeof t === "object" && !Array.isArray(t)) {
        Object.assign(data, t);
      }
    }

    const topic = (typeof decodedTopics[0] === "string" ? decodedTopics[0] : "").toLowerCase();
    const busEvent = toBusEvent(event);

    switch (topic) {
      case TOPIC_FOLLOW:
      case TOPIC_UNFOLLOW: {
        const follower = asString(data.follower ?? data.from);
        const followee = asString(data.followee ?? data.to);

        if (topic === TOPIC_UNFOLLOW) {
          await handleUnfollow(client as never, {
            follower,
            followee,
            ledger: event.ledgerSequence,
          });
        } else {
          await handleFollow(client as never, {
            follower,
            followee,
            ledger: event.ledgerSequence,
          });
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

      case "gov_proposal_created": {
        const proposalId = asBigInt(data.proposal_id);
        const proposer = asString(data.proposer);
        const parameter = asString(data.parameter);
        const newValue = asBigInt(data.new_value);

        await handleGovProposalCreated(client as never, {
          proposal_id: proposalId,
          proposer,
          parameter,
          new_value: newValue,
          ledger: event.ledgerSequence,
        });
        break;
      }

      case "gov_vote": {
        const proposalId = asBigInt(data.proposal_id);
        const voter = asString(data.voter);
        const support = Boolean(data.support);

        await handleGovVote(client as never, {
          proposal_id: proposalId,
          voter,
          support,
          ledger: event.ledgerSequence,
        });
        break;
      }

      case "gov_proposal_executed": {
        const proposalId = asBigInt(data.proposal_id);
        const parameter = asString(data.parameter);
        const newValue = asBigInt(data.new_value);

        await handleGovProposalExecuted(client as never, {
          proposal_id: proposalId,
          parameter,
          new_value: newValue,
          ledger: event.ledgerSequence,
        });
        break;
      }

      case "gov_proposal_vetoed": {
        const proposalId = asBigInt(data.proposal_id);

        await handleGovProposalVetoed(client as never, {
          proposal_id: proposalId,
          ledger: event.ledgerSequence,
        });
        break;
      }

      case TOPIC_POST_REPORTED: {
        const postId = asBigInt(data.post_id);
        const reporterAddress = asString(data.reporter_address ?? data.reporter);
        const reason = asString(data.reason);

        await handlePostReported(
          client as never,
          {
            post_id: postId,
            reporter_address: reporterAddress,
            reason,
          },
          {
            txHash: asString(data.txHash ?? data.tx_hash),
            ledgerSeq: event.ledgerSequence,
            timestamp: new Date(),
          },
          pool as never
        );

        await dispatchNotificationForBusEvent(pool as never, notificationService, busEvent);
        break;
      }

      case TOPIC_REPORT_DISMISSED: {
        const postId = asBigInt(data.post_id);
        const reporterAddress = asString(data.reporter_address ?? data.reporter);
        const moderatorAddress = asString(data.moderator_address ?? data.moderator);
        const moderatorNotes = asString(data.moderator_notes);

        await handleReportDismissed(
          client as never,
          {
            post_id: postId,
            reporter_address: reporterAddress,
            moderator_address: moderatorAddress,
            moderator_notes: moderatorNotes || undefined,
          },
          {
            txHash: asString(data.txHash ?? data.tx_hash),
            ledgerSeq: event.ledgerSequence,
            timestamp: new Date(),
          },
          pool as never
        );

        await dispatchNotificationForBusEvent(pool as never, notificationService, busEvent);
        break;
      }

      case TOPIC_POST_REMOVED_BY_MODERATION: {
        const postId = asBigInt(data.post_id);
        const moderatorAddress = asString(data.moderator_address ?? data.moderator);
        const reason = asString(data.reason);

        await handlePostRemovedByModeration(
          client as never,
          {
            post_id: postId,
            moderator_address: moderatorAddress,
            reason,
          },
          {
            txHash: asString(data.txHash ?? data.tx_hash),
            ledgerSeq: event.ledgerSequence,
            timestamp: new Date(),
          },
          pool as never
        );

        await dispatchNotificationForBusEvent(pool as never, notificationService, busEvent);
        break;
      }

      case TOPIC_BLOCK: {
        const blocker = asString(data.blocker);
        const blocked = asString(data.blocked);
        await handleBlock(client as never, { blocker, blocked });
        break;
      }

      case TOPIC_UNBLOCK: {
        const blocker = asString(data.blocker);
        const blocked = asString(data.blocked);
        await handleUnblock(client as never, { blocker, blocked });
        break;
      }

      case TOPIC_DM_KEY_PUBLISHED: {
        const address = asString(data.user);
        const x25519_pubkey = asString(data.public_key ?? data.key);
        await handleDmKeyPublished(client as never, { address, x25519_pubkey });
        break;
      }

      case TOPIC_PROFILE_SET: {
        if (!db) break;
        const user = asString(data.user ?? data.address);
        const username = asString(data.username);
        const creator_token = asString(data.creator_token ?? data.creatorToken ?? "");

        await handleProfileSet(db, {
          user,
          username,
          creator_token,
          ledger: event.ledgerSequence,
        });
        break;
      }

      case TOPIC_PROFILE_DELETED: {
        if (!db) break;
        const user = asString(data.user ?? data.address);

        await db.deleteProfile(user);
        break;
      }

      case TOPIC_POST_CREATED: {
        if (!db) break;
        const id = asBigInt(data.id ?? data.post_id);
        const author = asString(data.author);
        const content = asString(data.content ?? "");

        await db.insertPost({
          id,
          author,
          deleted: false,
          tip_total: 0n,
          like_count: 0n,
          created_ledger: event.ledgerSequence,
          deleted_ledger: null,
          ...(content ? { content } : {}),
        } as Parameters<Database["insertPost"]>[0]);
        break;
      }

      case TOPIC_POST_DELETED: {
        if (!db) break;
        const postId = asBigInt(data.post_id ?? data.id);

        await db.markPostDeleted(postId, event.ledgerSequence);
        break;
      }

      case "pool_created": {
        if (!db) break;
        const pool_id = asString(data.pool_id);
        const token = asString(data.token);
        const admins = Array.isArray(data.admins) ? data.admins.map(asString) : [];
        const threshold = Number(data.threshold) || 1;

        await handlePoolCreated(db, {
          pool_id,
          token,
          admins,
          threshold,
          ledger: event.ledgerSequence,
        });
        break;
      }

      case "pool_deposit": {
        if (!db) break;
        const pool_id = asString(data.pool_id);
        const depositor = asString(data.depositor ?? data.user ?? data.from);
        const token = asString(data.token);
        const amount = asBigInt(data.amount);

        await handlePoolDeposit(db, {
          pool_id,
          depositor,
          token,
          amount,
          ledger: event.ledgerSequence,
        });
        break;
      }

      case "pool_withdraw": {
        if (!db) break;
        const pool_id = asString(data.pool_id);
        const recipient = asString(data.recipient ?? data.user ?? data.to);
        const amount = asBigInt(data.amount);

        await handlePoolWithdraw(db, {
          pool_id,
          recipient,
          amount,
          ledger: event.ledgerSequence,
        });
        break;
      }

      default:
        break;
    }
  };
}
