"use client";

/**
 * localStorage persistence for the user's X25519 DM keypair.
 *
 * Keys are namespaced per Freighter wallet address so multiple accounts on
 * the same browser remain isolated.  Mobile counterpart uses expo-secure-store.
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

// ── Public API ────────────────────────────────────────────────────────────────

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
