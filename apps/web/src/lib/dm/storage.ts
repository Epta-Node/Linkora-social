"use client";

/**
 * localStorage persistence for the user's X25519 DM keypair.
 *
 * Keys are namespaced per Freighter wallet address so multiple accounts on
 * the same browser remain isolated.  Mobile counterpart uses expo-secure-store.
 *
 * This module also tracks the last-published on-chain key and caches derived
 * session keys so that a key rotation by either party can be detected and
 * handled without requiring a manual reconnect.
 */

import type { DmKeyPair } from "linkora-sdk";
import { bytesToBase64, base64ToBytes } from "./crypto";

const PREFIX = "linkora_dm_";

function pubKey(addr: string) {
  return `${PREFIX}x25519_pub_${addr}`;
}
function privKey(addr: string) {
  return `${PREFIX}x25519_priv_${addr}`;
}
function publishedKey(addr: string) {
  return `${PREFIX}published_key_${addr}`;
}
function syncCursorKey(addr: string) {
  return `${PREFIX}sync_cursor_${addr}`;
}
function sessionCacheKey(addr: string, peer: string) {
  return `${PREFIX}session_${addr}_${peer}`;
}

// ── Keypair persistence ──────────────────────────────────────────────────────

export function hasDmKeypair(address: string): boolean {
  if (typeof window === "undefined") return false;
  return (
    localStorage.getItem(pubKey(address)) !== null &&
    localStorage.getItem(privKey(address)) !== null
  );
}

export function storeDmKeypair(address: string, keypair: DmKeyPair): void {
  localStorage.setItem(pubKey(address), bytesToBase64(keypair.publicKey));
  localStorage.setItem(privKey(address), bytesToBase64(keypair.privateKey));
}

export function loadDmKeypair(address: string): DmKeyPair | null {
  const pub = localStorage.getItem(pubKey(address));
  const priv = localStorage.getItem(privKey(address));
  if (!pub || !priv) return null;
  return {
    publicKey: base64ToBytes(pub),
    privateKey: base64ToBytes(priv),
  };
}

export function clearDmKeypair(address: string): void {
  localStorage.removeItem(pubKey(address));
  localStorage.removeItem(privKey(address));
}

// ── On-chain key tracking ────────────────────────────────────────────────────

/**
 * Store the last-published X25519 public key (as base64) that was submitted
 * on-chain via publish_dm_key.  Used to detect rotations.
 */
export function storePublishedKey(address: string, key: Uint8Array): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(publishedKey(address), bytesToBase64(key));
}

/**
 * Load the previously-cached on-chain public key.
 * Returns null if no key has been cached yet (first sync).
 */
export function loadPublishedKey(address: string): Uint8Array | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(publishedKey(address));
  return raw ? base64ToBytes(raw) : null;
}

// ── Key rotation detection ───────────────────────────────────────────────────

/**
 * Compare the current on-chain public key (`onChainKey`) against the locally
 * cached published key.  Returns `true` when a rotation has occurred.
 *
 * A rotation is detected when:
 *  - A cached key exists AND
 *  - The on-chain key differs from the cached key.
 *
 * If no cached key exists this is a first-time sync and no rotation is flagged.
 */
export function hasKeyRotated(address: string, onChainKey: Uint8Array): boolean {
  const cached = loadPublishedKey(address);
  if (!cached) return false;
  if (cached.length !== onChainKey.length) return true;
  for (let i = 0; i < cached.length; i++) {
    if (cached[i] !== onChainKey[i]) return true;
  }
  return false;
}

/**
 * Mark that a rotation has been observed by updating the cached published key
 * to the new on-chain value.  Must be called after `hasKeyRotated` returns true
 * and the session keys have been invalidated.
 */
export function recordKeyRotation(address: string, newKey: Uint8Array): void {
  storePublishedKey(address, newKey);
}

// ── Session key cache ────────────────────────────────────────────────────────

export interface CachedSessionKey {
  /** Base64-encoded shared secret derived via X25519. */
  sharedSecretB64: string;
  /** ISO-8601 timestamp of when the key was cached. */
  cachedAt: string;
}

/**
 * Cache a derived shared secret for a conversation.  The caller should derive
 * the shared secret using X25519(myPriv, theirPub) and pass it in.
 */
export function storeSessionKey(
  address: string,
  peerAddress: string,
  sharedSecret: Uint8Array
): void {
  if (typeof window === "undefined") return;
  const entry: CachedSessionKey = {
    sharedSecretB64: bytesToBase64(sharedSecret),
    cachedAt: new Date().toISOString(),
  };
  localStorage.setItem(sessionCacheKey(address, peerAddress), JSON.stringify(entry));
}

/**
 * Load a previously-cached shared secret for a conversation.
 * Returns null if no session key is cached.
 */
export function loadSessionKey(address: string, peerAddress: string): Uint8Array | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(sessionCacheKey(address, peerAddress));
  if (!raw) return null;
  try {
    const entry: CachedSessionKey = JSON.parse(raw);
    return base64ToBytes(entry.sharedSecretB64);
  } catch {
    return null;
  }
}

/**
 * Invalidate all cached session keys for the given address.
 * Called when a key rotation is detected (own or peer) so that conversation
 * keys are re-derived from the new X25519 key agreement.
 *
 * Also bumps the sync cursor to 0 so the next fetch re-downloads messages
 * encrypted under the new key.
 */
export function invalidateAllSessionKeys(address: string): void {
  if (typeof window === "undefined") return;

  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(`${PREFIX}session_${address}_`)) {
      keysToRemove.push(k);
    }
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k));

  // Reset sync cursor so messages under the new key are fetched
  localStorage.removeItem(syncCursorKey(address));
}

/**
 * Invalidate the cached session key for a single conversation.
 */
export function invalidateSessionKey(address: string, peerAddress: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(sessionCacheKey(address, peerAddress));
}

// ── Sync cursor ──────────────────────────────────────────────────────────────

/**
 * Store the last-synced sequence number / cursor so we only fetch new messages.
 */
export function storeSyncCursor(address: string, cursor: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(syncCursorKey(address), cursor);
}

/**
 * Load the last-synced cursor.  Returns null on first sync.
 */
export function loadSyncCursor(address: string): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(syncCursorKey(address));
}
