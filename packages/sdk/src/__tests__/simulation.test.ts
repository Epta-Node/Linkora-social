/* eslint-disable @typescript-eslint/no-explicit-any */
import { LinkoraClient } from "../client";
import { SimulationError } from "../errors";
import { Account } from "@stellar/stellar-base";

const mockCall = jest.fn();
const mockBuild = jest.fn();
const mockToEnvelope = jest.fn();
const mockToXDR = jest.fn();
const mockAddOperation = jest.fn();
const mockSetTimeout = jest.fn();
const mockSimulateTransaction = jest.fn();

jest.mock("@stellar/stellar-sdk/rpc", () => ({
  Server: jest.fn(() => ({ simulateTransaction: mockSimulateTransaction })),
  Api: {
    isSimulationError: jest.fn((result) => result._isError === true),
    isSimulationSuccess: jest.fn((result) => result._isSuccess === true),
  },
}));

jest.mock("@stellar/stellar-base", () => ({
  Contract: jest.fn(() => ({ call: mockCall })),
  nativeToScVal: jest.fn((val: unknown, opts?: unknown) => ({
    _type: "scval",
    _val: val,
    _opts: opts,
  })),
  scValToNative: jest.fn(),
  TransactionBuilder: jest.fn(() => ({
    addOperation: mockAddOperation,
    setTimeout: mockSetTimeout,
    setSorobanData: jest.fn().mockReturnThis(),
  })),
  SorobanDataBuilder: jest.fn(),
  Transaction: jest.fn(),
  Account: jest.fn(),
  Keypair: {
    random: jest.fn(() => ({ publicKey: () => "GWRITEKEYXXXXXXXXXXXXXXXXXXXXXXXXXX" })),
  },
  Address: jest.fn(),
  xdr: {},
}));

// Stub GeneratedLinkoraClient so the super() chain works without needing the
// real generated methods during unit tests of simulate / prepareTransaction / buildMultiOpTx.
jest.mock("../generated/client", () => ({
  GeneratedLinkoraClient: class {
    contractId: string;
    rpcUrl: string;
    networkPassphrase: string;
    constructor(config: any) {
      this.contractId = config.contractId;
      this.rpcUrl = config.rpcUrl;
      this.networkPassphrase = config.networkPassphrase || "Test SDF Network ; September 2015";
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
      return "";
    }
    govPropose() {
      return "";
    }
    govVote() {
      return "";
    }
    govExecute() {
      return "";
    }
    async govGetProposal() {
      return null;
    }
    async effectiveQuorum() {
      return 0;
    }
    govVeto() {
      return "";
    }
    deletePost() {
      return "";
    }
    likePost() {
      return "";
    }
    tip() {
      return "";
    }
    poolDeposit() {
      return "";
    }
    poolWithdraw() {
      return "";
    }
    setProfile() {
      return "";
    }
  },
}));

const XDR = "AAAAfakexdrbase64encodedstring";
const CONTRACT_ID = "CDUMMY";
const RPC_URL = "https://dummy.example.com";

