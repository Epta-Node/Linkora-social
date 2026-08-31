/**
 * Utility functions for the DM relay service.
 */

import { sha256 } from '@noble/hashes/sha256';
import { randomUUID } from 'crypto';

/**
 * Create a deterministic conversation ID from two Stellar addresses.
 * Must match the implementation in the SDK crypto module.
 */
export function createConversationId(addressA: string, addressB: string): string {
  const sorted = [addressA, addressB].sort();
  const combined = sorted[0] + sorted[1];
  const hash = sha256(new TextEncoder().encode(combined));
  return Buffer.from(hash).toString('hex');
}

/**
 * Create a rate limiting key for an address.
 */
export function getRateLimitKey(address: string): string {
  return `rate_limit:${address}`;
}

/**
 * Patterns that indicate an error message contains internal details that must
 * never be surfaced to API consumers.
 *
 * Covers common PostgreSQL error prefixes, connection-string fragments, and
 * file-system paths.
 */
const INTERNAL_PATTERNS: RegExp[] = [
  // SQL / database errors
  /\bpg\b/i,
  /\bpostgres(ql)?\b/i,
  /\bsyntax error\b/i,
  /\brelation\b.*\bdoes not exist\b/i,
  /\bcolumn\b.*\bdoes not exist\b/i,
  /\bduplicate key\b/i,
  /\bforeign key\b/i,
  /\bviolates\b/i,
  /\bunexpected token\b/i,
  // Connection strings
  /postgres(ql)?:\/\//i,
  /mongodb(\+srv)?:\/\//i,
  /mysql:\/\//i,
  /redis:\/\//i,
  // File-system paths
  /\/[a-z0-9_\-/.]+\.(ts|js|json|env|sql)\b/i,
  /^[A-Za-z]:\\/,
  // Stack-trace fragments
  /\bat\s+\w+\s*\(/,
];

/**
 * Known, safe error prefixes that may be forwarded to API consumers.
 *
 * These come from controlled code paths (validation, auth) and do not contain
 * internal implementation details.
 */
const SAFE_PREFIXES: string[] = [
  'Invalid sender',
  'Invalid recipient',
  'Invalid signature',
  'Signature verification failed',
  'Timestamp',
  'Authentication',
  'Validation',
  'Invalid cursor',
  'Message index',
  'already exists',
];

/**
 * Return true when the error message contains patterns that could leak
 * internal details (SQL errors, connection strings, file paths, etc.).
 */
function containsInternalDetail(message: string): boolean {
  return INTERNAL_PATTERNS.some((re) => re.test(message));
}

/**
 * Return true when the message originates from a known, safe code path and
 * may be forwarded to the API consumer as-is.
 */
function isSafeMessage(message: string): boolean {
  return SAFE_PREFIXES.some((prefix) => message.startsWith(prefix));
}

/**
 * Sanitize an error for inclusion in an API response.
 *
 * - Known, safe error messages (validation, auth) are returned verbatim.
 * - Any message that contains SQL errors, connection strings, file paths, or
 *   stack-trace fragments is replaced with a generic string.
 * - Everything else that is not explicitly recognised as safe is also replaced
 *   with the generic string (fail-closed policy).
 */
export function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    const { message } = error;

    // Hard block: never expose messages containing internal details.
    if (containsInternalDetail(message)) {
      return 'Internal server error';
    }

    // Allow-list: only forward messages from known-safe code paths.
    if (isSafeMessage(message)) {
      return message;
    }

    // Everything else is considered internal.
    return 'Internal server error';
  }

  return 'Internal server error';
}

/**
 * Generate a unique request ID for logging.
 */
export function generateRequestId(): string {
  return randomUUID();
}

/**
 * Check if a string is a valid base64 encoding.
 */
export function isValidBase64(str: string): boolean {
  try {
    return btoa(atob(str)) === str;
  } catch (err) {
    return false;
  }
}