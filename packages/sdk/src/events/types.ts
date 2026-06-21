import { scValToNative, xdr } from "@stellar/stellar-sdk";

export interface SorobanEvent {
  type?: string;
  ledger?: number;
  ledgerClosedAt?: string;
  contractId?: string;
  id?: string;
  pagingToken?: string;
  topic?: string[];
  topics?: string[];
  value?: string;
  data?: string;
  txHash?: string;
}

export interface LinkoraEventMeta {
  ledger?: number;
  ledgerClosedAt?: string;
  contractId?: string;
  id?: string;
  pagingToken?: string;
  txHash?: string;
  raw: SorobanEvent;
}

export type GovParameter =
  | "FeeBps"
  | "Treasury"
  | "TipCooldownWindow"
  | "GovQuorum"
  | "GovTimeLock"
  | "GovVoteWindow"
  | string;

interface BaseLinkoraEvent {
  meta: LinkoraEventMeta;
}

export interface PostCreatedEvent extends BaseLinkoraEvent {
  type: "post_created";
  id: number;
  author: string;
}

export interface PostDeletedEvent extends BaseLinkoraEvent {
  type: "post_deleted";
  post_id: number;
  author: string;
}

export interface LikeEvent extends BaseLinkoraEvent {
  type: "like";
  user: string;
  post_id: number;
}

export interface FollowEvent extends BaseLinkoraEvent {
  type: "follow";
  follower: string;
  followee: string;
}

export interface UnfollowEvent extends BaseLinkoraEvent {
  type: "unfollow";
  follower: string;
  followee: string;
}

export interface TipEvent extends BaseLinkoraEvent {
  type: "tip";
  tipper: string;
  post_id: number;
  amount: bigint;
  fee: bigint;
}

export interface PoolDepositEvent extends BaseLinkoraEvent {
  type: "pool_deposit";
  depositor: string;
  pool_id: string;
  amount: bigint;
}

export interface PoolWithdrawEvent extends BaseLinkoraEvent {
  type: "pool_withdraw";
  recipient: string;
  pool_id: string;
  amount: bigint;
}

export interface GovProposalCreatedEvent extends BaseLinkoraEvent {
  type: "gov_proposal_created";
  proposal_id: number;
  proposer: string;
  parameter: GovParameter;
  new_value: number;
}

export interface GovVoteEvent extends BaseLinkoraEvent {
  type: "gov_vote";
  proposal_id: number;
  voter: string;
  support: boolean;
}

export interface GovProposalExecutedEvent extends BaseLinkoraEvent {
  type: "gov_proposal_executed";
  proposal_id: number;
  parameter: GovParameter;
  new_value: number;
}

export interface DmKeyPublishedEvent extends BaseLinkoraEvent {
  type: "dm_key_published";
  user: string;
  key: string;
}

export interface EmergencyBypassEvent extends BaseLinkoraEvent {
  type: "emergency_bypass";
  action: string;
}

export type LinkoraEvent =
  | PostCreatedEvent
  | PostDeletedEvent
  | LikeEvent
  | FollowEvent
  | UnfollowEvent
  | TipEvent
  | PoolDepositEvent
  | PoolWithdrawEvent
  | GovProposalCreatedEvent
  | GovVoteEvent
  | GovProposalExecutedEvent
  | DmKeyPublishedEvent
  | EmergencyBypassEvent;

const EVENT_NAMES: Record<string, LinkoraEvent["type"]> = {
  post: "post_created",
  post_created: "post_created",
  PostCreated: "post_created",
  post_del: "post_deleted",
  post_deleted: "post_deleted",
  PostDeleted: "post_deleted",
  like: "like",
  Like: "like",
  follow: "follow",
  Follow: "follow",
  unfollow: "unfollow",
  Unfollow: "unfollow",
  tip: "tip",
  Tip: "tip",
  deposit: "pool_deposit",
  pool_deposit: "pool_deposit",
  PoolDeposit: "pool_deposit",
  withdraw: "pool_withdraw",
  pool_withdraw: "pool_withdraw",
  PoolWithdraw: "pool_withdraw",
  gov_proposal_created: "gov_proposal_created",
  GovProposalCreated: "gov_proposal_created",
  gov_vote: "gov_vote",
  GovVote: "gov_vote",
  gov_proposal_executed: "gov_proposal_executed",
  GovProposalExecuted: "gov_proposal_executed",
  dm_key_published: "dm_key_published",
  DmKeyPublished: "dm_key_published",
  emergency_bypass: "emergency_bypass",
  EmergencyBypass: "emergency_bypass",
};

