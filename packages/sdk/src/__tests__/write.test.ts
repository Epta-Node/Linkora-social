import { LinkoraClient } from "../client";

const mockCall = jest.fn();
const mockBuild = jest.fn();
const mockToEnvelope = jest.fn();
const mockToXDR = jest.fn();
const mockAddOperation = jest.fn();
const mockSetTimeout = jest.fn();

jest.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: jest.fn(),
    Api: { isSimulationError: jest.fn(), isSimulationSuccess: jest.fn() },
  },
  Contract: jest.fn(() => ({ call: mockCall })),
  Address: { fromString: jest.fn((v: string) => ({ toScVal: () => ({ _type: "scval", _val: v, _opts: { type: "address" } }) })) },
  nativeToScVal: jest.fn((val: unknown, opts?: unknown) => ({
    _type: "scval",
    _val: val,
    _opts: opts,
  })),
  scValToNative: jest.fn(),
  TransactionBuilder: jest.fn(() => ({ addOperation: mockAddOperation })),
  Account: jest.fn(),
  Keypair: { random: jest.fn(() => ({ publicKey: () => "GWRITEKEYXXXXXXXXXXXXXXXXXXXXXXXXXX" })) },
  xdr: {},
}));

const XDR = "AAAAfakexdrbase64encodedstring";

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
    expect(mockCall).toHaveBeenCalledWith(
      "set_profile",
      addr("GUSER"),
      val("alice"),
      addr("GTOKEN")
    );
  });

  it("deleteProfile", () => {
    expect(client.deleteProfile("GUSER")).toBe(XDR);
    expect(mockCall).toHaveBeenCalledWith("delete_profile", addr("GUSER"));
  });

  it("createPost", () => {
    expect(client.createPost("GAUTHOR", "hello")).toBe(XDR);
    expect(mockCall).toHaveBeenCalledWith("create_post", addr("GAUTHOR"), val("hello"));
  });

  it("deletePost", () => {
    expect(client.deletePost("GAUTHOR", 5)).toBe(XDR);
    expect(mockCall).toHaveBeenCalledWith("delete_post", addr("GAUTHOR"), val(5n));
  });

  it("follow", () => {
    expect(client.follow("GA", "GB")).toBe(XDR);
    expect(mockCall).toHaveBeenCalledWith("follow", addr("GA"), addr("GB"));
  });

  it("unfollow", () => {
    expect(client.unfollow("GA", "GB")).toBe(XDR);
    expect(mockCall).toHaveBeenCalledWith("unfollow", addr("GA"), addr("GB"));
  });

  it("blockUser", () => {
    expect(client.blockUser("GA", "GB")).toBe(XDR);
    expect(mockCall).toHaveBeenCalledWith("block_user", addr("GA"), addr("GB"));
  });

  it("unblockUser", () => {
    expect(client.unblockUser("GA", "GB")).toBe(XDR);
    expect(mockCall).toHaveBeenCalledWith("unblock_user", addr("GA"), addr("GB"));
  });

  it("likePost", () => {
    expect(client.likePost("GUSER", 7)).toBe(XDR);
    expect(mockCall).toHaveBeenCalledWith("like_post", addr("GUSER"), val(7n));
  });

  it("tip includes token argument", () => {
    expect(client.tip("GSENDER", 3, "GTOKEN", 500)).toBe(XDR);
    expect(mockCall).toHaveBeenCalledWith("tip", addr("GSENDER"), val(3n), addr("GTOKEN"), val(500n));
  });

  it("tip accepts bigint amount", () => {
    expect(client.tip("GSENDER", 3, "GTOKEN", 1000n)).toBe(XDR);
    expect(mockCall).toHaveBeenCalledWith(
      "tip",
      addr("GSENDER"),
      val(3n),
      addr("GTOKEN"),
      val(1000n)
    );
  });

  it("createPool includes pool_id", () => {
    expect(client.createPool("GADMIN", "pool1", "GTOKEN", ["GA", "GB"], 2)).toBe(XDR);
    expect(mockCall).toHaveBeenCalledWith(
      "create_pool",
      addr("GADMIN"),
      val("pool1"),
      addr("GTOKEN"),
      expect.anything(),
      val(2)
    );
  });

  it("poolDeposit", () => {
    expect(client.poolDeposit("GDEPOSITOR", "pool1", "GTOKEN", 1000)).toBe(XDR);
    expect(mockCall).toHaveBeenCalledWith(
      "pool_deposit",
      addr("GDEPOSITOR"),
      val("pool1"),
      addr("GTOKEN"),
      val(1000n)
    );
  });

  it("poolWithdraw", () => {
    expect(client.poolWithdraw(["GA", "GB"], "pool1", 500, "GRECIPIENT")).toBe(XDR);
    expect(mockCall).toHaveBeenCalledWith(
      "pool_withdraw",
      expect.anything(),
      val("pool1"),
      val(500n),
      addr("GRECIPIENT")
    );
  });

  it("addPoolAdmin", () => {
    expect(client.addPoolAdmin(["GA"], "pool1", "GNEWADMIN")).toBe(XDR);
    expect(mockCall).toHaveBeenCalledWith(
      "add_pool_admin",
      expect.anything(),
      val("pool1"),
      addr("GNEWADMIN")
    );
  });

  it("removePoolAdmin", () => {
    expect(client.removePoolAdmin(["GA"], "pool1", "GADMIN")).toBe(XDR);
    expect(mockCall).toHaveBeenCalledWith(
      "remove_pool_admin",
      expect.anything(),
      val("pool1"),
      addr("GADMIN")
    );
  });

  it("updatePoolThreshold", () => {
    expect(client.updatePoolThreshold(["GA", "GB"], "pool1", 1)).toBe(XDR);
    expect(mockCall).toHaveBeenCalledWith(
      "update_pool_threshold",
      expect.anything(),
      val("pool1"),
      val(1)
    );
  });

  it("setFee", () => {
    expect(client.setFee(250)).toBe(XDR);
    expect(mockCall).toHaveBeenCalledWith("set_fee", val(250));
  });

  it("setTreasury", () => {
    expect(client.setTreasury("GTREASURY")).toBe(XDR);
    expect(mockCall).toHaveBeenCalledWith("set_treasury", addr("GTREASURY"));
  });

  it("setTipCooldownWindow", () => {
    expect(client.setTipCooldownWindow(17280)).toBe(XDR);
    expect(mockCall).toHaveBeenCalledWith("set_tip_cooldown_window", val(17280));
  });

  it("verifyAnalyticsAttestation builds tx with correct args", () => {
    const reportCbor = new Uint8Array([1, 2, 3, 4]);
    const signature = new Uint8Array(64).fill(0xab);

    expect(
      client.verifyAnalyticsAttestation(
        "default",
        reportCbor,
        signature,
        "GCREATOR",
        1000,
        2000
      )
    ).toBe(XDR);
    expect(mockCall).toHaveBeenCalledWith(
      "verify_analytics_attestation",
      val("default"),
      expect.objectContaining({ _val: expect.anything() }),
      expect.objectContaining({ _val: expect.anything() }),
      addr("GCREATOR"),
      val(1000),
      val(2000)
    );
  });
});
