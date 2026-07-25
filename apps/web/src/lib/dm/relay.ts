"use client";

/**
 * HTTP client for the Linkora DM relay service.
 *
 * The relay is transport-only: stores and routes encrypted blobs without
 * ever seeing plaintext.  Authentication uses Stellar Ed25519 signatures so
 * the relay can prove the sender is who they claim to be.
 *
 * Auth scheme (mirrors services/dm-relay/auth.ts):
 *   hash      = SHA-256(sender_stellar_address + unix_timestamp_seconds)
 *   signature = Ed25519_sign(freighter_private_key, hash)  — via Freighter signBlob
 *   sent as hex string in the JSON body
 */

import { bytesToHex, bytesToBase64, base64ToBytes, createConversationId } from "./crypto";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RelayMessage {
  id: string;
  sender: string;
  recipient: string;
  ciphertext_b64: string;
  message_index: number;
  timestamp: number;
  created_at: string;
}

// ── Config ────────────────────────────────────────────────────────────────────

const RELAY_URL =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_DM_RELAY_URL) ||
  "http://localhost:3001";

// ── Internal helpers ──────────────────────────────────────────────────────────

async function sha256Web(data: Uint8Array): Promise<Uint8Array> {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
}

/**
 * Signs SHA-256(sender + timestamp) with the user's Freighter key and
 * returns the 64-byte Ed25519 signature as a hex string.
 *
 * Freighter v2 exposes signBlob(base64Data, opts) which signs raw bytes with
 * the wallet's Ed25519 private key and returns a base64-encoded signature.
 */
async function buildAuthSignature(senderAddress: string, timestamp: number): Promise<string> {
  const hash = await sha256Web(new TextEncoder().encode(senderAddress + String(timestamp)));

  const { signBlob } = await import("@stellar/freighter-api");
  const signBlobFn = signBlob as (
    payload: string,
    options: { accountToSign: string }
  ) => Promise<string>;
  const sigBase64 = await signBlobFn(bytesToBase64(hash), {
    accountToSign: senderAddress,
  });

  return bytesToHex(base64ToBytes(sigBase64));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Submit an encrypted message to the relay.
 * The caller is responsible for encrypting `ciphertext` before calling this.
 */
export async function sendRelayMessage(
  senderAddress: string,
  recipientAddress: string,
  ciphertext: Uint8Array,
  messageIndex: number
): Promise<void> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await buildAuthSignature(senderAddress, timestamp);

  const res = await fetch(`${RELAY_URL}/api/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: senderAddress,
      recipient: recipientAddress,
      ciphertext_b64: bytesToBase64(ciphertext),
      message_index: messageIndex,
      timestamp,
      signature,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Relay send failed (${res.status}): ${detail}`);
  }
}

/**
 * Fetch all messages for the conversation between myAddress and theirAddress.
 * The conversation ID is derived from sorted addresses, matching the relay
 * server's own computation in services/dm-relay/routes.ts.
 */
export async function fetchRelayMessages(
  myAddress: string,
  theirAddress: string,
  limit = 50
): Promise<RelayMessage[]> {
  const conversationId = createConversationId(myAddress, theirAddress);
  const params = new URLSearchParams({ limit: String(limit) });

  const res = await fetch(`${RELAY_URL}/api/messages/${conversationId}?${params}`);

  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Relay fetch failed (${res.status}): ${detail}`);
  }

  const data: { messages: RelayMessage[]; has_more: boolean } = await res.json();
  return data.messages ?? [];
}

// ── WebSocket & Typing Indicator ──────────────────────────────────────────────

let ws: WebSocket | null = null;
const messageListeners = new Set<(payload: any) => void>();

export function connectRelayWs(address: string) {
  if (ws) return;
  const wsUrl = RELAY_URL.replace(/^http/, "ws") + `/ws?address=${address}`;
  ws = new WebSocket(wsUrl);
  
  ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      messageListeners.forEach((listener) => listener(payload));
    } catch (e) {}
  };
  
  ws.onclose = () => {
    ws = null;
  };
}

export function onRelayMessage(listener: (payload: any) => void) {
  messageListeners.add(listener);
  return () => {
    messageListeners.delete(listener);
  };
}

export function sendTypingStatus(recipient: string) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: "typing_status",
      recipient
    }));
  }
}

