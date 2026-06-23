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

export interface ProfileSetEvent extends BaseLinkoraEvent {
  type: "profile_set";
  user: string;
  username: string;
}

export interface BlockEvent extends BaseLinkoraEvent {
  type: "block";
  blocker: string;
  blocked: string;
}

export interface UnblockEvent extends BaseLinkoraEvent {
  type: "unblock";
  blocker: string;
  blocked: string;
}

export interface PoolCreatedEvent extends BaseLinkoraEvent {
  type: "pool_created";
  pool_id: string;
  token: string;
  admins: string[];
  threshold: number;
}

export interface PoolAdminAddedEvent extends BaseLinkoraEvent {
  type: "pool_admin_added";
  pool_id: string;
  new_admin: string;
}

export interface PoolAdminRemovedEvent extends BaseLinkoraEvent {
  type: "pool_admin_removed";
  pool_id: string;
  admin: string;
}

export interface PoolThresholdUpdatedEvent extends BaseLinkoraEvent {
  type: "pool_threshold_updated";
  pool_id: string;
  old_threshold: number;
  new_threshold: number;
}

export interface ProposalCreatedEvent extends BaseLinkoraEvent {
  type: "proposal_created";
  pool_id: string;
  proposal_id: number;
  proposer: string;
  amount: bigint;
  recipient: string;
}

export interface ProposalSignedEvent extends BaseLinkoraEvent {
  type: "proposal_signed";
  pool_id: string;
  proposal_id: number;
  signer: string;
}

export interface ProposalExecutedEvent extends BaseLinkoraEvent {
  type: "proposal_executed";
  pool_id: string;
  proposal_id: number;
  amount: bigint;
  recipient: string;
}

export interface GovProposalVetoedEvent extends BaseLinkoraEvent {
  type: "gov_proposal_vetoed";
  proposal_id: number;
}

export interface FeeUpdatedEvent extends BaseLinkoraEvent {
  type: "fee_updated";
  old_fee_bps: number;
  new_fee_bps: number;
}

export interface TreasuryUpdatedEvent extends BaseLinkoraEvent {
  type: "treasury_updated";
  old_treasury: string;
  new_treasury: string;
}

export interface ContractUpgradedEvent extends BaseLinkoraEvent {
  type: "contract_upgraded";
  new_wasm_hash: string;
}

export type LinkoraEvent =
  | ProfileSetEvent
  | PostCreatedEvent
  | PostDeletedEvent
  | LikeEvent
  | FollowEvent
  | UnfollowEvent
  | BlockEvent
  | UnblockEvent
  | TipEvent
  | PoolCreatedEvent
  | PoolDepositEvent
  | PoolWithdrawEvent
  | PoolAdminAddedEvent
  | PoolAdminRemovedEvent
  | PoolThresholdUpdatedEvent
  | ProposalCreatedEvent
  | ProposalSignedEvent
  | ProposalExecutedEvent
  | GovProposalCreatedEvent
  | GovVoteEvent
  | GovProposalExecutedEvent
  | GovProposalVetoedEvent
  | FeeUpdatedEvent
  | TreasuryUpdatedEvent
  | ContractUpgradedEvent
  | DmKeyPublishedEvent
  | EmergencyBypassEvent;

const EVENT_NAMES: Record<string, LinkoraEvent["type"]> = {
  profile_set: "profile_set",
  ProfileSetEvent: "profile_set",
  post: "post_created",
  post_created: "post_created",
  PostCreatedEvent: "post_created",
  post_del: "post_deleted",
  post_deleted: "post_deleted",
  PostDeleted: "post_deleted",
  like: "like",
  LikePostEvent: "like",
  follow: "follow",
  FollowEvent: "follow",
  unfollow: "unfollow",
  UnfollowEvent: "unfollow",
  block: "block",
  BlockEvent: "block",
  unblock: "unblock",
  UnblockEvent: "unblock",
  tip: "tip",
  TipEvent: "tip",
  deposit: "pool_deposit",
  pool_deposit: "pool_deposit",
  PoolDepositEvent: "pool_deposit",
  withdraw: "pool_withdraw",
  pool_withdraw: "pool_withdraw",
  PoolWithdrawEvent: "pool_withdraw",
  pool_created: "pool_created",
  PoolCreatedEvent: "pool_created",
  pool_admin_added: "pool_admin_added",
  PoolAdminAddedEvent: "pool_admin_added",
  pool_admin_removed: "pool_admin_removed",
  PoolAdminRemovedEvent: "pool_admin_removed",
  pool_threshold_updated: "pool_threshold_updated",
  PoolThresholdUpdatedEvent: "pool_threshold_updated",
  proposal_created: "proposal_created",
  ProposalCreatedEvent: "proposal_created",
  proposal_signed: "proposal_signed",
  ProposalSignedEvent: "proposal_signed",
  proposal_executed: "proposal_executed",
  ProposalExecutedEvent: "proposal_executed",
  gov_proposal_created: "gov_proposal_created",
  GovProposalCreatedEvent: "gov_proposal_created",
  gov_vote: "gov_vote",
  GovVoteEvent: "gov_vote",
  gov_proposal_executed: "gov_proposal_executed",
  GovProposalExecutedEvent: "gov_proposal_executed",
  gov_proposal_vetoed: "gov_proposal_vetoed",
  GovProposalVetoedEvent: "gov_proposal_vetoed",
  fee_updated: "fee_updated",
  FeeUpdatedEvent: "fee_updated",
  treasury_updated: "treasury_updated",
  TreasuryUpdatedEvent: "treasury_updated",
  contract_upgraded: "contract_upgraded",
  ContractUpgraded: "contract_upgraded",
  dm_key_published: "dm_key_published",
  DmKeyPublishedEvent: "dm_key_published",
  emergency_bypass: "emergency_bypass",
  EmergencyBypassEvent: "emergency_bypass",
};

