/**
 * errorClassifier.ts
 *
 * Classifies an Error into one of three display categories so the
 * ErrorBoundary can show a contextual, user-friendly message.
 *
 * Rules are intentionally kept simple: we inspect only the error's
 * `message` and `name` strings so that classification stays fast,
 * deterministic, and easy to extend.
 */

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

/**
 * Returns the display category for a given Error.
 *
 * Matching priority: network > contract > general.
 */
export function classifyError(error: Error): ErrorCategory {
  const haystack = `${error.name} ${error.message}`;

  if (NETWORK_PATTERNS.some((re) => re.test(haystack))) {
    return "network";
  }

  if (CONTRACT_PATTERNS.some((re) => re.test(haystack))) {
    return "contract";
  }

  return "general";
}
