/**
 * Tests for LinkoraClient token factory methods:
 *   - deployCreatorToken
 *   - setProfileWithNewToken
 *   - simulateDeployCreatorToken
 *
 * Uses the same mock pattern as write.test.ts — all stellar-sdk calls are
 * intercepted; no network access required.
 */

import { LinkoraClient } from "../client";

const mockCall = jest.fn();
const mockAddOperation = jest.fn();
const mockSetTimeout = jest.fn();
const mockBuild = jest.fn();
const mockToEnvelope = jest.fn();
const mockToXDR = jest.fn();
const mockSimulate = jest.fn();
const mockGetPublicKey = jest.fn(() => "GFAKEKEY111111111111111111111111");

jest.mock("@stellar/stellar-sdk/rpc", () => ({
  Server: jest.fn(() => ({ simulateTransaction: mockSimulate })),
  Api: {
    isSimulationError: jest.fn(() => false),
    isSimulationSuccess: jest.fn(() => true),
  },
}));

jest.mock("@stellar/stellar-base", () => ({
  Contract: jest.fn(() => ({ call: mockCall })),
  nativeToScVal: jest.fn((val: unknown, opts?: unknown) => ({
    _type: "scval",
    _val: val,
    _opts: opts,
  })),
  scValToNative: jest.fn((v: unknown) => v),
  TransactionBuilder: jest.fn(() => ({ addOperation: mockAddOperation })),
  Account: jest.fn(),
  Keypair: { random: jest.fn(() => ({ publicKey: mockGetPublicKey })) },
  xdr: {},
}));

const XDR = "AAAAfake-factory-xdr-base64==";
const FACTORY_ID = "CFACTORY1111111111111111111111111111111111111111111111111";
const CONTRACT_ID = "CCONTRACT111111111111111111111111111111111111111111111111";
const DEPLOYER = "GDEPLOYER1111111111111111111111111111111111111111111111111";
const TOKEN_ADDR = "CTOKEN1111111111111111111111111111111111111111111111111111";

const addr = (s: string) => expect.objectContaining({ _val: s });
const val = (v: unknown) => expect.objectContaining({ _val: v });

function makeClient() {
  return new LinkoraClient({
    contractId: CONTRACT_ID,
    rpcUrl: "https://dummy.example.com",
    tokenFactoryId: FACTORY_ID,
  });
}

