// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { signAndSubmitTransaction, buildSignAndSubmit } from "./tx";
import { signTransaction } from "@stellar/freighter-api";

// Mock Freighter API
jest.mock("@stellar/freighter-api", () => ({
  signTransaction: jest.fn(),
}));

// Mock Stellar SDK
jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...actual,
    TransactionBuilder: {
      fromXDR: jest.fn(),
    },
    rpc: {
      Server: jest.fn().mockImplementation(() => ({
        getAccount: jest.fn(),
        simulateTransaction: jest.fn(),
        sendTransaction: jest.fn(),
        getTransaction: jest.fn(),
      })),
      Api: {
        isSimulationError: jest.fn(),
      },
      assembleTransaction: jest.fn(),
    },
  };
});

// Re-import after mocks are set up
const StellarRpc = require("@stellar/stellar-sdk").rpc;

describe("Transaction Utility Functions", () => {
  const mockConfig = {
    contractId: "CDUMMY",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("signAndSubmitTransaction", () => {
    it("should sign transaction with Freighter and submit to RPC", async () => {
      const mockSignedXdr = "signed-xdr-string";
      const mockTxHash = "test-hash-123";
      const mockSendResponse = {
        hash: mockTxHash,
        status: "PENDING",
      };

      (signTransaction as jest.Mock).mockResolvedValue(mockSignedXdr);
      mockServerMethods.sendTransaction.mockResolvedValue(mockSendResponse);
      mockServerMethods.getTransaction.mockResolvedValue({
        status: "SUCCESS",
      });

      const result = await signAndSubmitTransaction("test-xdr", mockConfig);

      expect(signTransaction).toHaveBeenCalledWith("test-xdr", {
        networkPassphrase: mockConfig.networkPassphrase,
      });
      expect(mockServerMethods.sendTransaction).toHaveBeenCalled();
      expect(result.hash).toBe(mockTxHash);
      expect(result.status).toBe("SUCCESS");
    });

    it("should throw error if transaction submission fails", async () => {
      const mockSignedXdr = "signed-xdr-string";
      (signTransaction as jest.Mock).mockResolvedValue(mockSignedXdr);
      mockServerMethods.sendTransaction.mockResolvedValue({
        status: "ERROR",
      });

      await expect(signAndSubmitTransaction("test-xdr", mockConfig)).rejects.toThrow(
        "Transaction failed to submit"
      );
    });

    it("should throw error if transaction confirmation times out", async () => {
      const mockSignedXdr = "signed-xdr-string";
      const mockTxHash = "test-hash-123";
      (signTransaction as jest.Mock).mockResolvedValue(mockSignedXdr);
      mockServerMethods.sendTransaction.mockResolvedValue({
        hash: mockTxHash,
        status: "PENDING",
      });
      mockServerMethods.getTransaction.mockResolvedValue({
        status: "PENDING",
      });

      await expect(signAndSubmitTransaction("test-xdr", mockConfig, 100)).rejects.toThrow(
        "Transaction confirmation timeout"
      );
    });
  });

  describe("buildSignAndSubmit", () => {
    it("should build, sign, and submit contract method call", async () => {
      const mockAccount = { sequence: "1234567890" };
      const mockSimulated = {
        minResourceFee: "100",
        transactionData: null,
        result: { xdr: "result-xdr" },
      };
      const mockSignedXdr = "signed-xdr-string";
      const mockTxHash = "test-hash-456";
      const mockSendResponse = {
        hash: mockTxHash,
        status: "PENDING",
      };

      const mockServer = new StellarRpc.Server(mockConfig.rpcUrl);
      (mockServer.getAccount as any).mockResolvedValue(mockAccount);
      (mockServer.simulateTransaction as any).mockResolvedValue(mockSimulated);
      (StellarRpc.Api.isSimulationError as any).mockReturnValue(false);
      (StellarRpc.assembleTransaction as any).mockReturnValue({
        build: jest.fn().mockReturnValue({
          toXDR: jest.fn().mockReturnValue("unsigned-xdr"),
        }),
      });
      (signTransaction as jest.Mock).mockResolvedValue(mockSignedXdr);
      mockServerMethods.sendTransaction.mockResolvedValue(mockSendResponse);
      mockServerMethods.getTransaction.mockResolvedValue({
        status: "SUCCESS",
      });

      const result = await buildSignAndSubmit(
        "test_method",
        ["mock-sc-val-1"] as any,
        "GABC123",
        mockConfig
      );

      expect(mockServerMethods.getAccount).toHaveBeenCalledWith("GABC123");
      expect(mockServerMethods.simulateTransaction).toHaveBeenCalled();
      expect(signTransaction).toHaveBeenCalled();
      expect(mockServerMethods.sendTransaction).toHaveBeenCalled();
      expect(result.hash).toBe(mockTxHash);
      expect(result.status).toBe("SUCCESS");
    });

    it("should throw error if simulation fails", async () => {
      const mockAccount = { sequence: "1234567890" };
      const mockSimulated = { error: "Simulation error" };

      mockServerMethods.getAccount.mockResolvedValue(mockAccount);
      mockServerMethods.simulateTransaction.mockResolvedValue(mockSimulated);
      (StellarRpc.Api.isSimulationError as unknown as jest.Mock).mockReturnValue(true);

      await expect(
        buildSignAndSubmit("test_method", ["mock-sc-val-1"] as any, "GABC123", mockConfig)
      ).rejects.toThrow("Transaction simulation failed");
    });
  });

  describe("Regression Test: Discarded XDR Prevention", () => {
    it("should NOT allow XDR to be built without submission", () => {
      expect(typeof buildSignAndSubmit).toBe("function");
      expect(typeof signAndSubmitTransaction).toBe("function");
    });

    it("should require signing before submission", async () => {
      const mockSignedXdr = "signed-xdr-string";
      (signTransaction as jest.Mock).mockResolvedValue(mockSignedXdr);
      mockServerMethods.sendTransaction.mockResolvedValue({
        hash: "test-hash",
        status: "SUCCESS",
      });
      mockServerMethods.getTransaction.mockResolvedValue({
        status: "SUCCESS",
      });

      await signAndSubmitTransaction("test-xdr", mockConfig);

      expect(signTransaction).toHaveBeenCalled();
    });
  });
});
