/**
 * Spec-derived contract bindings (Epta-Node#1769).
 *
 * The generated encoders/decoders are checked against stellar-sdk's own
 * `contract.Spec` encoder for the committed Linkora WASM, so a mistake in the
 * codegen (field order, union shape, integer width) shows up as an XDR
 * mismatch.
 */
import { readFileSync } from "fs";
import path from "path";
import { createHash } from "crypto";
import { Keypair, StrKey, xdr } from "@stellar/stellar-base";
import { contract } from "@stellar/stellar-sdk";
import * as linkora from "../generated/contracts/linkora.js";
import * as vesting from "../generated/contracts/vesting.js";
import * as multicall from "../generated/contracts/multicall.js";
import * as rt from "../generated/contracts/runtime.js";
import * as contracts from "../generated/contracts/index.js";

const LINKORA_WASM = path.resolve(
  __dirname,
  "../../../contracts/contracts/linkora-contracts/linkora_contracts.wasm"
);
const spec = contract.Spec.fromWasm(readFileSync(LINKORA_WASM));

const account = () => Keypair.random().publicKey();
const contractId = () => StrKey.encodeContract(Buffer.alloc(32, Math.floor(Math.random() * 255)));
const udt = (name: string) => xdr.ScSpecTypeDef.scSpecTypeUdt(new xdr.ScSpecTypeUdt({ name }));
const hex = (vals: xdr.ScVal[]) => vals.map((v) => v.toXDR("hex"));

describe("generated Linkora bindings match the contract spec", () => {
  it("were generated from the committed WASM's spec", () => {
    const hash = createHash("sha256")
      .update(Buffer.concat(spec.entries.map((e) => e.toXDR())))
      .digest("hex");
    expect(linkora.SPEC_HASH).toBe(hash);
  });

  it("cover every contract function", () => {
    const names = spec.funcs().map((f) => f.name().toString());
    expect(Object.keys(linkora.methods).sort()).toEqual(names.sort());
  });

  it("encode function arguments like contract.Spec", () => {
    const follower = account();
    const followee = account();
    expect(hex(linkora.encodeFollowArgs({ follower, followee }))).toEqual(
      hex(spec.funcArgsToScVals("follow", { follower, followee }))
    );

    const tip = { tipper: account(), post_id: 42n, token: contractId(), amount: 1_000_000n };
    expect(hex(linkora.encodeTipArgs(tip))).toEqual(hex(spec.funcArgsToScVals("tip", tip)));

    const review = {
      moderator: account(),
      signers: [account(), account()],
      post_id: 7n,
      reporter: account(),
      verdict: "Upheld" as const,
    };
    expect(hex(linkora.encodeReviewReportArgs(review))).toEqual(
      hex(spec.funcArgsToScVals("review_report", { ...review, verdict: { tag: "Upheld" } }))
    );

    const appeal = { appellant: account(), post_id: 3n, reason: "satire" };
    expect(hex(linkora.encodeAppealRemovalArgs(appeal))).toEqual(
      hex(spec.funcArgsToScVals("appeal_removal", appeal))
    );
  });

  it("encode optional struct arguments like contract.Spec", () => {
    const base = {
      proposer: account(),
      parameter: "FeeBps" as const,
      new_value: 250n,
      new_address: null,
    };
    for (const metadata of [
      null,
      { title: "Lower fees", description: "Cut the fee", rationale: null },
      { title: "Lower fees", description: "Cut the fee", rationale: "Growth" },
    ]) {
      const args = { ...base, metadata };
      expect(hex(linkora.encodeGovProposeArgs(args))).toEqual(
        hex(
          spec.funcArgsToScVals("gov_propose", {
            ...args,
            parameter: { tag: "FeeBps" },
            new_address: undefined,
            metadata: metadata ?? undefined,
          })
        )
      );
    }
  });

  it("encode structs like contract.Spec and decode them back", () => {
    const value: linkora.GovAppeal = {
      id: 1n,
      post_id: 9n,
      appellant: account(),
      moderator: account(),
      reason: "please",
      stake_token: contractId(),
      stake_amount: 100n,
      moderator_slash: 300n,
      gov_token: contractId(),
      filed_at: 1_700_000_000n,
      voting_ends_at: 1_700_604_800n,
      votes_for: 51n,
      votes_against: 49n,
      status: "Voting",
    };
    const ours = linkora.encodeGovAppeal(value);
    const theirs = spec.nativeToScVal({ ...value, status: { tag: "Voting" } }, udt("GovAppeal"));
    expect(ours.toXDR("hex")).toEqual(theirs.toXDR("hex"));
    expect(linkora.decodeGovAppeal(theirs)).toEqual(value);
  });

  it("round-trip unions with values", () => {
    const keys: linkora.StorageKey[] = [
      { tag: "Post", values: [5n] },
      { tag: "Like", values: [5n, account()] },
      { tag: "GovAppealVote", values: [2n, account()] },
      { tag: "GovConfig" },
    ];
    for (const key of keys) {
      const encoded = linkora.encodeStorageKey(key);
      const native = spec.nativeToScVal(key, udt("StorageKey"));
      expect(encoded.toXDR("hex")).toEqual(native.toXDR("hex"));
      expect(linkora.decodeStorageKey(encoded)).toEqual(key);
    }
  });

  it("decode function results", () => {
    const post: linkora.Post = {
      id: 1n,
      author: account(),
      content: "hi",
      tip_total: 0n,
      timestamp: 10n,
      like_count: 2n,
    };
    const ret = spec.nativeToScVal(post, udt("Post"));
    expect(linkora.decodeGetPostResult(ret)).toEqual(post);
    expect(linkora.decodeGetPostResult(xdr.ScVal.scvVoid())).toBeNull();
    expect(linkora.decodeResolveAppealResult(xdr.ScVal.scvBool(true))).toBe(true);
  });

  it("decode governance appeal events", () => {
    const voter = account();
    const topics = [
      xdr.ScVal.scvSymbol("appeal_voted"),
      xdr.ScVal.scvU32(1),
      rt.encodeU64(4n),
      rt.encodeAddress(voter),
    ];
    const data = rt.encodeStruct([
      ["support", xdr.ScVal.scvBool(true)],
      ["weight", rt.encodeI128(600n)],
    ]);
    expect(linkora.decodeEvent(topics, data)).toEqual({
      name: "GovAppealVotedEvent",
      event: { version: 1, appeal_id: 4n, voter, support: true, weight: 600n },
    });
    expect(linkora.decodeEvent([xdr.ScVal.scvSymbol("nope")], data)).toBeNull();
  });
});

