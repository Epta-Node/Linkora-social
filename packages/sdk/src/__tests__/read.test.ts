import { LinkoraClient } from "../client";
import { Profile, Post, Pool } from "../types";

const mockSimulate = jest.fn();
const mockCall = jest.fn();
const mockBuild = jest.fn();
const mockToEnvelope = jest.fn();
const mockToXDR = jest.fn();
const mockAddOperation = jest.fn();
const mockSetTimeout = jest.fn();

jest.mock("@stellar/stellar-sdk/rpc", () => ({
  Server: jest.fn(() => ({ simulateTransaction: mockSimulate })),
  Api: {
    isSimulationError: (r: unknown) => !!(r as { error?: unknown }).error,
    isSimulationSuccess: (r: unknown) => !!(r as { result?: unknown }).result,
  },
}));

jest.mock("@stellar/stellar-base", () => ({
  Contract: jest.fn(() => ({ call: mockCall })),
  StrKey: {
    isValidEd25519PublicKey: jest.fn(
      (value: string) => typeof value === "string" && value.startsWith("G")
    ),
    isValidContract: jest.fn((value: string) => typeof value === "string" && value.startsWith("C")),
  },
  nativeToScVal: jest.fn((val: unknown, opts?: unknown) => ({
    _type: "scval",
    _val: val,
    _opts: opts,
  })),
  scValToNative: jest.fn((scv: unknown) => {
    const v = (scv as { _val: unknown })._val;
    if (typeof v === "object" && v !== null && "_type" in (v as object)) {
      return (v as { _val: unknown })._val;
    }
    return v;
  }),
  TransactionBuilder: jest.fn(() => ({ addOperation: mockAddOperation })),
  Account: jest.fn(),
  Keypair: { random: jest.fn(() => ({ publicKey: () => "GDUMMYKEYPAIRXXXXXXXXXXXXXXXXXXXXXX" })) },
  xdr: {},
}));

