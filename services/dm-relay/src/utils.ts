/**
 * Utility functions for the DM relay service.
 */

import { sha256 } from '@noble/hashes/sha256';

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
 * Sanitize error messages for API responses.
 */
export function sanitizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Unknown error occurred';
}

/**
 * Generate a unique request ID for logging.
 */
export function generateRequestId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
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