describe("LinkoraClient simulation and fee injection", () => {
  let client: LinkoraClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new LinkoraClient({ contractId: CONTRACT_ID, rpcUrl: RPC_URL });
    const builder = {
      addOperation: mockAddOperation,
      setTimeout: mockSetTimeout,
      setSorobanData: jest.fn().mockReturnThis(),
      build: mockBuild,
    };
    mockAddOperation.mockReturnValue(builder);
    mockSetTimeout.mockReturnValue(builder);
    mockBuild.mockReturnValue({ toEnvelope: mockToEnvelope });
    mockToEnvelope.mockReturnValue({ toXDR: mockToXDR });
    mockToXDR.mockReturnValue(XDR);
  });

  describe("simulate()", () => {
    it("should return simulation result with resource fee on success", async () => {
      // minResourceFee is a top-level field on the simulation response (stellar-sdk v12)
      const mockResult = {
        _isSuccess: true,
        minResourceFee: "5000",
        transactionData: null,
        result: { retval: null },
      };
      mockSimulateTransaction.mockResolvedValue(mockResult);

      const result = await client.simulate("set_profile", {
        _type: "scval",
        _val: "GUSER",
      } as any);

      expect(result.success).toBe(true);
      expect(result.resourceFee).toBe("5000");
      // footprint is always defined (empty when transactionData is absent)
      expect(result.footprint).toBeDefined();
    });

    it("should throw SimulationError on simulation failure", async () => {
      const mockResult = {
        _isError: true,
        error: "Contract execution failed",
        events: ["event1"],
      };
      mockSimulateTransaction.mockResolvedValue(mockResult);

      await expect(
        client.simulate("set_profile", { _type: "scval", _val: "GUSER" } as any)
      ).rejects.toThrow(SimulationError);
    });

    it("should throw SimulationError when result is missing", async () => {
      const mockResult = {
        _isSuccess: true,
        minResourceFee: "0",
        transactionData: null,
        result: null,
      };
      mockSimulateTransaction.mockResolvedValue(mockResult);

      await expect(
        client.simulate("set_profile", { _type: "scval", _val: "GUSER" } as any)
      ).rejects.toThrow(SimulationError);
    });
  });

  describe("prepareTransaction()", () => {
    it("should return a prepared transaction with resource fee injected", async () => {
      const mockResult = {
        _isSuccess: true,
        minResourceFee: "5000",
        transactionData: null,
        result: { retval: null },
      };
      mockSimulateTransaction.mockResolvedValue(mockResult);

      const sourceAccount = new Account("GSOURCE", "0");
      const result = await client.prepareTransaction("set_profile", sourceAccount, {
        _type: "scval",
        _val: "GUSER",
      } as any);

      expect(result).toBeDefined();
      expect(mockSetTimeout).toHaveBeenCalled();
    });

    it("should throw SimulationError on simulation failure during preparation", async () => {
      const mockResult = {
        _isError: true,
        error: "Contract execution failed",
      };
      mockSimulateTransaction.mockResolvedValue(mockResult);

      const sourceAccount = new Account("GSOURCE", "0");

      await expect(
        client.prepareTransaction("set_profile", sourceAccount, {
          _type: "scval",
          _val: "GUSER",
        } as any)
      ).rejects.toThrow(SimulationError);
    });
  });

  describe("buildMultiOpTx()", () => {
    it("should build a transaction with multiple operations", async () => {
      const mockResult = {
        _isSuccess: true,
        minResourceFee: "10000",
        transactionData: null,
        result: { retval: null },
      };
      mockSimulateTransaction.mockResolvedValue(mockResult);

      const sourceAccount = new Account("GSOURCE", "0");
      const ops = [
        { method: "approve", args: [{ _type: "scval", _val: "TOKEN" }] as any[] },
        { method: "pool_deposit", args: [{ _type: "scval", _val: "POOL" }] as any[] },
      ];

      const result = await client.buildMultiOpTx(sourceAccount, ops);

      expect(result).toBeDefined();
      // addOperation called twice for temp tx, twice for real tx
      expect(mockAddOperation).toHaveBeenCalledTimes(4);
    });

    it("should throw SimulationError if simulation fails", async () => {
      const mockResult = {
        _isError: true,
        error: "Operation failed",
      };
      mockSimulateTransaction.mockResolvedValue(mockResult);

      const sourceAccount = new Account("GSOURCE", "0");
      const ops = [
        { method: "approve", args: [{ _type: "scval", _val: "TOKEN" }] as any[] },
        { method: "pool_deposit", args: [{ _type: "scval", _val: "POOL" }] as any[] },
      ];

      await expect(client.buildMultiOpTx(sourceAccount, ops)).rejects.toThrow(SimulationError);
    });
  });
});
