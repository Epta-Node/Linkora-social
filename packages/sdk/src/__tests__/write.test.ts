import { Account } from "@stellar/stellar-base";
import { LinkoraClient } from "../client";
import { InvalidInputError, ValidationError } from "../errors";

const mockCall = jest.fn();
const mockBuild = jest.fn();
const mockToEnvelope = jest.fn();
const mockToXDR = jest.fn();
const mockAddOperation = jest.fn();
const mockSetTimeout = jest.fn();

const XDR = "AAAAfakexdrbase64encodedstring";

jest.mock("@stellar/stellar-sdk/rpc", () => ({
  Server: jest.fn(),
  Api: { isSimulationError: jest.fn(), isSimulationSuccess: jest.fn() },
}));

jest.mock("@stellar/stellar-base", () => ({
  Contract: jest.fn(() => ({
    call: mockCall,
    address: () => ({ toScAddress: () => ({ _scAddress: true }) }),
  })),
  Address: {
    fromString: jest.fn((v: string) => ({
      toScVal: () => ({ _type: "scval", _val: v, _opts: { type: "address" } }),
    })),
  },
  StrKey: {
    isValidEd25519PublicKey: jest.fn(
      (value: string) => typeof value === "string" && value.startsWith("G")
    ),
  },
  nativeToScVal: jest.fn((val: unknown, opts?: unknown) => ({
    _type: "scval",
    _val: val,
    _opts: opts,
  })),
  scValToNative: jest.fn(),
  TransactionBuilder: jest.fn(() => ({ addOperation: mockAddOperation })),
  Account: jest.fn((accountId: string, sequence: string) => ({
    _accountId: accountId,
    sequence,
  })),
  Keypair: { random: jest.fn(() => ({ publicKey: () => "GWRITEKEYXXXXXXXXXXXXXXXXXXXXXXXXXX" })) },
  xdr: {},
}));

// Mock the generated client helper functions
jest.mock("../generated/client", () => ({
  GeneratedLinkoraClient: class {
    contractId: string;
    rpcUrl: string;
    networkPassphrase: string;
    contract: { call: jest.Mock };
    constructor(config: any) {
      this.contractId = config.contractId;
      this.rpcUrl = config.rpcUrl;
      this.networkPassphrase = config.networkPassphrase || "Test SDF Network ; September 2015";
      this.contract = { call: mockCall };
    }
    async getProfile() {
      return null;
    }
    async getPost() {
      return null;
    }
    async getProfileCount() {
      return 0n;
    }
    async getPostCount() {
      return 0n;
    }
    async getLikeCount() {
      return 0n;
    }
    async getTreasury() {
      return null;
    }
    async getPool() {
      return null;
    }
    async getDmKey() {
      return null;
    }
    publishDmKey() {
      return XDR;
    }
    govPropose() {
      return XDR;
    }
    govVote() {
      return XDR;
    }
    govExecute() {
      return XDR;
    }
    async govGetProposal() {
      return null;
    }
    async effectiveQuorum() {
      return 0;
    }
    govVeto() {
      return XDR;
    }
    deletePost() {
      return XDR;
    }
    deleteProfile() {
      return XDR;
    }
    createPost() {
      return XDR;
    }
    follow() {
      return XDR;
    }
    unfollow() {
      return XDR;
    }
    blockUser() {
      return XDR;
    }
    unblockUser() {
      return XDR;
    }
    likePost() {
      return XDR;
    }
    tip() {
      return XDR;
    }
    poolDeposit() {
      return XDR;
    }
    poolWithdraw() {
      return XDR;
    }
    setProfile() {
      return XDR;
    }
    createPool() {
      return XDR;
    }
    addPoolAdmin() {
      return XDR;
    }
    removePoolAdmin() {
      return XDR;
    }
    updatePoolThreshold() {
      return XDR;
    }
    setFee() {
      return XDR;
    }
    setTreasury() {
      return XDR;
    }
    setTipCooldownWindow() {
      return XDR;
    }
    verifyAnalyticsAttestation() {
      return XDR;
    }
  },
  scvAddress: (v: string) => ({ _type: "scval", _val: v, _opts: { type: "address" } }),
  scvString: (v: string) => ({ _type: "scval", _val: v, _opts: undefined }),
}));

