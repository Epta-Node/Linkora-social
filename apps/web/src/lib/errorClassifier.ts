import {
  SimulationError,
  ContractErrorCode,
  NetworkError,
  InvalidInputError,
  ValidationError,
} from "linkora-sdk";

export type ErrorCategory = "network" | "contract" | "general";

/** Keywords that indicate a network / connectivity problem. */
const NETWORK_PATTERNS: RegExp[] = [
  /fetch/i,
  /network/i,
  /timeout/i,
  /connection/i,
  /ECONNREFUSED/,
  /failed to fetch/i,
  /ERR_NETWORK/i,
  /net::ERR_/i,
  /load failed/i,
];

/**
 * Keywords that indicate a blockchain / contract / wallet problem.
 * We check for Stellar / Soroban / Freighter terminology as well as
 * generic Web3 terms so the boundary works for any future chain.
 */
const CONTRACT_PATTERNS: RegExp[] = [
  /contract/i,
  /transaction/i,
  /blockchain/i,
  /wallet/i,
  /provider/i,
  /stellar/i,
  /soroban/i,
  /freighter/i,
  /simulation/i,
  /invoke/i,
  /XDR/i,
  /rpc/i,
  /account sequence/i,
];

/** Mappings for Soroban host error trap codes. */
const TRAP_MAPPINGS: Record<string, string> = {
  ARITH_COUNT: "An arithmetic calculation error occurred during contract execution.",
  MEM_LIMIT_EXCEEDED: "Transaction memory limit exceeded during contract execution.",
  CONTRACT_RECURSION: "Contract execution exceeded maximum recursion depth.",
};

/** Mappings for Linkora ContractErrorCode variants. */
const CONTRACT_ERROR_MAPPINGS: Record<string | number, string> = {
  [ContractErrorCode.AlreadyInitialized]: "Contract is already initialized.",
  AlreadyInitialized: "Contract is already initialized.",

  [ContractErrorCode.UsernameTaken]: "That username is already taken. Please choose another.",
  UsernameTaken: "That username is already taken. Please choose another.",

  [ContractErrorCode.UsernameTooLong]: "Username exceeds the maximum allowed length.",
  UsernameTooLong: "Username exceeds the maximum allowed length.",

  [ContractErrorCode.NotAdmin]: "Admin authorization is required for this operation.",
  NotAdmin: "Admin authorization is required for this operation.",

  [ContractErrorCode.OnlyAuthor]: "Only the original author can perform this operation.",
  OnlyAuthor: "Only the original author can perform this operation.",

  [ContractErrorCode.Blocked]: "Operation rejected because the user is blocked.",
  Blocked: "Operation rejected because the user is blocked.",

  [ContractErrorCode.InsufficientAllowance]:
    "Insufficient token allowance. Please approve the required allowance.",
  InsufficientAllowance:
    "Insufficient token allowance. Please approve the required allowance.",

  [ContractErrorCode.InsufficientBalance]:
    "Insufficient token or account balance to complete this transaction.",
  InsufficientBalance:
    "Insufficient token or account balance to complete this transaction.",

  [ContractErrorCode.CooldownActive]:
    "Tipping cooldown period is active. Please wait before trying again.",
  CooldownActive:
    "Tipping cooldown period is active. Please wait before trying again.",

  [ContractErrorCode.NotFound]: "The requested resource or record was not found.",
  NotFound: "The requested resource or record was not found.",

  [ContractErrorCode.PostTooLong]: "Post content exceeds the maximum allowed length.",
  PostTooLong: "Post content exceeds the maximum allowed length.",

  [ContractErrorCode.InvalidInput]: "Invalid input parameter provided.",
  InvalidInput: "Invalid input parameter provided.",

  [ContractErrorCode.SimulationFailed]: "Contract transaction simulation failed.",
  SimulationFailed: "Contract transaction simulation failed.",
};

/**
 * Returns a human-readable message for a SimulationError.
 * Prefers mapped hostError messages over raw error strings.
 * Falls back to raw `error` string if hostError is unmapped or absent.
 */
export function simulationMessage(error: SimulationError): string {
  const hostErr = error.hostError;

  if (hostErr !== undefined && hostErr !== null) {
    const key = String(hostErr).trim();
    if (TRAP_MAPPINGS[key]) {
      return TRAP_MAPPINGS[key];
    }
    if (CONTRACT_ERROR_MAPPINGS[key]) {
      return CONTRACT_ERROR_MAPPINGS[key];
    }
    const numKey = Number(key);
    if (!isNaN(numKey) && CONTRACT_ERROR_MAPPINGS[numKey]) {
      return CONTRACT_ERROR_MAPPINGS[numKey];
    }
  }

  const rawError = error.error || error.message;
  return rawError || "Transaction simulation failed.";
}

export function networkMessage(error: NetworkError): string {
  return error.message || "A network error occurred. Please check your connection.";
}

export function validationMessage(error: ValidationError | InvalidInputError): string {
  return error.message || "Invalid input provided.";
}

/**
 * Maps any thrown error to a user-facing error message string.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof SimulationError) {
    return simulationMessage(error);
  }
  if (error instanceof NetworkError) {
    return networkMessage(error);
  }
  if (error instanceof ValidationError || error instanceof InvalidInputError) {
    return validationMessage(error);
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Something went wrong";
}

/**
 * Returns the display category for a given Error.
 *
 * Matching priority: SimulationError -> network > contract > general.
 */
export function classifyError(error: Error): ErrorCategory {
  if (error instanceof SimulationError) {
    return "contract";
  }

  const haystack = `${error.name} ${error.message}`;

  if (NETWORK_PATTERNS.some((re) => re.test(haystack))) {
    return "network";
  }

  if (CONTRACT_PATTERNS.some((re) => re.test(haystack))) {
    return "contract";
  }

  return "general";
}
