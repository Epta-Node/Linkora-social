"use client";

/**
 * DM crypto helpers for apps/web.
 *
 * Re-exports the canonical X25519 + HKDF + ChaCha20-Poly1305 functions from
 * the linkora-sdk so both the web app and the SDK stay on the same wire format.
 * The webpack alias in next.config.mjs maps `linkora-sdk` → the SDK TypeScript
 * source so no pre-built dist/ is required.
 */

export {
  generateDmKeypair,
  encryptDirectMessage,
  decryptDirectMessage,
  createConversationId,
  DecryptionError,
} from "linkora-sdk";

export type { DmKeyPair } from "linkora-sdk";

// ── Browser-safe byte utilities ───────────────────────────────────────────────

export function bytesToBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