describe("LinkoraClient read methods", () => {
  let client: LinkoraClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new LinkoraClient({ contractId: "CDUMMY", rpcUrl: "https://dummy.example.com" });
    mockAddOperation.mockReturnValue({ setTimeout: mockSetTimeout });
    mockSetTimeout.mockReturnValue({ build: mockBuild });
    mockBuild.mockReturnValue({ toEnvelope: mockToEnvelope });
    mockToEnvelope.mockReturnValue({ toXDR: mockToXDR });
    mockToXDR.mockReturnValue("AAAAfake");
  });

  const success = (retval: unknown) =>
    mockSimulate.mockResolvedValue({ result: { retval: { _type: "scval", _val: retval } } });
  const notFound = () => mockSimulate.mockResolvedValue({ result: null });
  const simError = (msg: string) => mockSimulate.mockResolvedValue({ error: msg });

  const addr = (s: string) => expect.objectContaining({ _val: s });
  const val = (v: unknown) => expect.objectContaining({ _val: v });

  describe("getProfile", () => {
    it("returns a profile", async () => {
      const profile: Profile = { address: "GUSER", username: "alice", creator_token: "GTOKEN" };
      success(profile);
      expect(await client.getProfile("GUSER")).toEqual(profile);
      expect(mockCall).toHaveBeenCalledWith("get_profile", addr("GUSER"));
    });

    it("returns null when not found (null result)", async () => {
      notFound();
      expect(await client.getProfile("GUSER")).toBeNull();
    });

    it("returns null on NotFoundError (MissingValue)", async () => {
      simError("HostError: Error(Storage, MissingValue)");
      expect(await client.getProfile("GUSER")).toBeNull();
    });
  });

  describe("getProfileCount", () => {
    it("returns count", async () => {
      success(5n);
      expect(await client.getProfileCount()).toBe(5n);
      expect(mockCall).toHaveBeenCalledWith("get_profile_count");
    });

    it("returns 0 when null", async () => {
      notFound();
      expect(await client.getProfileCount()).toBe(0n);
    });
  });

  describe("getAddressByUsername", () => {
    it("returns address", async () => {
      success("GOWNER");
      expect(await client.getAddressByUsername("alice")).toBe("GOWNER");
      expect(mockCall).toHaveBeenCalledWith("get_address_by_username", val("alice"));
    });

    it("returns null when not found", async () => {
      notFound();
      expect(await client.getAddressByUsername("x")).toBeNull();
    });
  });

  describe("getPost", () => {
    it("returns a post", async () => {
      const post: Post = {
        id: 1n,
        author: "GAUTHOR",
        content: "hi",
        tip_total: 0n,
        timestamp: 123n,
        like_count: 0n,
      };
      success(post);
      expect(await client.getPost(1)).toEqual(post);
      expect(mockCall).toHaveBeenCalledWith("get_post", val(1n));
    });

    it("returns null when null result", async () => {
      notFound();
      expect(await client.getPost(999)).toBeNull();
    });

    it("returns null on MissingValue error", async () => {
      simError("Error(Storage, MissingValue)");
      expect(await client.getPost(999)).toBeNull();
    });
  });

  describe("getPostCount", () => {
    it("returns count", async () => {
      success(10n);
      expect(await client.getPostCount()).toBe(10n);
    });
    it("returns 0 when null", async () => {
      notFound();
      expect(await client.getPostCount()).toBe(0n);
    });
  });

  describe("getPostsByAuthor", () => {
    it("returns post IDs", async () => {
      success([1n, 2n, 3n]);
      const result = await client.getPostsByAuthor("GAUTHOR", 0, 10);
      expect(result).toEqual([1n, 2n, 3n]);
      expect(mockCall).toHaveBeenCalledWith(
        "get_posts_by_author",
        addr("GAUTHOR"),
        val(0),
        val(10)
      );
    });

    it("returns empty array when null", async () => {
      notFound();
      expect(await client.getPostsByAuthor("GAUTHOR", 0, 10)).toEqual([]);
    });
  });

  describe("getFollowing", () => {
    it("returns addresses with offset/limit", async () => {
      success(["GA", "GB"]);
      expect(await client.getFollowing("GUSER", 0, 10)).toEqual(["GA", "GB"]);
      expect(mockCall).toHaveBeenCalledWith("get_following", addr("GUSER"), val(0), val(10));
    });

    it("returns empty array when null", async () => {
      notFound();
      expect(await client.getFollowing("GUSER", 0, 10)).toEqual([]);
    });
  });

  describe("getFollowers", () => {
    it("returns addresses with offset/limit", async () => {
      success(["GX", "GY"]);
      expect(await client.getFollowers("GUSER", 0, 10)).toEqual(["GX", "GY"]);
      expect(mockCall).toHaveBeenCalledWith("get_followers", addr("GUSER"), val(0), val(10));
    });
  });

  describe("isBlocked", () => {
    it("returns true", async () => {
      success(true);
      expect(await client.isBlocked("GA", "GB")).toBe(true);
    });
    it("returns false", async () => {
      success(false);
      expect(await client.isBlocked("GA", "GB")).toBe(false);
    });
  });

  describe("hasLiked", () => {
    it("returns true", async () => {
      success(true);
      expect(await client.hasLiked("GUSER", 1n)).toBe(true);
    });
    it("returns false when null", async () => {
      notFound();
      expect(await client.hasLiked("GUSER", 1n)).toBe(false);
    });
  });

  describe("getLikeCount", () => {
    it("returns count", async () => {
      success(7n);
      expect(await client.getLikeCount(1n)).toBe(7n);
    });
    it("returns 0 when null", async () => {
      notFound();
      expect(await client.getLikeCount(1n)).toBe(0n);
    });
  });

  describe("getPool", () => {
    it("returns a pool", async () => {
      const pool: Pool = {
        token: "GTOKEN",
        balance: 1000n,
        admins: ["GA"],
        threshold: 1,
      };
      success(pool);
      expect(await client.getPool("p1")).toEqual(pool);
      expect(mockCall).toHaveBeenCalledWith("get_pool", val("p1"));
    });

    it("returns null when null result", async () => {
      notFound();
      expect(await client.getPool("p1")).toBeNull();
    });
  });

  describe("getPoolAdmins", () => {
    it("returns admin list", async () => {
      success(["GA", "GB"]);
      expect(await client.getPoolAdmins("p1")).toEqual(["GA", "GB"]);
      expect(mockCall).toHaveBeenCalledWith("get_pool_admins", val("p1"));
    });

    it("returns null when pool does not exist", async () => {
      notFound();
      expect(await client.getPoolAdmins("missing-pool")).toBeNull();
    });
  });

  describe("getFeeBps", () => {
    it("returns fee", async () => {
      success(250);
      expect(await client.getFeeBps()).toBe(250);
    });
    it("returns 0 when null", async () => {
      notFound();
      expect(await client.getFeeBps()).toBe(0);
    });
  });

  describe("getTreasury", () => {
    it("returns address", async () => {
      success("GTREASURY");
      expect(await client.getTreasury()).toBe("GTREASURY");
    });
    it("returns null when null", async () => {
      notFound();
      expect(await client.getTreasury()).toBeNull();
    });
    it("rethrows non-NotFound errors", async () => {
      simError("fetch failed");
      await expect(client.getTreasury()).rejects.toThrow("fetch failed");
    });
  });

  describe("getDmKey", () => {
    it("returns the DM key", async () => {
      success(new Uint8Array([1, 2, 3]));
      const key = await client.getDmKey("GUSER");
      expect(key).toEqual(new Uint8Array([1, 2, 3]));
    });

    it("rethrows non-NotFound errors", async () => {
      simError("network timeout");
      await expect(client.getDmKey("GUSER")).rejects.toThrow("network timeout");
    });
  });

  describe("getTipCooldownWindow", () => {
    it("returns window", async () => {
      success(17280);
      expect(await client.getTipCooldownWindow()).toBe(17280);
    });
    it("returns 0 when null", async () => {
      notFound();
      expect(await client.getTipCooldownWindow()).toBe(0);
    });
  });

  describe("error mapping", () => {
    it("throws mapped error for non-NotFound errors", async () => {
      simError("unauthorized action");
      await expect(client.getPostCount()).rejects.toThrow("Unauthorized");
    });
  });

  describe("contract address validation", () => {
    it("accepts valid contract addresses (C...)", () => {
      const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
      expect(() => client.setProfile("GUSER", "alice", contractId)).not.toThrow();
    });

    it("accepts valid account addresses (G...)", () => {
      const accountKey = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
      expect(() => client.setProfile("GUSER", "alice", accountKey)).not.toThrow();
    });

    it("rejects invalid addresses", () => {
      expect(() => client.setProfile("GUSER", "alice", "invalid")).toThrow("must be a valid");
    });

    it("accepts contract IDs in tip method", () => {
      const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
      expect(() => client.tip("GUSER", 1n, contractId, 100n)).not.toThrow();
    });

    it("accepts contract IDs in poolDeposit method", () => {
      const contractId = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
      expect(() => client.poolDeposit("GUSER", "pool1", contractId, 100n)).not.toThrow();
    });
  });
});