function decodeScVal(encoded: string): unknown {
  return scValToNative(xdr.ScVal.fromXDR(encoded, "base64"));
}

function decodeMany(encoded: string[] | undefined): unknown[] {
  if (!encoded) return [];
  const decoded: unknown[] = [];
  for (const item of encoded) {
    decoded.push(decodeScVal(item));
  }
  return decoded;
}

function decodeData(encoded: string | undefined): Record<string, unknown> {
  if (!encoded) return {};
  const decoded = decodeScVal(encoded);
  if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) {
    return decoded as Record<string, unknown>;
  }
  return { value: decoded };
}

function findEventType(topics: unknown[]): LinkoraEvent["type"] | null {
  for (const topic of topics) {
    if (typeof topic === "string" && EVENT_NAMES[topic]) {
      return EVENT_NAMES[topic];
    }
  }
  return null;
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

function meta(raw: SorobanEvent): LinkoraEventMeta {
  return {
    ledger: raw.ledger,
    ledgerClosedAt: raw.ledgerClosedAt,
    contractId: raw.contractId,
    id: raw.id,
    pagingToken: raw.pagingToken,
    txHash: raw.txHash,
    raw,
  };
}

function str(value: unknown): string {
  return String(value);
}

function num(value: unknown): number {
  return Number(value);
}

function big(value: unknown): bigint {
  return typeof value === "bigint" ? value : BigInt(String(value));
}

/**
 * Decode a raw Soroban RPC event into the Linkora event union.
 *
 * Unknown event names and malformed payloads return null so newer contract
 * events do not break older SDK clients.
 */
export function parseContractEvent(raw: SorobanEvent): LinkoraEvent | null {
  try {
    const topics = decodeMany(raw.topics ?? raw.topic);
    const eventType = findEventType(topics);
    if (!eventType) return null;

    const payload = payloadFrom(topics, decodeData(raw.data ?? raw.value));
    const eventMeta = meta(raw);

    switch (eventType) {
      case "post_created":
        return {
          type: eventType,
          id: num(payload.id),
          author: str(payload.author),
          meta: eventMeta,
        };
      case "post_deleted":
        return {
          type: eventType,
          post_id: num(payload.post_id),
          author: str(payload.author),
          meta: eventMeta,
        };
      case "like":
        return {
          type: eventType,
          user: str(payload.user),
          post_id: num(payload.post_id),
          meta: eventMeta,
        };
      case "follow":
        return {
          type: eventType,
          follower: str(payload.follower),
          followee: str(payload.followee),
          meta: eventMeta,
        };
      case "unfollow":
        return {
          type: eventType,
          follower: str(payload.follower),
          followee: str(payload.followee),
          meta: eventMeta,
        };
      case "tip":
        return {
          type: eventType,
          tipper: str(payload.tipper),
          post_id: num(payload.post_id),
          amount: big(payload.amount),
          fee: big(payload.fee),
          meta: eventMeta,
        };
      case "pool_deposit":
        return {
          type: eventType,
          depositor: str(payload.depositor),
          pool_id: str(payload.pool_id),
          amount: big(payload.amount),
          meta: eventMeta,
        };
      case "pool_withdraw":
        return {
          type: eventType,
          recipient: str(payload.recipient),
          pool_id: str(payload.pool_id),
          amount: big(payload.amount),
          meta: eventMeta,
        };
      case "gov_proposal_created":
        return {
          type: eventType,
          proposal_id: num(payload.proposal_id),
          proposer: str(payload.proposer),
          parameter: str(payload.parameter),
          new_value: num(payload.new_value),
          meta: eventMeta,
        };
      case "gov_vote":
        return {
          type: eventType,
          proposal_id: num(payload.proposal_id),
          voter: str(payload.voter),
          support: Boolean(payload.support),
          meta: eventMeta,
        };
      case "gov_proposal_executed":
        return {
          type: eventType,
          proposal_id: num(payload.proposal_id),
          parameter: str(payload.parameter),
          new_value: num(payload.new_value),
          meta: eventMeta,
        };
      case "dm_key_published":
        return {
          type: eventType,
          user: str(payload.user),
          key: str(payload.key),
          meta: eventMeta,
        };
      case "emergency_bypass":
        return { type: eventType, action: str(payload.action), meta: eventMeta };
      default:
        return null;
    }
  } catch (_err) {
    return null;
  }
}
