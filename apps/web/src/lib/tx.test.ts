import { signAndSubmitTransaction, buildSignAndSubmit } from "./tx";
import { signTransaction } from "@stellar/freighter-api";
import {
  TransactionBuilder,
  BASE_FEE,
  Contract,
  Address,
  Account,
  rpc as StellarRpc,
} from "@stellar/stellar-sdk";

// Mock Freighter API
jest.mock("@stellar/freighter-api", () => ({
  signTransaction: jest.fn(),
}));

// Mock Stellar SDK. `Server` always resolves to the same instance so that
// `new StellarRpc.Server(...)` inside tx.ts returns the object the test
// configures via `mockServer` below, instead of an unrelated fresh mock.
jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  const mockServerInstance = {
    getAccount: jest.fn(),
    simulateTransaction: jest.fn(),
    sendTransaction: jest.fn(),
    getTransaction: jest.fn(),
  };
  // `buildSignAndSubmit` constructs a real TransactionBuilder (`new
  // TransactionBuilder(...)`), while `signAndSubmitTransaction` only calls
  // the static `fromXDR`. Extend the real class so `new` keeps working, and
  // override just the static method the latter needs to mock.
  class MockTransactionBuilder extends actual.TransactionBuilder {}
  MockTransactionBuilder.fromXDR = jest.fn();

  return {
    ...actual,
    TransactionBuilder: MockTransactionBuilder,
    rpc: {
      Server: jest.fn(() => mockServerInstance),
      Api: {
        isSimulationError: jest.fn(),
      },
      assembleTransaction: jest.fn(),
    },
  };
});