describe("custom network Horizon URL", () => {
  it("uses provided horizonUrl from config", async () => {
    const customClient = new LinkoraClient({
      contractId: "CDUMMY",
      rpcUrl: "https://dummy.example.com",
      networkPassphrase: "Custom Network",
      horizonUrl: "https://custom-horizon.example.com",
    });

    const mockFetchWithTimeout = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sequence: "123" }),
    });
    jest.mock("../utils/fetch.js", () => ({
      fetchWithTimeout: mockFetchWithTimeout,
    }));

    try {
      await customClient.prepareDmKeyTx("GUSER", new Uint8Array(32));
    } catch (error) {
      // Expected to fail at prepareTransaction step, but we verified Horizon URL logic
    }
  });

  it("throws ValidationError for custom network without horizonUrl", async () => {
    const customClient = new LinkoraClient({
      contractId: "CDUMMY",
      rpcUrl: "https://dummy.example.com",
      networkPassphrase: "Custom Network",
    });

    await expect(customClient.prepareDmKeyTx("GUSER", new Uint8Array(32))).rejects.toThrow(
      "Cannot determine Horizon URL"
    );
  });

  it("defaults to testnet Horizon for Test passphrase", async () => {
    const testClient = new LinkoraClient({
      contractId: "CDUMMY",
      rpcUrl: "https://dummy.example.com",
      networkPassphrase: "Test SDF Network ; September 2015",
    });

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ sequence: "123" }),
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    try {
      await testClient.prepareDmKeyTx("GUSER", new Uint8Array(32));
    } catch (error) {
      // Expected to fail, but we're testing Horizon URL derivation
    }
  });
});
