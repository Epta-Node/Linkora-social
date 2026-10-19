/**
 * usePoolContract.test.ts
 *
 * Verifies the pool contract hooks submit real transactions through the shared
 * SDK sign + submit flow instead of the former setTimeout-based mocks:
 *   1. Deposits run the SEP-41 allowance step, then pool_deposit, returning the
 *      real on-chain hash and ending in "success".
 *   2. Withdrawals / pool creation return the real hash.
 *   3. Failures roll back to the "error" state.
 */

import { renderHook, act } from "@testing-library/react";
import { useDeposit, useWithdraw, useCreatePool } from "@/hooks/usePoolContract";

const REAL_HASH = "c0f1d2e3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d";

const mockPreparePoolDepositTx = jest.fn();
const mockPreparePoolWithdrawTx = jest.fn();
const mockPrepareCreatePoolTx = jest.fn();
const mockPrepareIncreaseAllowanceTx = jest.fn();
const mockCreateRpcServer = jest.fn();
const mockQueueRun = jest.fn();
const mockQueueEnqueue = jest.fn();
const mockQueueOn = jest.fn();
let submittedHashes: string[] = [];

jest.mock("linkora-sdk", () => ({
  LinkoraClient: jest.fn().mockImplementation(() => ({
    preparePoolDepositTx: mockPreparePoolDepositTx,
    preparePoolWithdrawTx: mockPreparePoolWithdrawTx,
    prepareCreatePoolTx: mockPrepareCreatePoolTx,
    prepareIncreaseAllowanceTx: mockPrepareIncreaseAllowanceTx,
    createRpcServer: mockCreateRpcServer,
  })),
  TransactionQueue: jest.fn().mockImplementation(() => ({
    on: mockQueueOn,
    enqueue: mockQueueEnqueue,
    run: mockQueueRun,
    get submittedHashes() {
      return submittedHashes;
    },
  })),
}));

jest.mock("@/config", () => ({
  config: {
    sorobanRpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  },
}));

function mockSuccess() {
  submittedHashes = [REAL_HASH];
  mockQueueRun.mockResolvedValue(undefined);
}

function mockFailure() {
  submittedHashes = [];
  mockQueueRun.mockRejectedValue(new Error("user rejected signature"));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPreparePoolDepositTx.mockResolvedValue("DEPOSIT_XDR");
  mockPreparePoolWithdrawTx.mockResolvedValue("WITHDRAW_XDR");
  mockPrepareCreatePoolTx.mockResolvedValue("CREATE_XDR");
  mockPrepareIncreaseAllowanceTx.mockResolvedValue("ALLOWANCE_XDR");
  mockCreateRpcServer.mockReturnValue({});
  mockSuccess();
});

describe("useDeposit", () => {
  it("runs the allowance step then pool_deposit and returns the real hash", async () => {
    const { result } = renderHook(() => useDeposit());

    await act(async () => {
      await result.current.deposit("GDEPOSITOR", "pool-1", "GTOKEN", "10", 7, "CPOOL");
    });

    expect(mockPrepareIncreaseAllowanceTx).toHaveBeenCalledWith(
      "GDEPOSITOR",
      "GTOKEN",
      "CPOOL",
      expect.any(BigInt)
    );
    expect(mockPreparePoolDepositTx).toHaveBeenCalledWith(
      "GDEPOSITOR",
      "pool-1",
      "GTOKEN",
      expect.any(BigInt)
    );
    expect(mockQueueEnqueue).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe("success");
    expect(result.current.result).toEqual({ hash: REAL_HASH });
    expect(result.current.error).toBeNull();
  });

  it("rolls back to error when submission fails", async () => {
    mockFailure();
    const { result } = renderHook(() => useDeposit());

    await act(async () => {
      await result.current.deposit("GDEPOSITOR", "pool-1", "GTOKEN", "10", 7, "CPOOL");
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Transaction rejected by wallet");
    expect(result.current.result).toBeNull();
  });
});

describe("useWithdraw", () => {
  it("submits pool_withdraw and returns the real hash", async () => {
    const { result } = renderHook(() => useWithdraw());

    await act(async () => {
      await result.current.withdraw(["GADMIN1", "GADMIN2"], "pool-1", "5", 7, "GRECIPIENT");
    });

    expect(mockPreparePoolWithdrawTx).toHaveBeenCalledWith(
      ["GADMIN1", "GADMIN2"],
      "pool-1",
      expect.any(BigInt),
      "GRECIPIENT"
    );
    expect(result.current.status).toBe("success");
    expect(result.current.result).toEqual({ hash: REAL_HASH });
  });

  it("rolls back to error on failure", async () => {
    mockFailure();
    const { result } = renderHook(() => useWithdraw());

    await act(async () => {
      await result.current.withdraw(["GADMIN1"], "pool-1", "5", 7, "GRECIPIENT");
    });

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Transaction rejected by wallet");
  });
});

describe("useCreatePool", () => {
  it("submits create_pool and returns the real hash", async () => {
    const { result } = renderHook(() => useCreatePool());

    await act(async () => {
      await result.current.createPool("GADMIN", "pool-1", "GTOKEN", ["GADMIN"], 1);
    });

    expect(mockPrepareCreatePoolTx).toHaveBeenCalledWith(
      "GADMIN",
      "pool-1",
      "GTOKEN",
      ["GADMIN"],
      1
    );
    expect(result.current.status).toBe("success");
    expect(result.current.result).toEqual({ hash: REAL_HASH });
  });

  it("rolls back to error on failure", async () => {
    mockFailure();
    const { result } = renderHook(() => useCreatePool());

    await act(async () => {
      await result.current.createPool("GADMIN", "pool-1", "GTOKEN", ["GADMIN"], 1);
    });

    expect(result.current.status).toBe("error");
  });
});