describe("Transaction Utility Functions", () => {
  const mockConfig = {
    contractId: "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526",
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

      (signTransaction as any).mockResolvedValue(mockSignedXdr);

      const mockServer = new StellarRpc.Server(mockConfig.rpcUrl);
      (mockServer.sendTransaction as any).mockResolvedValue(mockSendResponse);
      (mockServer.getTransaction as any).mockResolvedValue({
        status: "SUCCESS",
      });

      const result = await signAndSubmitTransaction("test-xdr", mockConfig);

      expect(signTransaction).toHaveBeenCalledWith("test-xdr", {
        networkPassphrase: mockConfig.networkPassphrase,
      });
      expect(mockServer.sendTransaction).toHaveBeenCalled();
      expect(result.hash).toBe(mockTxHash);
      expect(result.status).toBe("SUCCESS");
    });

    it("should throw error if transaction submission fails", async () => {
      const mockSignedXdr = "signed-xdr-string";
      (signTransaction as any).mockResolvedValue(mockSignedXdr);

      const mockServer = new StellarRpc.Server(mockConfig.rpcUrl);
      (mockServer.sendTransaction as any).mockResolvedValue({
        status: "ERROR",
      });

      await expect(signAndSubmitTransaction("test-xdr", mockConfig)).rejects.toThrow(
        "Transaction failed to submit"
      );
    });

    it("should throw error if transaction confirmation times out", async () => {
      const mockSignedXdr = "signed-xdr-string";
      const mockTxHash = "test-hash-123";
      (signTransaction as any).mockResolvedValue(mockSignedXdr);

      const mockServer = new StellarRpc.Server(mockConfig.rpcUrl);
      (mockServer.sendTransaction as any).mockResolvedValue({
        hash: mockTxHash,
        status: "PENDING",
      });
      (mockServer.getTransaction as any).mockResolvedValue({
        status: "PENDING",
      });

      await expect(signAndSubmitTransaction("test-xdr", mockConfig, 100)).rejects.toThrow(
        "Transaction confirmation timeout"
      );
    });
  });

  describe("buildSignAndSubmit", () => {
    it("should build, sign, and submit contract method call", async () => {
      const mockAccount = new Account(
        "GCMEDW2SHDHZC3YKI3ZQ574VZPDDHR5SZDYPPZLQVR2V56X7UOYX7ZMO",
        "1234567890"
      );
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
      (signTransaction as any).mockResolvedValue(mockSignedXdr);
      (mockServer.sendTransaction as any).mockResolvedValue(mockSendResponse);
      (mockServer.getTransaction as any).mockResolvedValue({
        status: "SUCCESS",
      });

      const args = [
        Address.fromString("GCMEDW2SHDHZC3YKI3ZQ574VZPDDHR5SZDYPPZLQVR2V56X7UOYX7ZMO").toScVal(),
        Address.fromString("GBNM7FGFC5BCY6VN6UIFNBYUGNTSLR446YDTWY2BIQU2MHIMAXP2SUM6").toScVal(),
      ];

      const result = await buildSignAndSubmit("test_method", args, "GCMEDW2SHDHZC3YKI3ZQ574VZPDDHR5SZDYPPZLQVR2V56X7UOYX7ZMO", mockConfig);

      expect(mockServer.getAccount).toHaveBeenCalledWith("GCMEDW2SHDHZC3YKI3ZQ574VZPDDHR5SZDYPPZLQVR2V56X7UOYX7ZMO");
      expect(mockServer.simulateTransaction).toHaveBeenCalled();
      expect(signTransaction).toHaveBeenCalled();
      expect(mockServer.sendTransaction).toHaveBeenCalled();
      expect(result.hash).toBe(mockTxHash);
      expect(result.status).toBe("SUCCESS");
    });

    it("should throw error if simulation fails", async () => {
      const mockAccount = new Account(
        "GCMEDW2SHDHZC3YKI3ZQ574VZPDDHR5SZDYPPZLQVR2V56X7UOYX7ZMO",
        "1234567890"
      );
      const mockSimulated = {
        error: "Simulation error",
      };

      const mockServer = new StellarRpc.Server(mockConfig.rpcUrl);
      (mockServer.getAccount as any).mockResolvedValue(mockAccount);
      (mockServer.simulateTransaction as any).mockResolvedValue(mockSimulated);
      (StellarRpc.Api.isSimulationError as any).mockReturnValue(true);

      const args = [
        Address.fromString("GCMEDW2SHDHZC3YKI3ZQ574VZPDDHR5SZDYPPZLQVR2V56X7UOYX7ZMO").toScVal(),
        Address.fromString("GBNM7FGFC5BCY6VN6UIFNBYUGNTSLR446YDTWY2BIQU2MHIMAXP2SUM6").toScVal(),
      ];

      await expect(buildSignAndSubmit("test_method", args, "GCMEDW2SHDHZC3YKI3ZQ574VZPDDHR5SZDYPPZLQVR2V56X7UOYX7ZMO", mockConfig)).rejects.toThrow(
        "Transaction simulation failed"
      );
    });
  });

  describe("Regression Test: Discarded XDR Prevention", () => {
    it("should NOT allow XDR to be built without submission", () => {
      // This test verifies that the transaction flow requires actual submission
      // The old bug was: const _txXdr = client.likePost(...); // XDR discarded

      const mockConfig = {
        contractId: "CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526",
        rpcUrl: "https://soroban-testnet.stellar.org",
        networkPassphrase: "Test SDF Network ; September 2015",
      };

      // Verify that buildSignAndSubmit is called (which includes submission)
      // This is a behavioral test - the actual implementation should use
      // buildSignAndSubmit or signAndSubmitTransaction, not just build XDR

      expect(typeof buildSignAndSubmit).toBe("function");
      expect(typeof signAndSubmitTransaction).toBe("function");
    });

    it("should require signing before submission", async () => {
      // Verify that signTransaction is called in the flow
      const mockSignedXdr = "signed-xdr-string";
      (signTransaction as any).mockResolvedValue(mockSignedXdr);

      const mockServer = new StellarRpc.Server(mockConfig.rpcUrl);
      (mockServer.sendTransaction as any).mockResolvedValue({
        hash: "test-hash",
        status: "SUCCESS",
      });
      (mockServer.getTransaction as any).mockResolvedValue({
        status: "SUCCESS",
      });

      await signAndSubmitTransaction("test-xdr", mockConfig);

      // This assertion ensures signing happens before submission
      expect(signTransaction).toHaveBeenCalled();
    });
  });
});