const EVENT_TOPIC_FIELDS: Record<string, string[]> = {
  profile_set: ["user", "username"],
  post_created: ["id", "author"],
  post_deleted: ["post_id", "author"],
  like: ["user", "post_id"],
  follow: ["follower", "followee"],
  unfollow: ["follower", "followee"],
  block: ["blocker", "blocked"],
  unblock: ["blocker", "blocked"],
  tip: ["tipper", "post_id"],
  pool_deposit: ["depositor", "pool_id"],
  pool_withdraw: ["recipient", "pool_id"],
  pool_created: ["pool_id"],
  pool_admin_added: ["pool_id"],
  pool_admin_removed: ["pool_id"],
  pool_threshold_updated: ["pool_id"],
  proposal_created: ["pool_id", "proposal_id"],
  proposal_signed: ["pool_id", "proposal_id"],
  proposal_executed: ["pool_id", "proposal_id"],
  gov_proposal_created: ["proposal_id"],
  gov_vote: ["proposal_id", "voter"],
  gov_proposal_executed: ["proposal_id"],
  gov_proposal_vetoed: ["proposal_id"],
  dm_key_published: ["user"],
  emergency_bypass: ["action"],
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

function payloadFrom(
  eventType: LinkoraEvent["type"],
  topics: unknown[],
  data: Record<string, unknown>
): Record<string, unknown> {
  const payload = { ...data };
  const topicFields = EVENT_TOPIC_FIELDS[eventType] || [];

  // The first topic (index 0) is usually the event name.
  // Subsequent topics are our fields.
  for (let i = 0; i < topicFields.length; i++) {
    const topicIdx = i + 1;
    if (topicIdx < topics.length) {
      payload[topicFields[i]] = topics[topicIdx];
    }
  }

  // Also merge any objects in topics (legacy or complex structs)
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

function strVec(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(str);
  return [];
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

    const payload = payloadFrom(eventType, topics, decodeData(raw.data ?? raw.value));
    const eventMeta = meta(raw);

    switch (eventType) {
      case "profile_set":
        return {
          type: eventType,
          user: str(payload.user),
          username: str(payload.username),
          meta: eventMeta,
        };
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
      case "block":
        return {
          type: eventType,
          blocker: str(payload.blocker),
          blocked: str(payload.blocked),
          meta: eventMeta,
        };
      case "unblock":
        return {
          type: eventType,
          blocker: str(payload.blocker),
          blocked: str(payload.blocked),
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
      case "pool_created":
        return {
          type: eventType,
          pool_id: str(payload.pool_id),
          token: str(payload.token),
          admins: strVec(payload.admins),
          threshold: num(payload.threshold),
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
      case "pool_admin_added":
        return {
          type: eventType,
          pool_id: str(payload.pool_id),
          new_admin: str(payload.new_admin),
          meta: eventMeta,
        };
      case "pool_admin_removed":
        return {
          type: eventType,
          pool_id: str(payload.pool_id),
          admin: str(payload.admin),
          meta: eventMeta,
        };
      case "pool_threshold_updated":
        return {
          type: eventType,
          pool_id: str(payload.pool_id),
          old_threshold: num(payload.old_threshold),
          new_threshold: num(payload.new_threshold),
          meta: eventMeta,
        };
      case "proposal_created":
        return {
          type: eventType,
          pool_id: str(payload.pool_id),
          proposal_id: num(payload.proposal_id),
          proposer: str(payload.proposer),
          amount: big(payload.amount),
          recipient: str(payload.recipient),
          meta: eventMeta,
        };
      case "proposal_signed":
        return {
          type: eventType,
          pool_id: str(payload.pool_id),
          proposal_id: num(payload.proposal_id),
          signer: str(payload.signer),
          meta: eventMeta,
        };
      case "proposal_executed":
        return {
          type: eventType,
          pool_id: str(payload.pool_id),
          proposal_id: num(payload.proposal_id),
          amount: big(payload.amount),
          recipient: str(payload.recipient),
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
      case "gov_proposal_vetoed":
        return {
          type: eventType,
          proposal_id: num(payload.proposal_id),
          meta: eventMeta,
        };
      case "fee_updated":
        return {
          type: eventType,
          old_fee_bps: num(payload.old_fee_bps),
          new_fee_bps: num(payload.new_fee_bps),
          meta: eventMeta,
        };
      case "treasury_updated":
        return {
          type: eventType,
          old_treasury: str(payload.old_treasury),
          new_treasury: str(payload.new_treasury),
          meta: eventMeta,
        };
      case "contract_upgraded":
        return {
          type: eventType,
          new_wasm_hash: str(payload.new_wasm_hash),
          meta: eventMeta,
        };
      case "dm_key_published":
        return {
          type: eventType,
          user: str(payload.user),
          key: str(payload.public_key),
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
