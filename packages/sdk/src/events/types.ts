import { scValToNative, xdr } from "@stellar/stellar-base";

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

export interface RentPaidEvent extends BaseLinkoraEvent {
  type: "rent_paid";
  user: string;
  payer: string;
  token: string;
  amount: bigint;
  extended_to_ledger: number;
}

export interface ProfileSetEvent extends BaseLinkoraEvent {
  type: "profile_set";
  user: string;
  username: string;
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

export interface PostCreatedEvent extends BaseLinkoraEvent {
  type: "post_created";
  id: number;
  author: string;
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

export interface PoolCreatedEvent extends BaseLinkoraEvent {
  type: "pool_created";
  pool_id: string;
  token: string;
  admins: string[];
  threshold: number;
}

export interface LikePostEvent extends BaseLinkoraEvent {
  type: "like";
  user: string;
  post_id: number;
}

export interface ContractUpgradedEvent extends BaseLinkoraEvent {
  type: "contract_upgraded";
  new_wasm_hash: string;
}

export interface PostDeletedEvent extends BaseLinkoraEvent {
  type: "post_deleted";
  post_id: number;
  author: string;
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

export interface DmKeyPublishedEvent extends BaseLinkoraEvent {
  type: "dm_key_published";
  user: string;
  public_key: string;
  key: string;
}

export interface CredentialRootUpdatedEvent extends BaseLinkoraEvent {
  type: "credential_root_updated";
  user: string;
  root: string;
}

export interface CredentialVerifiedEvent extends BaseLinkoraEvent {
  type: "credential_verified";
  user: string;
  nullifier: string;
}

export interface FeeUpdatedEvent extends BaseLinkoraEvent {
  type: "fee_updated";
  name: string;
  old_fee_bps: number;
  new_fee_bps: number;
}

export interface TreasuryUpdatedEvent extends BaseLinkoraEvent {
  type: "treasury_updated";
  name: string;
  old_treasury: string;
  new_treasury: string;
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

export interface GovProposalVetoedEvent extends BaseLinkoraEvent {
  type: "gov_proposal_vetoed";
  proposal_id: number;
}

export interface EmergencyBypassEvent extends BaseLinkoraEvent {
  type: "emergency_bypass";
  action: string;
}

export interface AttestationVerifiedEvent extends BaseLinkoraEvent {
  type: "attestation_verified";
  oracle_name: string;
  report_hash: string;
  creator: string;
  window_start: number;
  window_end: number;
}

export interface PostReportedEvent extends BaseLinkoraEvent {
  type: "post_reported";
  post_id: number;
  reporter: string;
  stake_amount: bigint;
}

export interface PostRemovedByModerationEvent extends BaseLinkoraEvent {
  type: "post_removed_by_moderation";
  post_id: number;
  reporter: string;
}

export interface ReportDismissedEvent extends BaseLinkoraEvent {
  type: "report_dismissed";
  post_id: number;
  reporter: string;
}

export type LinkoraEvent =
  | RentPaidEvent
  | ProfileSetEvent
  | FollowEvent
  | UnfollowEvent
  | BlockEvent
  | UnblockEvent
  | PostCreatedEvent
  | TipEvent
  | PoolDepositEvent
  | PoolWithdrawEvent
  | PoolCreatedEvent
  | LikePostEvent
  | ContractUpgradedEvent
  | PostDeletedEvent
  | ProposalCreatedEvent
  | ProposalSignedEvent
  | ProposalExecutedEvent
  | PoolAdminAddedEvent
  | PoolAdminRemovedEvent
  | PoolThresholdUpdatedEvent
  | DmKeyPublishedEvent
  | CredentialRootUpdatedEvent
  | CredentialVerifiedEvent
  | FeeUpdatedEvent
  | TreasuryUpdatedEvent
  | GovProposalCreatedEvent
  | GovVoteEvent
  | GovProposalExecutedEvent
  | GovProposalVetoedEvent
  | EmergencyBypassEvent
  | AttestationVerifiedEvent
  | PostReportedEvent
  | PostRemovedByModerationEvent
  | ReportDismissedEvent;

const EVENT_NAMES: Record<string, LinkoraEvent["type"]> = {
  RentPaidEvent: "rent_paid",
  rent_paid: "rent_paid",
  ProfileSetEvent: "profile_set",
  profile_set: "profile_set",
  FollowEvent: "follow",
  follow: "follow",
  UnfollowEvent: "unfollow",
  unfollow: "unfollow",
  BlockEvent: "block",
  block: "block",
  UnblockEvent: "unblock",
  unblock: "unblock",
  PostCreatedEvent: "post_created",
  post: "post_created",
  post_created: "post_created",
  PostDeleted: "post_deleted",
  PostDeletedEvent: "post_deleted",
  post_deleted: "post_deleted",
  LikePostEvent: "like",
  Like: "like",
  like: "like",
  TipEvent: "tip",
  tip: "tip",
  PoolDepositEvent: "pool_deposit",
  deposit: "pool_deposit",
  pool_deposit: "pool_deposit",
  PoolWithdrawEvent: "pool_withdraw",
  withdraw: "pool_withdraw",
  pool_withdraw: "pool_withdraw",
  PoolCreatedEvent: "pool_created",
  pool_created: "pool_created",
  ContractUpgraded: "contract_upgraded",
  contract_upgraded: "contract_upgraded",
  ProposalCreatedEvent: "proposal_created",
  proposal_created: "proposal_created",
  ProposalSignedEvent: "proposal_signed",
  proposal_signed: "proposal_signed",
  ProposalExecutedEvent: "proposal_executed",
  proposal_executed: "proposal_executed",
  PoolAdminAddedEvent: "pool_admin_added",
  pool_admin_added: "pool_admin_added",
  PoolAdminRemovedEvent: "pool_admin_removed",
  pool_admin_removed: "pool_admin_removed",
  PoolThresholdUpdatedEvent: "pool_threshold_updated",
  pool_threshold_updated: "pool_threshold_updated",
  DmKeyPublishedEvent: "dm_key_published",
  dm_key_published: "dm_key_published",
  CredentialRootUpdatedEvent: "credential_root_updated",
  credential_root_updated: "credential_root_updated",
  CredentialVerifiedEvent: "credential_verified",
  credential_verified: "credential_verified",
  FeeUpdatedEvent: "fee_updated",
  fee_updated: "fee_updated",
  TreasuryUpdatedEvent: "treasury_updated",
  treasury_updated: "treasury_updated",
  GovProposalCreatedEvent: "gov_proposal_created",
  gov_proposal_created: "gov_proposal_created",
  GovVoteEvent: "gov_vote",
  gov_vote: "gov_vote",
  GovProposalExecutedEvent: "gov_proposal_executed",
  gov_proposal_executed: "gov_proposal_executed",
  GovProposalVetoedEvent: "gov_proposal_vetoed",
  gov_proposal_vetoed: "gov_proposal_vetoed",
  EmergencyBypassEvent: "emergency_bypass",
  emergency_bypass: "emergency_bypass",
  AttestationVerifiedEvent: "attestation_verified",
  attestation_verified: "attestation_verified",
  PostReportedEvent: "post_reported",
  post_reported: "post_reported",
  PostRemovedByModerationEvent: "post_removed_by_moderation",
  post_removed_by_moderation: "post_removed_by_moderation",
  ReportDismissedEvent: "report_dismissed",
  report_dismissed: "report_dismissed",
};

function decodeScVal(encoded: string): unknown {
  return scValToNative(xdr.ScVal.fromXDR(encoded, "base64"));
}

function decodeMany(encoded: string[] | undefined): unknown[] {
  if (!encoded) return [];
  return encoded.map((item) => decodeScVal(item));
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
    if (typeof topic === "string" && EVENT_NAMES[topic]) return EVENT_NAMES[topic];
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
  if (value instanceof Uint8Array) return Buffer.from(value).toString("base64");
  return String(value);
}

function num(value: unknown): number {
  return Number(value);
}

function big(value: unknown): bigint {
  return typeof value === "bigint" ? value : BigInt(String(value));
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(str) : [];
}

/**
 * Parse a raw Soroban event into a strongly-typed LinkoraEvent.
 *
 * @param raw The raw event payload from the Soroban RPC.
 * @returns The parsed LinkoraEvent, or null if the event type is unrecognized.
 *
 * @example
 * ```ts
 * const rawEvent = {
 *   topics: [
 *     "AAAAAQAAAANwb3N0", // "post"
 *     "AAAAAQAAAAV1c2VyMQ==",
 *   ],
 *   data: "AAAAAQAAAAFjb250ZW50",
 *   ledger: 1000,
 * };
 *
 * const event = parseContractEvent(rawEvent);
 * if (event?.type === "post_created") {
 *   console.log(`Post created by: ${event.author}`);
 * }
 * ```
 */
export function parseContractEvent(raw: SorobanEvent): LinkoraEvent | null {
  try {
    const topics = decodeMany(raw.topics ?? raw.topic);
    const eventType = findEventType(topics);
    if (!eventType) return null;

    const payload = payloadFrom(topics, decodeData(raw.data ?? raw.value));
    const eventMeta = meta(raw);

    switch (eventType) {
      case "rent_paid":
        return {
          type: eventType,
          user: str(payload.user),
          payer: str(payload.payer),
          token: str(payload.token),
          amount: big(payload.amount),
          extended_to_ledger: num(payload.extended_to_ledger),
          meta: eventMeta,
        };
      case "profile_set":
        return {
          type: eventType,
          user: str(payload.user),
          username: str(payload.username),
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
      case "pool_created":
        return {
          type: eventType,
          pool_id: str(payload.pool_id),
          token: str(payload.token),
          admins: strArray(payload.admins),
          threshold: num(payload.threshold),
          meta: eventMeta,
        };
      case "contract_upgraded":
        return { type: eventType, new_wasm_hash: str(payload.new_wasm_hash), meta: eventMeta };
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
      case "dm_key_published": {
        const publicKey = str(payload.public_key ?? payload.key);
        return {
          type: eventType,
          user: str(payload.user),
          public_key: publicKey,
          key: publicKey,
          meta: eventMeta,
        };
      }
      case "credential_root_updated":
        return {
          type: eventType,
          user: str(payload.user),
          root: str(payload.root),
          meta: eventMeta,
        };
      case "credential_verified":
        return {
          type: eventType,
          user: str(payload.user),
          nullifier: str(payload.nullifier),
          meta: eventMeta,
        };
      case "fee_updated":
        return {
          type: eventType,
          name: str(payload.name),
          old_fee_bps: num(payload.old_fee_bps),
          new_fee_bps: num(payload.new_fee_bps),
          meta: eventMeta,
        };
      case "treasury_updated":
        return {
          type: eventType,
          name: str(payload.name),
          old_treasury: str(payload.old_treasury),
          new_treasury: str(payload.new_treasury),
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
        return { type: eventType, proposal_id: num(payload.proposal_id), meta: eventMeta };
      case "emergency_bypass":
        return { type: eventType, action: str(payload.action), meta: eventMeta };
      case "attestation_verified":
        return {
          type: eventType,
          oracle_name: str(payload.oracle_name),
          report_hash: str(payload.report_hash),
          creator: str(payload.creator),
          window_start: num(payload.window_start),
          window_end: num(payload.window_end),
          meta: eventMeta,
        };
      case "post_reported":
        return {
          type: eventType,
          post_id: num(payload.post_id),
          reporter: str(payload.reporter),
          stake_amount: big(payload.stake_amount),
          meta: eventMeta,
        };
      case "post_removed_by_moderation":
        return {
          type: eventType,
          post_id: num(payload.post_id),
          reporter: str(payload.reporter),
          meta: eventMeta,
        };
      case "report_dismissed":
        return {
          type: eventType,
          post_id: num(payload.post_id),
          reporter: str(payload.reporter),
          meta: eventMeta,
        };
      default:
        return null;
    }
  } catch (_err) {
    return null;
  }
}