describe("generated vesting and multicall bindings", () => {
  it("round-trip a vest with an optional field", () => {
    const vest: vesting.Vest = {
      id: 3n,
      beneficiary: account(),
      token: contractId(),
      total_amount: 1_000n,
      claimed_amount: 250n,
      start_time: 100n,
      cliff_seconds: 10n,
      duration_seconds: 1_000n,
      revoked_at: null,
    };
    expect(vesting.decodeVest(vesting.encodeVest(vest))).toEqual(vest);
    const revoked = { ...vest, revoked_at: 500n };
    expect(vesting.decodeVest(vesting.encodeVest(revoked))).toEqual(revoked);
  });

  it("decode vesting events by topic", () => {
    const beneficiary = account();
    const topics = [
      xdr.ScVal.scvSymbol("tokens_claimed"),
      xdr.ScVal.scvU32(1),
      rt.encodeU64(1n),
      rt.encodeAddress(beneficiary),
    ];
    const data = rt.encodeStruct([
      ["amount", rt.encodeI128(40n)],
      ["total_claimed", rt.encodeI128(40n)],
    ]);
    expect(vesting.decodeEvent(topics, data)).toEqual({
      name: "TokensClaimedEvent",
      event: { version: 1, vest_id: 1n, beneficiary, amount: 40n, total_claimed: 40n },
    });
  });

  it("map contract error codes to names", () => {
    expect(vesting.vestingErrorName(6)).toBe("NothingToClaim");
    expect(multicall.multicallErrorName(3)).toBe("ReentrantCall");
    expect(vesting.decodeVestingError(xdr.ScVal.scvError(xdr.ScError.sceContract(5)))).toBe(
      vesting.VestingError.VestNotFound
    );
  });

  it("build operations through the typed contract classes", () => {
    const id = contractId();
    const op = new vesting.VestingContract(id).claim({ vest_id: 2n });
    const invoke = op.body().invokeHostFunctionOp().hostFunction().invokeContract();
    expect(invoke.functionName().toString()).toBe("claim");
    expect(invoke.args().map((a) => a.toXDR("hex"))).toEqual([rt.encodeU64(2n).toXDR("hex")]);
  });

  it("export one namespace per contract", () => {
    expect(Object.keys(contracts).sort()).toEqual(
      ["DecodeError", "linkora", "multicall", "referral", "tokenFactory", "vesting"].sort()
    );
  });
});

describe("generated runtime", () => {
  it("rejects out-of-range integers", () => {
    expect(() => rt.encodeU32(-1)).toThrow(RangeError);
    expect(() => rt.encodeU32(1.5)).toThrow(RangeError);
    expect(() => rt.encodeU64(2n ** 64n)).toThrow(RangeError);
    expect(() => rt.encodeI128(-(2n ** 127n) - 1n)).toThrow(RangeError);
    expect(rt.decodeI128(rt.encodeI128(-(2n ** 127n)))).toBe(-(2n ** 127n));
  });

  it("checks fixed-size bytes", () => {
    expect(() => rt.encodeBytesN(new Uint8Array(31), 32)).toThrow(RangeError);
    expect(Buffer.from(rt.decodeBytesN(rt.encodeBytesN(new Uint8Array(32), 32), 32))).toEqual(
      Buffer.alloc(32)
    );
  });

  it("sorts map and struct keys", () => {
    const encoded = rt.encodeMap(
      new Map([
        [3, "c"],
        [1, "a"],
        [2, "b"],
      ]),
      rt.encodeU32,
      rt.encodeString
    );
    expect((encoded.map() ?? []).map((e) => e.key().u32())).toEqual([1, 2, 3]);
    const struct = rt.encodeStruct([
      ["zeta", xdr.ScVal.scvVoid()],
      ["alpha", xdr.ScVal.scvVoid()],
    ]);
    expect((struct.map() ?? []).map((e) => e.key().sym().toString())).toEqual(["alpha", "zeta"]);
  });

  it("throws DecodeError on unexpected shapes", () => {
    expect(() => rt.decodeU32(xdr.ScVal.scvBool(true))).toThrow(rt.DecodeError);
    expect(() => linkora.decodePost(xdr.ScVal.scvMap([]))).toThrow(rt.DecodeError);
    expect(() => linkora.decodeReportStatus(rt.encodeUnionCase("Nope", []))).toThrow(
      rt.DecodeError
    );
  });
});
