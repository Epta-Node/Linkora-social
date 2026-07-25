export {
  stellarAddressSchema,
  cursorPaginationSchema,
  offsetPaginationSchema,
  numericIdStringSchema,
  base64Schema,
  hex64BytesSchema,
  conversationIdSchema,
} from "./schemas";

export {
  AppError,
  ErrorCodes,
  ErrorStatusMap,
  validationError,
  notFoundError,
  unauthorizedError,
  forbiddenError,
  conflictError,
  rateLimitedError,
  internalError,
  serviceUnavailableError,
  isAppError,
} from "./errors";

export type { ErrorCode, ErrorResponseBody, ErrorResponse } from "./errors";

export type {
  Profile,
  Post,
  Pool,
  LinkoraEvent,
  TipEvent,
  FollowEvent,
  UnfollowEvent,
  BlockEvent,
  UnblockEvent,
  PostCreatedEvent,
  PostDeleted,
  LikePostEvent,
  PoolCreatedEvent,
  PoolDepositEvent,
  PoolWithdrawEvent,
  ProposalCreatedEvent,
  ProposalSignedEvent,
  ProposalExecutedEvent,
  PoolAdminAddedEvent,
  PoolAdminRemovedEvent,
  PoolThresholdUpdatedEvent,
  FeeUpdatedEvent,
  TreasuryUpdatedEvent,
  GovProposalCreatedEvent,
  GovVoteEvent,
  GovProposalExecutedEvent,
  GovProposalVetoedEvent,
  EmergencyBypassEvent,
  ProfileSetEvent,
  ContractUpgraded,
  Proposal,
  ProposalStatus,
  GovProposal,
  GovParameter,
  GovStatus,
  GovConfig,
} from "linkora-sdk";

export type { LinkoraEvent as LinkoraEventUnion } from "linkora-sdk";

export type { ClientConfig, LinkoraClient } from "linkora-sdk";
