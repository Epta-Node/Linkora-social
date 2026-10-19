import { LinkoraClient } from "../client.js";
import * as rpc from "@stellar/stellar-sdk/rpc";

const mockSimulate = jest.fn();

jest.mock("@stellar/stellar-sdk/rpc", () => {
  const original = jest.requireActual("@stellar/stellar-sdk/rpc");
  return {
    ...original,
    Server: jest.fn().mockImplementation(() => ({
      simulateTransaction: mockSimulate,
    })),
  };
});

describe("Issue #1360: SDK request batching and single rpc.Server reuse", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("reuses a single rpc.Server instance across calls", () => {
    const client = new LinkoraClient({
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      rpcUrl: "https://rpc.example.com",
    });

    const server1 = client.rpcServer;
    const server2 = client.rpcServer;

    expect(server1).toBe(server2);
    expect(rpc.Server).toHaveBeenCalledTimes(1);
  });

  it("executes batchSimulate in a single multi-op simulation RPC roundtrip", async () => {
    const client = new LinkoraClient({
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      rpcUrl: "https://rpc.example.com",
    });

    mockSimulate.mockResolvedValueOnce({
      result: [
        { retval: { _type: "scval", _val: "val1" } },
        { retval: { _type: "scval", _val: "val2" } },
      ],
    });

    const results = await client.batchSimulate([
      { method: "get_profile", args: [] },
      { method: "get_post", args: [] },
    ]);

    expect(mockSimulate).toHaveBeenCalledTimes(1);
    expect(results.length).toBe(2);
  });
});
