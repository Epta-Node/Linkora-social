/**
 * errorClassifier.test.ts
 *
 * Unit tests for the pure `classifyError` utility.
 * No DOM or React needed — runs in the default Node environment
 * (or jsdom as configured in jest.config.js; both work fine).
 */

import { classifyError } from "@/lib/errorClassifier";

// ---------------------------------------------------------------------------
// Network errors
// ---------------------------------------------------------------------------

describe("classifyError — network", () => {
  const NETWORK_CASES = [
    "Failed to fetch",
    "fetch error: resource not found",
    "Network request failed",
    "network error occurred",
    "Request timeout after 30s",
    "Connection refused",
    "ECONNREFUSED 127.0.0.1:3000",
    "ERR_NETWORK_CHANGED",
    "net::ERR_CONNECTION_RESET",
    "Load failed",
  ];

  test.each(NETWORK_CASES)("classifies %s as network", (msg) => {
    const err = new Error(msg);
    expect(classifyError(err)).toBe("network");
  });
});

// ---------------------------------------------------------------------------
// Contract / Web3 errors
// ---------------------------------------------------------------------------

describe("classifyError — contract", () => {
  const CONTRACT_CASES = [
    "Contract execution failed",
    "Transaction simulation error",
    "Blockchain RPC error",
    "Wallet not connected",
    "Provider not found",
    "Stellar account sequence mismatch",
    "Soroban simulation returned error",
    "Freighter extension rejected the request",
    "invoke hostfunction failed",
    "XDR deserialization error",
    "rpc server returned error",
  ];

  test.each(CONTRACT_CASES)("classifies %s as contract", (msg) => {
    const err = new Error(msg);
    expect(classifyError(err)).toBe("contract");
  });
});

// ---------------------------------------------------------------------------
// General errors (everything else)
// ---------------------------------------------------------------------------

describe("classifyError — general", () => {
  const GENERAL_CASES = [
    "Cannot read property of undefined",
    "SyntaxError: Unexpected token",
    "Maximum update depth exceeded",
    "RangeError: index out of bounds",
    "Unknown error",
    "",
  ];

  test.each(GENERAL_CASES)("classifies %s as general", (msg) => {
    const err = new Error(msg);
    expect(classifyError(err)).toBe("general");
  });
});

// ---------------------------------------------------------------------------
// Priority: network beats contract
// ---------------------------------------------------------------------------

describe("classifyError — priority", () => {
  it("returns network over contract when message matches both", () => {
    // "connection" (network) and "wallet" (contract) both present
    const err = new Error("network error: wallet provider timed out");
    expect(classifyError(err)).toBe("network");
  });
});
