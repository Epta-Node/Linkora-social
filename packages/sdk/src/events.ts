import { scValToNative, xdr } from "@stellar/stellar-base";
import { ParseError } from "./errors.js";
import type { SorobanEvent } from "./events/types.js";

export { ParseError };
export type { SorobanEvent };

export interface PostCreatedEvent {
  id: bigint;
  author: string;
  version: number;
}

export interface TipSentEvent {
  tipper: string;
  postId: bigint;
  amount: bigint;
  fee: bigint;
  version: number;
}

export interface FollowedEvent {
  follower: string;
  followee: string;
  version: number;
}

export interface PoolJoinedEvent {
  poolId: string;
  member: string;
  version: number;
}

export interface PostRemovedEvent {
  postId: bigint;
  reporter: string;
  version: number;
}

function decodeScVal(val: unknown): unknown {
  if (typeof val === "string") {
    try {
      const decoded = scValToNative(xdr.ScVal.fromXDR(val, "base64"));
      if (decoded && typeof decoded === "object" && "__native" in (decoded as any)) {
        return (decoded as any).__native;
      }
      return decoded;
    } catch {
      return val;
    }
  }
  return val;
}

function extractPayload(raw: SorobanEvent): { topics: unknown[]; data: unknown } {
  if (!raw || typeof raw !== "object") {
    throw new ParseError("Invalid event: raw event must be an object");
  }
  const rawTopics = raw.topics ?? raw.topic;
  if (!rawTopics || !Array.isArray(rawTopics) || rawTopics.length === 0) {
    throw new ParseError("Invalid event: missing or empty topics");
  }

  let topics: unknown[];
  try {
    topics = rawTopics.map((t) => decodeScVal(t));
  } catch (err) {
    throw new ParseError(
      `Invalid event: failed to decode topics: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const rawData = raw.data ?? raw.value;
  let data: unknown = undefined;
  if (rawData !== undefined && rawData !== null) {
    try {
      data = decodeScVal(rawData);
    } catch (err) {
      throw new ParseError(
        `Invalid event: failed to decode data: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return { topics, data };
}

function getField(source: unknown, ...keys: string[]): unknown {
  if (!source) return undefined;
  if (source instanceof Map) {
    for (const key of keys) {
      if (source.has(key)) return source.get(key);
      for (const [k, v] of source.entries()) {
        if (
          typeof k === "string" &&
          (k === key ||
            k.toLowerCase() === key.toLowerCase() ||
            k.replace(/_/g, "").toLowerCase() === key.replace(/_/g, "").toLowerCase())
        ) {
          return v;
        }
      }
    }
  } else if (typeof source === "object") {
    const obj = source as Record<string, unknown>;
    for (const key of keys) {
      if (key in obj && obj[key] !== undefined) return obj[key];
      for (const [k, v] of Object.entries(obj)) {
        if (
          k.toLowerCase() === key.toLowerCase() ||
          k.replace(/_/g, "").toLowerCase() === key.replace(/_/g, "").toLowerCase()
        ) {
          return v;
        }
      }
    }
  }
  return undefined;
}

function parseBigInt(val: unknown, fieldName: string): bigint {
  if (typeof val === "bigint") return val;
  if (typeof val === "number" && Number.isFinite(val)) return BigInt(val);
  if (typeof val === "string" && /^-?\d+$/.test(val.trim())) return BigInt(val.trim());
  throw new ParseError(`Field '${fieldName}' must be a valid bigint, got: ${val}`);
}

function parseNumber(val: unknown, fieldName: string): number {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "bigint") return Number(val);
  if (typeof val === "string" && !isNaN(Number(val))) return Number(val);
  throw new ParseError(`Field '${fieldName}' must be a valid number, got: ${val}`);
}

function parseString(val: unknown, fieldName: string): string {
  if (typeof val === "string" && val.length > 0) return val;
  if (typeof val === "object" && val !== null && "toString" in val) {
    const s = String(val);
    if (s && s !== "[object Object]") return s;
  }
  throw new ParseError(`Field '${fieldName}' must be a valid non-empty string, got: ${val}`);
}

export function parsePostCreatedEvent(raw: SorobanEvent): PostCreatedEvent {
  const { topics, data } = extractPayload(raw);
  const eventName = typeof topics[0] === "string" ? topics[0].toLowerCase() : "";
  if (eventName && !eventName.includes("post_created") && !eventName.includes("postcreated")) {
    throw new ParseError(`Expected PostCreated event, got topic '${topics[0]}'`);
  }

  const rawId = getField(data, "id", "postId", "post_id") ?? topics[2];
  const rawAuthor = getField(data, "author") ?? topics[3];
  const rawVersion = getField(data, "version") ?? topics[1] ?? 1;

  if (rawId === undefined) throw new ParseError("PostCreatedEvent: missing id");
  if (rawAuthor === undefined) throw new ParseError("PostCreatedEvent: missing author");

  return {
    id: parseBigInt(rawId, "id"),
    author: parseString(rawAuthor, "author"),
    version: parseNumber(rawVersion, "version"),
  };
}

export function parseTipSentEvent(raw: SorobanEvent): TipSentEvent {
  const { topics, data } = extractPayload(raw);
  const eventName = typeof topics[0] === "string" ? topics[0].toLowerCase() : "";
  if (eventName && !eventName.includes("tip") && !eventName.includes("tipsent")) {
    throw new ParseError(`Expected TipSent event, got topic '${topics[0]}'`);
  }

  const rawTipper = getField(data, "tipper", "from") ?? topics[2];
  const rawPostId = getField(data, "postId", "post_id") ?? topics[3];
  const rawAmount = getField(data, "amount") ?? topics[4];
  const rawFee = getField(data, "fee") ?? topics[5] ?? 0n;
  const rawVersion = getField(data, "version") ?? topics[1] ?? 1;

  if (rawTipper === undefined) throw new ParseError("TipSentEvent: missing tipper");
  if (rawPostId === undefined) throw new ParseError("TipSentEvent: missing postId");
  if (rawAmount === undefined) throw new ParseError("TipSentEvent: missing amount");

  return {
    tipper: parseString(rawTipper, "tipper"),
    postId: parseBigInt(rawPostId, "postId"),
    amount: parseBigInt(rawAmount, "amount"),
    fee: parseBigInt(rawFee, "fee"),
    version: parseNumber(rawVersion, "version"),
  };
}

export function parseFollowedEvent(raw: SorobanEvent): FollowedEvent {
  const { topics, data } = extractPayload(raw);
  const eventName = typeof topics[0] === "string" ? topics[0].toLowerCase() : "";
  if (eventName && !eventName.includes("follow") && !eventName.includes("followed")) {
    throw new ParseError(`Expected Followed event, got topic '${topics[0]}'`);
  }

  const rawFollower = getField(data, "follower") ?? topics[2];
  const rawFollowee = getField(data, "followee", "followed") ?? topics[3];
  const rawVersion = getField(data, "version") ?? topics[1] ?? 1;

  if (rawFollower === undefined) throw new ParseError("FollowedEvent: missing follower");
  if (rawFollowee === undefined) throw new ParseError("FollowedEvent: missing followee");

  return {
    follower: parseString(rawFollower, "follower"),
    followee: parseString(rawFollowee, "followee"),
    version: parseNumber(rawVersion, "version"),
  };
}

export function parsePoolJoinedEvent(raw: SorobanEvent): PoolJoinedEvent {
  const { topics, data } = extractPayload(raw);
  const eventName = typeof topics[0] === "string" ? topics[0].toLowerCase() : "";
  if (eventName && !eventName.includes("pool_joined") && !eventName.includes("pooljoined")) {
    throw new ParseError(`Expected PoolJoined event, got topic '${topics[0]}'`);
  }

  const rawPoolId = getField(data, "poolId", "pool_id") ?? topics[2];
  const rawMember = getField(data, "member", "caller") ?? topics[3];
  const rawVersion = getField(data, "version") ?? topics[1] ?? 1;

  if (rawPoolId === undefined) throw new ParseError("PoolJoinedEvent: missing poolId");
  if (rawMember === undefined) throw new ParseError("PoolJoinedEvent: missing member");

  return {
    poolId: parseString(rawPoolId, "poolId"),
    member: parseString(rawMember, "member"),
    version: parseNumber(rawVersion, "version"),
  };
}

export function parsePostRemovedEvent(raw: SorobanEvent): PostRemovedEvent {
  const { topics, data } = extractPayload(raw);
  const eventName = typeof topics[0] === "string" ? topics[0].toLowerCase() : "";
  if (
    eventName &&
    !eventName.includes("post_removed") &&
    !eventName.includes("postremoved") &&
    !eventName.includes("post_deleted") &&
    !eventName.includes("postdeleted")
  ) {
    throw new ParseError(`Expected PostRemoved event, got topic '${topics[0]}'`);
  }

  const rawPostId = getField(data, "postId", "post_id") ?? topics[2];
  const rawReporter = getField(data, "reporter", "author", "moderator") ?? topics[3];
  const rawVersion = getField(data, "version") ?? topics[1] ?? 1;

  if (rawPostId === undefined) throw new ParseError("PostRemovedEvent: missing postId");
  if (rawReporter === undefined) throw new ParseError("PostRemovedEvent: missing reporter");

  return {
    postId: parseBigInt(rawPostId, "postId"),
    reporter: parseString(rawReporter, "reporter"),
    version: parseNumber(rawVersion, "version"),
  };
}
