import { Account, Transaction, TransactionBuilder, xdr } from "@stellar/stellar-base";
import { InvalidInputError } from "./errors.js";
import { encodeExecuteArgs, MulticallContract } from "./generated/contracts/multicall.js";
import {
  encodeAddress,
  encodeI128,
  encodeString,
  encodeSymbol,
  encodeU64,
} from "./generated/contracts/runtime.js";
import { ensureAddress, ensureContractAddress, ensureNonEmptyString } from "./validate.js";

/**
 * Atomic batches through the `LinkoraMulticall` contract (Epta-Node#1767).
 *
 * A Soroban transaction carries exactly one contract invocation, so
 * "follow + tip + join pool" normally takes three transactions and three
 * wallet prompts. A batch sends them as one `execute(caller, calls)`
 * invocation instead: one transaction, one signature, and all-or-nothing —
 * if any call fails, every call is rolled back.
 *
 * ```ts
 * const { follow, tip, poolDeposit } = client.calls;
 * const xdr = await client.prepareBatchTx(me, [
 *   follow(me, creator),
 *   tip(me, postId, usdc, 5_0000000n),
 *   poolDeposit(me, "fans", usdc, 10_0000000n),
 * ]);
 * // sign `xdr` once with the wallet, then submit it
 * ```
 */

/** Largest batch the multicall contract accepts (`MAX_CALLS`). */
export const MAX_BATCH_CALLS = 16;

/** One contract call inside a batch. */
export interface BatchCall {
  /** Contract to invoke. */
  contractId: string;
  /** Contract function name. */
  method: string;
  /** Encoded arguments, in order. */
  args: xdr.ScVal[];
}

const SYMBOL_RE = /^[A-Za-z0-9_]{1,32}$/;

function validateBatch(caller: string, calls: readonly BatchCall[]): void {
  ensureAddress(caller, "caller");
  if (!Array.isArray(calls) || calls.length === 0) {
    throw new InvalidInputError("A batch needs at least one call.");
  }
  if (calls.length > MAX_BATCH_CALLS) {
    throw new InvalidInputError(
      `A batch can hold at most ${MAX_BATCH_CALLS} calls (got ${calls.length}).`
    );
  }
  calls.forEach((call, i) => {
    ensureContractAddress(call.contractId, `calls[${i}].contractId`);
    if (!SYMBOL_RE.test(call.method)) {
      throw new InvalidInputError(
        `calls[${i}].method must be a contract function name (1-32 of a-z, A-Z, 0-9, _).`
      );
    }
  });
}

/** Arguments of `execute(caller, calls)` for the multicall contract. */
export function encodeBatch(caller: string, calls: readonly BatchCall[]): xdr.ScVal[] {
  validateBatch(caller, calls);
  return encodeExecuteArgs({
    caller,
    calls: calls.map((c) => ({ contract_id: c.contractId, fn_name: c.method, args: c.args })),
  });
}

/** The single `invokeHostFunction` operation that runs the whole batch. */
export function buildBatchOperation(
  multicallContractId: string,
  caller: string,
  calls: readonly BatchCall[]
): xdr.Operation {
  ensureContractAddress(multicallContractId, "multicallContractId");
  validateBatch(caller, calls);
  return new MulticallContract(multicallContractId).execute({
    caller,
    calls: calls.map((c) => ({ contract_id: c.contractId, fn_name: c.method, args: c.args })),
  });
}

/**
 * An unsigned, unsimulated transaction holding the batch. Simulate it (e.g.
 * `rpc.Server#prepareTransaction`) to attach the footprint and the
 * authorization entries before signing.
 */
export function buildBatchTransaction(options: {
  multicallContractId: string;
  caller: string;
  calls: readonly BatchCall[];
  source: Account;
  networkPassphrase: string;
  fee?: string;
  timeoutSeconds?: number;
}): Transaction {
  return new TransactionBuilder(options.source, {
    fee: options.fee ?? "100",
    networkPassphrase: options.networkPassphrase,
  })
    .addOperation(buildBatchOperation(options.multicallContractId, options.caller, options.calls))
    .setTimeout(options.timeoutSeconds ?? 30)
    .build();
}

function ensureId(value: number | bigint, fieldName: string): bigint {
  if (typeof value === "number" && !Number.isInteger(value)) {
    throw new InvalidInputError(`${fieldName} must be an integer.`);
  }
  const id = BigInt(value);
  if (id <= 0n) throw new InvalidInputError(`${fieldName} must be positive.`);
  return id;
}

/** Builders for Linkora calls to put in a batch. */
export interface LinkoraBatchCalls {
  follow(follower: string, followee: string): BatchCall;
  unfollow(follower: string, followee: string): BatchCall;
  likePost(user: string, postId: number | bigint): BatchCall;
  createPost(author: string, content: string): BatchCall;
  tip(tipper: string, postId: number | bigint, token: string, amount: number | bigint): BatchCall;
  /** Join a community pool by depositing into it. */
  poolDeposit(depositor: string, poolId: string, token: string, amount: number | bigint): BatchCall;
  /** Any other contract call, with pre-encoded arguments. */
  call(method: string, args: xdr.ScVal[], contractId?: string): BatchCall;
}

/** Call builders bound to the Linkora contract at `linkoraContractId`. */
export function linkoraBatchCalls(linkoraContractId: string): LinkoraBatchCalls {
  const make = (method: string, args: xdr.ScVal[], contractId = linkoraContractId): BatchCall => ({
    contractId,
    method,
    args,
  });
  return {
    follow(follower, followee) {
      ensureAddress(follower, "follower");
      ensureAddress(followee, "followee");
      return make("follow", [encodeAddress(follower), encodeAddress(followee)]);
    },
    unfollow(follower, followee) {
      ensureAddress(follower, "follower");
      ensureAddress(followee, "followee");
      return make("unfollow", [encodeAddress(follower), encodeAddress(followee)]);
    },
    likePost(user, postId) {
      ensureAddress(user, "user");
      return make("like_post", [encodeAddress(user), encodeU64(ensureId(postId, "postId"))]);
    },
    createPost(author, content) {
      ensureAddress(author, "author");
      ensureNonEmptyString(content, "content");
      return make("create_post", [encodeAddress(author), encodeString(content)]);
    },
    tip(tipper, postId, token, amount) {
      ensureAddress(tipper, "tipper");
      ensureContractAddress(token, "token");
      return make("tip", [
        encodeAddress(tipper),
        encodeU64(ensureId(postId, "postId")),
        encodeAddress(token),
        encodeI128(ensureId(amount, "amount")),
      ]);
    },
    poolDeposit(depositor, poolId, token, amount) {
      ensureAddress(depositor, "depositor");
      ensureNonEmptyString(poolId, "poolId");
      ensureContractAddress(token, "token");
      return make("pool_deposit", [
        encodeAddress(depositor),
        encodeSymbol(poolId),
        encodeAddress(token),
        encodeI128(ensureId(amount, "amount")),
      ]);
    },
    call(method, args, contractId) {
      return make(method, args, contractId);
    },
  };
}
