/** Atomic batches through the multicall contract (Epta-Node#1767). */
import { Account, Keypair, StrKey, xdr } from "@stellar/stellar-base";
import {
  MAX_BATCH_CALLS,
  buildBatchOperation,
  buildBatchTransaction,
  encodeBatch,
  linkoraBatchCalls,
} from "../multicall.js";
import { decodeCall } from "../generated/contracts/multicall.js";
import { decodeAddress, decodeVec } from "../generated/contracts/runtime.js";

const NETWORK = "Test SDF Network ; September 2015";
const LINKORA = StrKey.encodeContract(Buffer.alloc(32, 1));
const MULTICALL = StrKey.encodeContract(Buffer.alloc(32, 2));
const USDC = StrKey.encodeContract(Buffer.alloc(32, 3));

function decodeExecuteArgs(args: xdr.ScVal[]) {
  expect(args).toHaveLength(2);
  return { caller: decodeAddress(args[0]!), calls: decodeVec(args[1]!, decodeCall) };
}

const me = Keypair.random().publicKey();
const creator = Keypair.random().publicKey();
const calls = linkoraBatchCalls(LINKORA);

describe("linkora batch call builders", () => {
  it("encode follow + tip + pool deposit for the Linkora contract", () => {
    const batch = [
      calls.follow(me, creator),
      calls.tip(me, 7, USDC, 5_000_000n),
      calls.poolDeposit(me, "fans", USDC, 10n),
    ];
    expect(batch.map((c) => [c.contractId, c.method])).toEqual([
      [LINKORA, "follow"],
      [LINKORA, "tip"],
      [LINKORA, "pool_deposit"],
    ]);
    const [, tip] = batch;
    expect(tip!.args.map((a) => a.switch().name)).toEqual([
      "scvAddress",
      "scvU64",
      "scvAddress",
      "scvI128",
    ]);
  });

  it("validate their inputs", () => {
    expect(() => calls.follow("nope", creator)).toThrow();
    expect(() => calls.tip(me, 0, USDC, 1)).toThrow();
    expect(() => calls.tip(me, 1, me, 1)).toThrow();
    expect(() => calls.likePost(me, 1.5)).toThrow();
  });
});

describe("encodeBatch", () => {
  it("produces execute(caller, Vec<Call>) with sorted Call fields", () => {
    const args = encodeBatch(me, [calls.follow(me, creator), calls.likePost(me, 3n)]);
    const { caller, calls: decoded } = decodeExecuteArgs(args);
    expect(caller).toBe(me);
    expect(decoded.map((c) => [c.contract_id, c.fn_name, c.args.length])).toEqual([
      [LINKORA, "follow", 2],
      [LINKORA, "like_post", 2],
    ]);
    const firstCall = (args[1]!.vec() ?? [])[0]!;
    expect((firstCall.map() ?? []).map((e) => e.key().sym().toString())).toEqual([
      "args",
      "contract_id",
      "fn_name",
    ]);
  });

  it("rejects empty, oversized and malformed batches", () => {
    expect(() => encodeBatch(me, [])).toThrow(/at least one call/);
    const tooMany = Array.from({ length: MAX_BATCH_CALLS + 1 }, () => calls.likePost(me, 1));
    expect(() => encodeBatch(me, tooMany)).toThrow(/at most 16/);
    expect(() => encodeBatch(me, [calls.call("bad name!", [])])).toThrow(/function name/);
    expect(() => encodeBatch(me, [calls.call("follow", [], me)])).toThrow();
    expect(() => encodeBatch("nope", [calls.likePost(me, 1)])).toThrow();
    expect(
      encodeBatch(
        me,
        Array.from({ length: MAX_BATCH_CALLS }, () => calls.likePost(me, 1))
      )
    ).toHaveLength(2);
  });
});

describe("batch transaction", () => {
  it("is a single invocation of multicall.execute", () => {
    const tx = buildBatchTransaction({
      multicallContractId: MULTICALL,
      caller: me,
      calls: [calls.follow(me, creator), calls.tip(me, 7n, USDC, 5n)],
      source: new Account(me, "1"),
      networkPassphrase: NETWORK,
    });
    expect(tx.operations).toHaveLength(1);

    const op = xdr.Operation.fromXDR(tx.toEnvelope().v1().tx().operations()[0]!.toXDR());
    const invoke = op.body().invokeHostFunctionOp().hostFunction().invokeContract();
    expect(StrKey.encodeContract(invoke.contractAddress().contractId() as unknown as Buffer)).toBe(
      MULTICALL
    );
    expect(invoke.functionName().toString()).toBe("execute");
    expect(decodeExecuteArgs(invoke.args()).calls.map((c) => c.fn_name)).toEqual(["follow", "tip"]);
  });

  it("requires a valid multicall contract id", () => {
    expect(() => buildBatchOperation(me, me, [calls.likePost(me, 1)])).toThrow();
  });
});
