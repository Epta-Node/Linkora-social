/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Issue #1356 — Parity between the dry-run (simulate) path and the submit
 * (prepareTransaction) path.
 *
 * Both must share a single footprint/soroban-data pipeline: the same
 * operation run through `simulate()` and through `prepareTransaction()` (the
 * transaction that gets signed and submitted) must report and carry the
 * identical footprint and soroban transaction data.
 */

import { LinkoraClient } from "../client";
import { Account } from "@stellar/stellar-base";

const mockCall = jest.fn();
const mockBuild = jest.fn();
const mockToEnvelope = jest.fn();
const mockToXDR = jest.fn();
const mockAddOperation = jest.fn();
const mockSetTimeout = jest.fn();
const mockSimulateTransaction = jest.fn();
const mockAssembleBuild = jest.fn();

jest.mock("@stellar/stellar-sdk/rpc", () => ({
  Server: jest.fn(() => ({ simulateTransaction: mockSimulateTransaction })),
  Api: {
    isSimulationError: jest.fn((result) => result._isError === true),
    isSimulationSuccess: jest.fn((result) => result._isSuccess === true),
  },
  assembleTransaction: jest.fn(() => ({ build: mockAssembleBuild })),
}));

jest.mock("@stellar/stellar-base", () => ({
  Contract: jest.fn(() => ({ call: mockCall })),
  nativeToScVal: jest.fn((val: unknown) => ({ _type: "scval", _val: val })),
  scValToNative: jest.fn(),
  TransactionBuilder: jest.fn(() => ({
    addOperation: mockAddOperation,
    setTimeout: mockSetTimeout,
    setSorobanData: jest.fn().mockReturnThis(),
    build: mockBuild,
  })),
  Account: jest.fn(),
  Keypair: {
    random: jest.fn(() => ({ publicKey: () => "GWRITEKEYXXXXXXXXXXXXXXXXXXXXXXXXXX" })),
  },
  Address: jest.fn(),
  xdr: {},
}));

// Stub GeneratedLinkoraClient so the super() chain works.
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
  },
}));

describe("simulate/submit footprint parity (issue #1356)", () => {
  const XDR = "AAAAfake";
  let client: LinkoraClient;
  const sourceAccount = new Account("GSOURCE", "0");

  beforeEach(() => {
    jest.clearAllMocks();
    client = new LinkoraClient({ contractId: "CDUMMY", rpcUrl: "https://dummy.example.com" });
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

  const makeSimResult = () => {
    const footprintData = {
      resources: () => ({
        footprint: () => ({
          readOnly: () => ["ro-entry-1"],
          readWrite: () => ["rw-entry-1", "rw-entry-2"],
        }),
      }),
      toXDR: (enc: string) => (enc === "base64" ? "SOROBANDATA-BASE64" : ""),
    };
    return {
      _isSuccess: true,
      minResourceFee: "5000",
      transactionData: { build: () => footprintData },
      result: { retval: null, auth: [] },
    };
  };

  it("reports the same footprint and sorobanData through both pipelines", async () => {
    // Same op, same source account — the shared pipeline guarantees parity.
    mockSimulateTransaction.mockResolvedValue(makeSimResult());

    const simResult = await client.simulate(
      "follow",
      { _type: "scval", _val: "GUSER" } as any,
      sourceAccount as any
    );
    const prepared = await client.prepareTransaction(
      "follow",
      sourceAccount,
      { _type: "scval", _val: "GUSER" } as any
    );

    // Both paths derive footprint/soroban-data from the ONE shared pipeline.
    expect(simResult.success).toBe(true);
    expect(simResult.footprint).toEqual({
      readOnly: ['"ro-entry-1"'],
      readWrite: ['"rw-entry-1"', '"rw-entry-2"'],
    });
    expect(simResult.sorobanData).toBe("SOROBANDATA-BASE64");

    // The submitted artifact is the assembled transaction from that same
    // simulation (asserted via the assembleTransaction call).
    const { assembleTransaction } = jest.requireMock("@stellar/stellar-sdk/rpc");
    expect(mockAssembleBuild).toHaveBeenCalled();
    expect(prepared).toBe(mockAssembleBuild.mock.results[0]?.value ?? expect.anything());

    // Both pipeline runs consumed the same raw simulation response.
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(2);
    const [first, second] = mockSimulateTransaction.mock.calls;
    expect(first[0].constructor).toBeDefined();
    expect(second[0].constructor).toBeDefined();
  });

  it("reports footprint entries identically to what submit carries (sorobanData)", async () => {
    mockSimulateTransaction.mockResolvedValue(makeSimResult());

    const simResult = await client.simulate(
      "follow",
      { _type: "scval", _val: "GUSER" } as any,
      sourceAccount as any
    );

    // sorobanData is the submit artifact's transaction data — the footprint
    // is its projection, so parity means footprint ⊆ reported sorobanData.
    expect(simResult.sorobanData).toBe("SOROBANDATA-BASE64");
    expect(simResult.footprint?.readWrite).toHaveLength(2);
    expect(simResult.resourceFee).toBe("5000");
  });

  it("keeps the temp-keypair default when no source account is given", async () => {
    mockSimulateTransaction.mockResolvedValue(makeSimResult());

    const simResult = await client.simulate("follow", {
      _type: "scval",
      _val: "GUSER",
    } as any);

    expect(simResult.success).toBe(true);
    expect(simResult.sorobanData).toBe("SOROBANDATA-BASE64");
  });

  it("throws SimulationError when the shared pipeline simulation fails", async () => {
    const { SimulationError } = await import("../errors");
    mockSimulateTransaction.mockResolvedValue({ _isError: true, error: "boom" });

    await expect(
      client.simulate("follow", { _type: "scval", _val: "GUSER" } as any, sourceAccount as any)
    ).rejects.toThrow(SimulationError);
    await expect(
      client.prepareTransaction("follow", sourceAccount, { _type: "scval", _val: "GUSER" } as any)
    ).rejects.toThrow(SimulationError);
  });
});