describe("LinkoraClient — token factory methods", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAddOperation.mockReturnValue({ setTimeout: mockSetTimeout });
    mockSetTimeout.mockReturnValue({ build: mockBuild });
    mockBuild.mockReturnValue({ toEnvelope: mockToEnvelope });
    mockToEnvelope.mockReturnValue({ toXDR: mockToXDR });
    mockToXDR.mockReturnValue(XDR);
  });

  // ── deployCreatorToken ───────────────────────────────────────────────────

  describe("deployCreatorToken", () => {
    it("builds a transaction XDR targeting the factory contract", () => {
      const client = makeClient();
      const result = client.deployCreatorToken({
        deployer: DEPLOYER,
        name: "My Token",
        symbol: "MTK",
        decimals: 7,
        initialSupply: 1_000_000n,
      });

      expect(result).toBe(XDR);

      // Contract must be instantiated with the factory ID, not the main contract ID.
      const { Contract } = jest.requireMock("@stellar/stellar-base");
      expect(Contract).toHaveBeenCalledWith(FACTORY_ID);

      // The call must use the correct method name and args.
      expect(mockCall).toHaveBeenCalledWith(
        "deploy_creator_token",
        addr(DEPLOYER),
        val("My Token"),
        val("MTK"),
        val(7),
        val(1_000_000n)
      );
    });

    it("throws if tokenFactoryId is not configured", () => {
      const client = new LinkoraClient({
        contractId: CONTRACT_ID,
        rpcUrl: "https://dummy.example.com",
        // tokenFactoryId intentionally omitted
      });

      expect(() =>
        client.deployCreatorToken({
          deployer: DEPLOYER,
          name: "Test",
          symbol: "TST",
          decimals: 7,
          initialSupply: 0n,
        })
      ).toThrow("tokenFactoryId must be set");
    });
  });

  // ── setProfileWithNewToken ───────────────────────────────────────────────

  describe("setProfileWithNewToken", () => {
    it("returns two XDR strings — deploy first, profile second", () => {
      const client = makeClient();
      const [deployXdr, profileXdr] = client.setProfileWithNewToken({
        user: DEPLOYER,
        username: "alice",
        tokenParams: {
          name: "Alice Coin",
          symbol: "ALC",
          decimals: 7,
          initialSupply: 500_000n,
        },
      });

      // Both must be the mocked XDR (real tests would differ; here we verify
      // sequencing by checking two distinct calls were made).
      expect(deployXdr).toBe(XDR);
      expect(profileXdr).toBe(XDR);

      // Two contract calls must have been made in order.
      expect(mockCall).toHaveBeenCalledTimes(2);

      // First call: deploy_creator_token on the factory.
      expect(mockCall).toHaveBeenNthCalledWith(
        1,
        "deploy_creator_token",
        addr(DEPLOYER),
        val("Alice Coin"),
        val("ALC"),
        val(7),
        val(500_000n)
      );

      // Second call: set_profile on the main Linkora contract.
      expect(mockCall).toHaveBeenNthCalledWith(
        2,
        "set_profile",
        addr(DEPLOYER),
        val("alice"),
        expect.anything() // placeholder address
      );
    });

    it("throws if tokenFactoryId is not configured", () => {
      const client = new LinkoraClient({
        contractId: CONTRACT_ID,
        rpcUrl: "https://dummy.example.com",
      });

      expect(() =>
        client.setProfileWithNewToken({
          user: DEPLOYER,
          username: "alice",
          tokenParams: { name: "T", symbol: "T", decimals: 0, initialSupply: 0n },
        })
      ).toThrow("tokenFactoryId must be set");
    });
  });

  // ── simulateDeployCreatorToken ───────────────────────────────────────────

  describe("simulateDeployCreatorToken", () => {
    it("returns the token address from the simulation result", async () => {
      mockSimulate.mockResolvedValue({
        result: { retval: TOKEN_ADDR },
        error: undefined,
      });

      const rpc = jest.requireMock("@stellar/stellar-sdk/rpc") as {
        Api: { isSimulationSuccess: jest.Mock; isSimulationError: jest.Mock };
      };
      rpc.Api.isSimulationSuccess.mockReturnValue(true);
      rpc.Api.isSimulationError.mockReturnValue(false);

      const { scValToNative } = jest.requireMock("@stellar/stellar-base");
      scValToNative.mockReturnValue(TOKEN_ADDR);

      const client = makeClient();
      const result = await client.simulateDeployCreatorToken({
        deployer: DEPLOYER,
        name: "Sim Token",
        symbol: "SIM",
        decimals: 7,
        initialSupply: 100n,
      });

      expect(result).toBe(TOKEN_ADDR);

      // Must simulate against the factory contract.
      const { Contract } = jest.requireMock("@stellar/stellar-base");
      expect(Contract).toHaveBeenCalledWith(FACTORY_ID);
    });

    it("returns null when simulation has no result", async () => {
      mockSimulate.mockResolvedValue({
        result: null,
        error: undefined,
      });

      const rpc = jest.requireMock("@stellar/stellar-sdk/rpc") as {
        Api: { isSimulationSuccess: jest.Mock; isSimulationError: jest.Mock };
      };
      rpc.Api.isSimulationSuccess.mockReturnValue(true);
      rpc.Api.isSimulationError.mockReturnValue(false);

      const client = makeClient();
      const result = await client.simulateDeployCreatorToken({
        deployer: DEPLOYER,
        name: "Sim Token",
        symbol: "SIM",
        decimals: 7,
        initialSupply: 100n,
      });

      expect(result).toBeNull();
    });

    it("throws if tokenFactoryId is not configured", async () => {
      const client = new LinkoraClient({
        contractId: CONTRACT_ID,
        rpcUrl: "https://dummy.example.com",
      });

      await expect(
        client.simulateDeployCreatorToken({
          deployer: DEPLOYER,
          name: "T",
          symbol: "T",
          decimals: 0,
          initialSupply: 0n,
        })
      ).rejects.toThrow("tokenFactoryId must be set");
    });
  });
});
