/**
 * Cryptographic functions for end-to-end encrypted direct messages.
 * 
 * Uses X25519 Diffie-Hellman key agreement, HKDF key derivation, and ChaCha20-Poly1305 AEAD.
 * This provides secure end-to-end encryption without relying on central key servers.
 */

import { x25519 } from '@noble/curves/ed25519';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { chacha20poly1305 } from '@noble/ciphers/chacha';

export interface DmKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/**
 * DecryptionError is thrown when message decryption fails due to invalid
 * authentication tag, corrupted ciphertext, or wrong key.
 */
export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecryptionError';
  }
}

/**
 * Generate a new X25519 key pair for DM encryption.
 * These keys are separate from Stellar signing keys for security reasons.
 */
export function generateDmKeypair(): DmKeyPair {
  const privateKey = x25519.utils.randomPrivateKey();
  const publicKey = x25519.getPublicKey(privateKey);
  
  return {
    publicKey,
    privateKey
  };
}

/**
 * Derive a shared secret from local private key and remote public key using X25519.
 * Then use HKDF to derive a symmetric encryption key for the conversation.
 */
export function deriveSharedSecret(myPrivateKey: Uint8Array, theirPublicKey: Uint8Array): Uint8Array {
  if (myPrivateKey.length !== 32 || theirPublicKey.length !== 32) {
    throw new Error('Keys must be exactly 32 bytes');
  }

  // X25519 key agreement
  const sharedSecret = x25519.getSharedSecret(myPrivateKey, theirPublicKey);

  // For HKDF info string, we need the conversation ID
  // This will be provided by the caller since it needs both addresses
  return sharedSecret;
}

/**
 * Derive the conversation-specific encryption key using HKDF.
 * Conversation ID should be deterministic based on participant addresses.
 */
export function deriveConversationKey(sharedSecret: Uint8Array, conversationId: string): Uint8Array {
  const info = new TextEncoder().encode(`linkora-dm-v1:${conversationId}`);
  
  // Use HKDF to derive 32-byte key for ChaCha20-Poly1305
  return hkdf(sha256, sharedSecret, undefined, info, 32);
}

/**
 * Create a deterministic conversation ID from two Stellar addresses.
 * Uses lexicographic ordering to ensure the same ID regardless of who initiates.
 */
export function createConversationId(addressA: string, addressB: string): string {
  const sorted = [addressA, addressB].sort();
  const combined = sorted[0] + sorted[1];
  return Buffer.from(sha256(new TextEncoder().encode(combined))).toString('hex');
}

/**
 * Derive a unique nonce for a message using HKDF.
 * This prevents nonce reuse while being deterministic.
 */
export function deriveNonce(conversationKey: Uint8Array, messageIndex: number): Uint8Array {
  const info = new TextEncoder().encode(`nonce:${messageIndex}`);
  
  // ChaCha20-Poly1305 uses 12-byte nonces
  return hkdf(sha256, conversationKey, undefined, info, 12);
}

/**
 * Encrypt a message using ChaCha20-Poly1305 AEAD.
 */
export function encryptMessage(
  sharedSecret: Uint8Array, 
  plaintext: string, 
  conversationId: string,
  messageIndex: number
): Uint8Array {
  const conversationKey = deriveConversationKey(sharedSecret, conversationId);
  const nonce = deriveNonce(conversationKey, messageIndex);
  const plaintextBytes = new TextEncoder().encode(plaintext);
  
  const cipher = chacha20poly1305(conversationKey, nonce);
  return cipher.encrypt(plaintextBytes);
}

/**
 * Decrypt a message using ChaCha20-Poly1305 AEAD.
 * Throws DecryptionError if authentication fails.
 */
export function decryptMessage(
  sharedSecret: Uint8Array, 
  ciphertext: Uint8Array, 
  conversationId: string,
  messageIndex: number
): string {
  try {
    const conversationKey = deriveConversationKey(sharedSecret, conversationId);
    const nonce = deriveNonce(conversationKey, messageIndex);
    
    const cipher = chacha20poly1305(conversationKey, nonce);
    const plaintextBytes = cipher.decrypt(ciphertext);
    
    return new TextDecoder().decode(plaintextBytes);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new DecryptionError(`Failed to decrypt message: ${errorMessage}`);
  }
}

/**
 * High-level function to encrypt a message between two users.
 * Handles conversation ID creation and shared secret derivation.
 */
export function encryptDirectMessage(
  myPrivateKey: Uint8Array,
  theirPublicKey: Uint8Array,
  myAddress: string,
  theirAddress: string,
  plaintext: string,
  messageIndex: number
): Uint8Array {
  const sharedSecret = deriveSharedSecret(myPrivateKey, theirPublicKey);
  const conversationId = createConversationId(myAddress, theirAddress);
  
  return encryptMessage(sharedSecret, plaintext, conversationId, messageIndex);
}

/**
 * High-level function to decrypt a message between two users.
 * Handles conversation ID creation and shared secret derivation.
 */
export function decryptDirectMessage(
  myPrivateKey: Uint8Array,
  theirPublicKey: Uint8Array,
  myAddress: string,
  theirAddress: string,
  ciphertext: Uint8Array,
  messageIndex: number
): string {
  const sharedSecret = deriveSharedSecret(myPrivateKey, theirPublicKey);
  const conversationId = createConversationId(myAddress, theirAddress);
  
  return decryptMessage(sharedSecret, ciphertext, conversationId, messageIndex);
}