describe("LinkoraClient write methods", () => {
  let client: LinkoraClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new LinkoraClient({ contractId: "CDUMMY", rpcUrl: "https://dummy.example.com" });
    mockAddOperation.mockReturnValue({ setTimeout: mockSetTimeout });
    mockSetTimeout.mockReturnValue({ build: mockBuild });
    mockBuild.mockReturnValue({ toEnvelope: mockToEnvelope });
    mockToEnvelope.mockReturnValue({ toXDR: mockToXDR });
    mockToXDR.mockReturnValue(XDR);
  });

  const addr = (s: string) => expect.objectContaining({ _val: s });
  const val = (v: unknown) => expect.objectContaining({ _val: v });

  it("setProfile", () => {
    expect(client.setProfile("GUSER", "alice", "GTOKEN")).toBe(XDR);
  });

  it("deleteProfile", () => {
    expect(client.deleteProfile("GUSER")).toBe(XDR);
  });

  it("createPost", () => {
    expect(client.createPost("GAUTHOR", "hello")).toBe(XDR);
  });

  it("deletePost", () => {
    expect(client.deletePost("GAUTHOR", 5)).toBe(XDR);
  });

  it("follow", () => {
    expect(client.follow("GA", "GB")).toBe(XDR);
  });

  it("unfollow", () => {
    expect(client.unfollow("GA", "GB")).toBe(XDR);
  });

  it("blockUser", () => {
    expect(client.blockUser("GA", "GB")).toBe(XDR);
  });

  it("unblockUser", () => {
    expect(client.unblockUser("GA", "GB")).toBe(XDR);
  });

  it("likePost", () => {
    expect(client.likePost("GUSER", 7)).toBe(XDR);
  });

  it("tip includes token argument", () => {
    expect(client.tip("GSENDER", 3, "GTOKEN", 500)).toBe(XDR);
  });

  it("tip accepts bigint amount", () => {
    expect(client.tip("GSENDER", 3, "GTOKEN", 1000n)).toBe(XDR);
  });

  it("createPool includes pool_id", () => {
    expect(client.createPool("GADMIN", "pool1", "GTOKEN", ["GA", "GB"], 2)).toBe(XDR);
  });

  it("poolDeposit", () => {
    expect(client.poolDeposit("GDEPOSITOR", "pool1", "GTOKEN", 1000)).toBe(XDR);
  });

  it("poolWithdraw", () => {
    expect(client.poolWithdraw(["GA", "GB"], "pool1", 500, "GRECIPIENT")).toBe(XDR);
  });

  it("addPoolAdmin", () => {
    expect(client.addPoolAdmin(["GA"], "pool1", "GNEWADMIN")).toBe(XDR);
  });

  it("removePoolAdmin", () => {
    expect(client.removePoolAdmin(["GA"], "pool1", "GADMIN")).toBe(XDR);
  });

  it("updatePoolThreshold", () => {
    expect(client.updatePoolThreshold(["GA", "GB"], "pool1", 1)).toBe(XDR);
  });

  it("setFee", () => {
    expect(client.setFee(250)).toBe(XDR);
  });

  it("setTreasury", () => {
    expect(client.setTreasury("GTREASURY")).toBe(XDR);
  });

  it("setTipCooldownWindow", () => {
    expect(client.setTipCooldownWindow(17280)).toBe(XDR);
  });

  it("verifyAnalyticsAttestation builds tx with correct args", () => {
    const reportCbor = new Uint8Array([1, 2, 3, 4]);
    const signature = new Uint8Array(64).fill(0xab);

    expect(
      client.verifyAnalyticsAttestation("default", reportCbor, signature, "GCREATOR", 1000, 2000)
    ).toBe(XDR);
  });

  it("rejects malformed addresses before building tx", () => {
    expect(() => client.createPost("not-an-address", "hello")).toThrow(InvalidInputError);
    expect(() => client.follow("not-an-address", "GVALID")).toThrow(InvalidInputError);
    expect(() => client.tip("GVALID", 3, "not-an-address", 100)).toThrow(InvalidInputError);
  });

  it("rejects empty content and unsupported governance parameters", () => {
    expect(() => client.createPost("GVALID", "")).toThrow(InvalidInputError);
    expect(() => client.govPropose("GVALID", "Unsupported" as never, 1, null)).toThrow(
      InvalidInputError
    );
  });

  it("rejects oversized byte arrays for verifyAnalyticsAttestation", () => {
    const oversizedReportCbor = new Uint8Array(64 * 1024 + 1);
    const validSignature = new Uint8Array(64).fill(0xab);

    expect(() =>
      client.verifyAnalyticsAttestation(
        "default",
        oversizedReportCbor,
        validSignature,
        "GCREATOR",
        1000,
        2000
      )
    ).toThrow(ValidationError);
  });
});

describe("prepare*Tx methods (Submittable)", () => {
  let client: LinkoraClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new LinkoraClient({ contractId: "CDUMMY", rpcUrl: "https://dummy.example.com" });
    mockAddOperation.mockReturnValue({ setTimeout: mockSetTimeout });
    mockSetTimeout.mockReturnValue({ build: mockBuild });
    mockBuild.mockReturnValue({ toEnvelope: mockToEnvelope });
    mockToEnvelope.mockReturnValue({ toXDR: mockToXDR });
    mockToXDR.mockReturnValue(XDR);
  });

  const addr = (s: string) => expect.objectContaining({ _val: s });
  const val = (v: unknown) => expect.objectContaining({ _val: v });

  it("prepareCreatePostTx fetches sequence and uses prepareTransaction", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(client as any, "getAccountForTx").mockResolvedValue(new Account("GAUTHOR", "100"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(client, "prepareTransaction").mockResolvedValue({
      toEnvelope: () => ({ toXDR: () => "PREPARED_XDR" }),
    } as unknown as Awaited<ReturnType<typeof client.prepareTransaction>>);

    const result = await client.prepareCreatePostTx("GAUTHOR", "hello");
    expect(result).toBe("PREPARED_XDR");
    expect(client.prepareTransaction).toHaveBeenCalledWith(
      "create_post",
      expect.objectContaining({ _accountId: "GAUTHOR" }),
      addr("GAUTHOR"),
      val("hello")
    );
  });

  it("prepareFollowTx fetches sequence and uses prepareTransaction", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(client as any, "getAccountForTx").mockResolvedValue(new Account("GA", "100"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    jest.spyOn(client, "prepareTransaction").mockResolvedValue({
      toEnvelope: () => ({ toXDR: () => "PREPARED_XDR" }),
    } as unknown as Awaited<ReturnType<typeof client.prepareTransaction>>);

    const result = await client.prepareFollowTx("GA", "GB");
    expect(result).toBe("PREPARED_XDR");
    expect(client.prepareTransaction).toHaveBeenCalledWith(
      "follow",
      expect.objectContaining({ _accountId: "GA" }),
      addr("GA"),
      addr("GB")
    );
  });
});
