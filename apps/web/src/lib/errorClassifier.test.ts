import {
  classifyError,
  getErrorMessage,
  simulationMessage,
  networkMessage,
  validationMessage,
} from "@/lib/errorClassifier";
import {
  SimulationError,
  ContractErrorCode,
  NetworkError,
  InvalidInputError,
  ValidationError,
} from "linkora-sdk";

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

  it("classifies SimulationError as contract", () => {
    const err = new SimulationError("Simulation failed");
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

// ---------------------------------------------------------------------------
// SimulationError handling & message mapping (issue #1192)
// ---------------------------------------------------------------------------

describe("SimulationError handling", () => {
  test("SimulationError with no hostError surfaces raw error string", () => {
    const err = new SimulationError(
      "Simulation failed",
      undefined,
      undefined,
      "Insufficient funds for gas fee"
    );
    expect(simulationMessage(err)).toBe("Insufficient funds for gas fee");
    expect(getErrorMessage(err)).toBe("Insufficient funds for gas fee");
  });

  test.each([
    ["ARITH_COUNT", "An arithmetic calculation error occurred during contract execution."],
    ["MEM_LIMIT_EXCEEDED", "Transaction memory limit exceeded during contract execution."],
    ["CONTRACT_RECURSION", "Contract execution exceeded maximum recursion depth."],
  ])("SimulationError with hostError '%s' maps to friendly trap message", (trapCode, expectedMsg) => {
    const err = new SimulationError("Simulation failed", undefined, undefined, "raw error", trapCode);
    expect(simulationMessage(err)).toBe(expectedMsg);
    expect(getErrorMessage(err)).toBe(expectedMsg);
  });

  const CONTRACT_ERROR_CASES: [string | ContractErrorCode, string][] = [
    [ContractErrorCode.AlreadyInitialized, "Contract is already initialized."],
    ["AlreadyInitialized", "Contract is already initialized."],
    [ContractErrorCode.UsernameTaken, "That username is already taken. Please choose another."],
    ["UsernameTaken", "That username is already taken. Please choose another."],
    [ContractErrorCode.UsernameTooLong, "Username exceeds the maximum allowed length."],
    ["UsernameTooLong", "Username exceeds the maximum allowed length."],
    [ContractErrorCode.NotAdmin, "Admin authorization is required for this operation."],
    ["NotAdmin", "Admin authorization is required for this operation."],
    [ContractErrorCode.OnlyAuthor, "Only the original author can perform this operation."],
    ["OnlyAuthor", "Only the original author can perform this operation."],
    [ContractErrorCode.Blocked, "Operation rejected because the user is blocked."],
    ["Blocked", "Operation rejected because the user is blocked."],
    [
      ContractErrorCode.InsufficientAllowance,
      "Insufficient token allowance. Please approve the required allowance.",
    ],
    [
      "InsufficientAllowance",
      "Insufficient token allowance. Please approve the required allowance.",
    ],
    [
      ContractErrorCode.InsufficientBalance,
      "Insufficient token or account balance to complete this transaction.",
    ],
    [
      "InsufficientBalance",
      "Insufficient token or account balance to complete this transaction.",
    ],
    [
      ContractErrorCode.CooldownActive,
      "Tipping cooldown period is active. Please wait before trying again.",
    ],
    [
      "CooldownActive",
      "Tipping cooldown period is active. Please wait before trying again.",
    ],
    [ContractErrorCode.NotFound, "The requested resource or record was not found."],
    ["NotFound", "The requested resource or record was not found."],
    [ContractErrorCode.PostTooLong, "Post content exceeds the maximum allowed length."],
    ["PostTooLong", "Post content exceeds the maximum allowed length."],
    [ContractErrorCode.InvalidInput, "Invalid input parameter provided."],
    ["InvalidInput", "Invalid input parameter provided."],
    [ContractErrorCode.SimulationFailed, "Contract transaction simulation failed."],
    ["SimulationFailed", "Contract transaction simulation failed."],
  ];

  test.each(CONTRACT_ERROR_CASES)(
    "SimulationError with hostError '%s' maps to friendly ContractError message",
    (variant, expectedMsg) => {
      const err = new SimulationError("Simulation failed", undefined, undefined, "raw error", String(variant));
      expect(simulationMessage(err)).toBe(expectedMsg);
      expect(getErrorMessage(err)).toBe(expectedMsg);
    }
  );

  test("SimulationError with an unrecognized/unknown hostError falls back to raw error string", () => {
    const err = new SimulationError(
      "Simulation error message",
      undefined,
      undefined,
      "Contract trapped with code 0x99",
      "UNKNOWN_HOST_TRAP_99"
    );
    expect(simulationMessage(err)).toBe("Contract trapped with code 0x99");
    expect(getErrorMessage(err)).toBe("Contract trapped with code 0x99");
    expect(getErrorMessage(err)).not.toBe("Something went wrong");
  });
});

// ---------------------------------------------------------------------------
// NetworkError and ValidationError / InvalidInputError handling
// ---------------------------------------------------------------------------

describe("getErrorMessage — NetworkError & ValidationError", () => {
  it("formats NetworkError correctly", () => {
    const err = new NetworkError("Connection refused by peer");
    expect(networkMessage(err)).toBe("Connection refused by peer");
    expect(getErrorMessage(err)).toBe("Connection refused by peer");
  });

  it("formats ValidationError and InvalidInputError correctly", () => {
    const valErr = new ValidationError("Username too short");
    expect(validationMessage(valErr)).toBe("Username too short");
    expect(getErrorMessage(valErr)).toBe("Username too short");

    const invErr = new InvalidInputError("Invalid address format");
    expect(validationMessage(invErr)).toBe("Invalid address format");
    expect(getErrorMessage(invErr)).toBe("Invalid address format");
  });

  it("falls back to generic message for generic unknown error", () => {
    expect(getErrorMessage(new Error("Custom runtime error"))).toBe("Custom runtime error");
    expect(getErrorMessage("Non-error primitive")).toBe("Something went wrong");
  });
});
