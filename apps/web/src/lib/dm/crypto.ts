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

// ── At-rest encryption for private keys ──────────────────────────────────────

/**
 * Fixed application key used as the password component in PBKDF2.
 * Combined with the user's Stellar address as the salt, this derives
 * a per-user AES-GCM wrapping key. The key itself is not secret in
 * the traditional sense — it prevents casual plaintext reads of
 * localStorage by requiring the attacker to execute the same
 * derivation + decryption flow.
 *
 * For stronger protection, a user passphrase should replace this
 * value (see issue #1520).
 */
const APP_KEY = "linkora-dm-v1";

/**
 * Derive a 256-bit AES-GCM wrapping key from the user's Stellar address.
 * Uses PBKDF2 with 100 000 iterations for CPU-bound key derivation.
 */
export async function deriveWrappingKey(stellarAddress: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(APP_KEY),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(stellarAddress),
      iterations: 100_000,
      hash: "SHA-256",
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt plaintext bytes with AES-GCM. Returns base64-encoded
 * IV ‖ ciphertext.
 */
export async function encryptAesGcm(key: CryptoKey, plaintext: Uint8Array): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  // Narrowing copy: ensures the buffer is a plain ArrayBuffer (not SharedArrayBuffer),
  // satisfying the BufferSource constraint introduced by the TS 5.7 Uint8Array generic.
  const plaintextBuf: Uint8Array<ArrayBuffer> = new Uint8Array(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintextBuf);
  // Pack IV + ciphertext into a single base64 blob
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return bytesToBase64(combined);
}

/**
 * Decrypt a base64-encoded IV ‖ ciphertext blob with AES-GCM.
 */
export async function decryptAesGcm(key: CryptoKey, encryptedB64: string): Promise<Uint8Array> {
  const combined = base64ToBytes(encryptedB64);
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new Uint8Array(plaintext);
}
