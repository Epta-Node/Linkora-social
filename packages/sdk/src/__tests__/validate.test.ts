import { LinkoraClient } from "../client";
import { ValidationError } from "../errors";
import {
  ensureAccountAddress,
  ensureAddress,
  ensureAddressList,
  ensureContractAddress,
  isAccountAddress,
  isContractAddress,
  isStellarAddress,
} from "../validate";

const ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";

jest.mock("@stellar/stellar-sdk/rpc", () => ({
  Server: jest.fn(),
  Api: { isSimulationError: jest.fn(), isSimulationSuccess: jest.fn() },
}));

jest.mock("@stellar/stellar-base", () => ({
  Contract: jest.fn(() => ({ call: jest.fn() })),
  Address: {
    fromString: jest.fn((v: string) => ({ toScVal: () => ({ _val: v }) })),
  },
  StrKey: {
    isValidEd25519PublicKey: jest.fn(
      (value: string) => typeof value === "string" && value.startsWith("G")
    ),
    isValidContract: jest.fn(
      (value: string) => typeof value === "string" && value.startsWith("C")
    ),
  },
  nativeToScVal: jest.fn((val: unknown, opts?: unknown) => ({
    _val: val,
    _opts: opts,
  })),
  scValToNative: jest.fn(),
  TransactionBuilder: jest.fn(() => ({
    addOperation: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn(() => ({ toEnvelope: () => ({ toXDR: () => "XDR" }) })),
  })),
  Account: jest.fn(),
  Keypair: { random: jest.fn(() => ({ publicKey: () => "GKEYPAIR" })) },
  xdr: {},
}));

describe("isAccountAddress", () => {
  it.each([
    ["valid account key", ACCOUNT, true],
    ["contract address", CONTRACT, false],
    ["empty string", "", false],
    ["whitespace", "   ", false],
    ["garbage", "not-an-address", false],
  ])("%s", (_label, value, expected) => {
    expect(isAccountAddress(value)).toBe(expected);
  });
});

describe("isContractAddress", () => {
  it.each([
    ["valid contract address", CONTRACT, true],
    ["account key", ACCOUNT, false],
    ["empty string", "", false],
    ["garbage", "not-an-address", false],
  ])("%s", (_label, value, expected) => {
    expect(isContractAddress(value)).toBe(expected);
  });
});

describe("isStellarAddress", () => {
  it.each([
    ["account key", ACCOUNT, true],
    ["contract address", CONTRACT, true],
    ["empty string", "", false],
    ["garbage", "not-an-address", false],
  ])("%s", (_label, value, expected) => {
    expect(isStellarAddress(value)).toBe(expected);
  });
});

describe("ensure helpers", () => {
  it("ensureAddress accepts both forms", () => {
    expect(() => ensureAddress(ACCOUNT, "identity")).not.toThrow();
    expect(() => ensureAddress(CONTRACT, "identity")).not.toThrow();
    expect(() => ensureAddress("garbage", "identity")).toThrow(
      "identity must be a valid Stellar public key or contract address."
    );
  });

  it("ensureAccountAddress rejects non-account inputs", () => {
    expect(() => ensureAccountAddress(ACCOUNT, "user")).not.toThrow();
    expect(() => ensureAccountAddress(CONTRACT, "user")).toThrow(
      "user must be a valid Stellar account public key (G...)."
    );
  });

  it("ensureContractAddress rejects non-contract inputs", () => {
    expect(() => ensureContractAddress(CONTRACT, "token")).not.toThrow();
    expect(() => ensureContractAddress(ACCOUNT, "token")).toThrow(
      "token must be a valid Soroban contract address (C...)."
    );
  });

  it("ensureAddressList validates every element and the container", () => {
    expect(() => ensureAddressList([ACCOUNT, CONTRACT], "signers")).not.toThrow();
    expect(() => ensureAddressList(["garbage"], "signers")).toThrow(
      "signers[0] must be a valid Stellar public key or contract address."
    );
    expect(() =>
      ensureAddressList("GA" as unknown as string[], "signers")
    ).toThrow(ValidationError);
  });
});

describe("LinkoraClient method validation matrix", () => {
  let client: LinkoraClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new LinkoraClient({ contractId: "CDUMMY", rpcUrl: "https://dummy.example.com" });
  });

  /**
   * Every client method that takes a token parameter enforces contract
   * addresses (C...); identity parameters accept both forms (issue #1345).
   */
  it.each([
    ["setProfile", () => client.setProfile("GUSER", "alice", ACCOUNT)],
    ["tip", () => client.tip("GSENDER", 1n, ACCOUNT, 100n)],
    ["createPool", () => client.createPool("GADMIN", "pool1", ACCOUNT, ["GA"], 2)],
    ["poolDeposit", () => client.poolDeposit("GDEPOSITOR", "pool1", ACCOUNT, 1000)],
  ])("%s rejects account keys as token parameters", (_label, call) => {
    expect(call).toThrow("must be a valid Soroban contract address");
  });

  it.each([
    ["setProfile", () => client.setProfile("GUSER", "alice", CONTRACT)],
    ["tip", () => client.tip("GSENDER", 1n, CONTRACT, 100n)],
    ["createPool", () => client.createPool("GADMIN", "pool1", CONTRACT, ["GA"], 2)],
    ["poolDeposit", () => client.poolDeposit("GDEPOSITOR", "pool1", CONTRACT, 1000)],
  ])("%s accepts valid contract addresses as token parameters", (_label, call) => {
    expect(call).not.toThrow();
  });

  it("identity parameters accept both account and contract addresses", () => {
    expect(() => client.follow(ACCOUNT, CONTRACT)).not.toThrow();
    expect(() => client.follow(CONTRACT, ACCOUNT)).not.toThrow();
    expect(() => client.deleteProfile(CONTRACT)).not.toThrow();
    expect(() => client.govPropose(ACCOUNT, "FeeBps", 500, CONTRACT)).not.toThrow();
  });
});
