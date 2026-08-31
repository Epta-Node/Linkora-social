/**
 * HTTP client for the DM relay service.
 *
 * The relay service stores and routes encrypted messages without ever having
 * access to the plaintext content. Authentication is via Stellar signatures.
 */

import { Keypair } from "@stellar/stellar-base";
import { sha256 } from "@noble/hashes/sha256";
import { fetchWithTimeout } from "../utils/fetch.js";

const DEFAULT_RELAY_TIMEOUT_MS = 30_000;

export interface RelayMessage {
  sender: string;
  recipient: string;
  ciphertext_b64: string;
  message_index: number;
  timestamp: number;
  signature: string; // Hex-encoded signature of auth data
}

export interface ConversationMessage {
  id: string;
  sender: string;
  recipient: string;
  ciphertext_b64: string;
  message_index: number;
  timestamp: number;
  created_at: string;
}

export interface SendMessageRequest {
  sender: string;
  recipient: string;
  ciphertext_b64: string;
  message_index: number;
  timestamp: number;
  signature: string;
}

export interface GetMessagesResponse {
  messages: ConversationMessage[];
  has_more: boolean;
  next_cursor?: string;
}

export class RelayAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayAuthError";
  }
}

export type ConnectionState = "connected" | "disconnected" | "reconnecting";

export type ConnectionStateCallback = (state: ConnectionState) => void;

export interface RelayClientConfig {
  /** Base URL of the relay service. */
  baseUrl: string;
  /** Timeout in ms for HTTP requests (default 30 000). */
  timeoutMs?: number;
  /** Maximum number of WebSocket reconnect attempts (default: Infinity). */
  maxReconnectAttempts?: number;
}

export class RelayClient {
  private baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxReconnectAttempts: number;
  private ws: WebSocket | null = null;
  private messageListeners: Set<(payload: Record<string, unknown>) => void> = new Set();
  private stateListeners: Set<ConnectionStateCallback> = new Set();
  private reconnectAttempts: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private wsAddress: string = "";
  private permanentlyClosed: boolean = false;
  private _connectionState: ConnectionState = "disconnected";

  constructor(config: string | RelayClientConfig) {
    if (typeof config === "string") {
      this.baseUrl = config.replace(/\/$/, "");
      this.timeoutMs = DEFAULT_RELAY_TIMEOUT_MS;
      this.maxReconnectAttempts = Infinity;
    } else {
      this.baseUrl = config.baseUrl.replace(/\/$/, "");
      this.timeoutMs = config.timeoutMs ?? DEFAULT_RELAY_TIMEOUT_MS;
      this.maxReconnectAttempts = config.maxReconnectAttempts ?? Infinity;
    }
  }

  /** Current WebSocket connection state. */
  get connectionState(): ConnectionState {
    return this._connectionState;
  }

  private setConnectionState(state: ConnectionState): void {
    if (this._connectionState === state) return;
    this._connectionState = state;
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }

  /**
   * Register a callback for WebSocket connection state changes.
   *
   * @param callback Invoked when the state transitions between
   *   "connected", "disconnected", and "reconnecting".
   * @returns Unsubscribe function.
   */
  onConnectionStateChange(callback: ConnectionStateCallback): () => void {
    this.stateListeners.add(callback);
    return () => this.stateListeners.delete(callback);
  }

  /**
   * Connect to the real-time WebSocket for pushes.
   */
  connectWs(address: string) {
    if (this.ws || this.permanentlyClosed) return;
    this.wsAddress = address;
    const wsUrl = this.baseUrl.replace(/^http/, "ws") + `/ws?address=${address}`;
    this.ws = new WebSocket(wsUrl);
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setConnectionState("connected");
    };
    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data as string);
        this.messageListeners.forEach((listener) => listener(payload));
      } catch (_e) {}
    };
    this.ws.onerror = () => {
      this.ws?.close();
    };
    this.ws.onclose = () => {
      this.ws = null;
      this.setConnectionState("disconnected");
      this.scheduleReconnect();
    };
  }

  /**
   * Permanently close the WebSocket connection and stop all reconnection attempts.
   */
  stop(): void {
    this.permanentlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setConnectionState("disconnected");
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.permanentlyClosed) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;

    this.setConnectionState("reconnecting");
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWs(this.wsAddress);
    }, delay);
  }

  onMessage(listener: (payload: Record<string, unknown>) => void) {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  sendTypingStatus(recipient: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: "typing_status",
          recipient,
        })
      );
    }
  }

  /**
   * Create an authentication signature for message submission.
   * Signs sha256(sender + timestamp) with the sender's Stellar private key.
   */
  private createAuthSignature(senderKeypair: Keypair, timestamp: number): string {
    const authData = senderKeypair.publicKey() + timestamp.toString();
    const hash = sha256(new TextEncoder().encode(authData));
    const signature = senderKeypair.sign(Buffer.from(hash));
    return Buffer.from(signature).toString("hex");
  }

  /**
   * Submit an encrypted message to the relay service.
   * Requires authentication via Stellar signature.
   */
  async sendMessage(
    senderKeypair: Keypair,
    recipient: string,
    ciphertext: Uint8Array,
    messageIndex: number,
    retryCount: number = 0,
    maxRetries: number = 3
  ): Promise<void> {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = this.createAuthSignature(senderKeypair, timestamp);
    const ciphertext_b64 = Buffer.from(ciphertext).toString("base64");

    const request: SendMessageRequest = {
      sender: senderKeypair.publicKey(),
      recipient,
      ciphertext_b64,
      message_index: messageIndex,
      timestamp,
      signature,
    };

    try {
      const response = await fetchWithTimeout(
        `${this.baseUrl}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
        },
        this.timeoutMs
      );

      if (!response.ok) {
        const error = await response.text();
        if (response.status === 401 || response.status === 403) {
          throw new RelayAuthError(`Authentication failed: ${error}`);
        }
        if (response.status >= 400 && response.status < 500) {
          throw new Error(`Relay request rejected (non-retryable): ${response.status} ${error}`);
        }
        throw new Error(`Relay request failed: ${response.status} ${error}`);
      }
    } catch (error) {
      if (error instanceof RelayAuthError) {
        throw error;
      }
      if (error instanceof Error && error.message.includes("non-retryable")) {
        throw error;
      }
      if (retryCount < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.sendMessage(
          senderKeypair,
          recipient,
          ciphertext,
          messageIndex,
          retryCount + 1,
          maxRetries
        );
      }
      throw error;
    }
  }

  /**
   * Retrieve messages for a conversation.
   * Conversation ID is deterministic based on participant addresses.
   */
  async getMessages(
    conversationId: string,
    limit: number = 50,
    cursor?: string
  ): Promise<GetMessagesResponse> {
    const params = new URLSearchParams({
      limit: limit.toString(),
    });

    if (cursor) {
      params.set("cursor", cursor);
    }

    const response = await fetchWithTimeout(
      `${this.baseUrl}/messages/${conversationId}?${params}`,
      undefined,
      this.timeoutMs
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch messages: ${response.status}`);
    }

    return (await response.json()) as GetMessagesResponse;
  }

  /**
   * Get the latest messages for a conversation (most recent first).
   */
  async getLatestMessages(
    conversationId: string,
    limit: number = 50
  ): Promise<ConversationMessage[]> {
    const response = await this.getMessages(conversationId, limit);
    return response.messages;
  }

  /**
   * Check relay service health and connectivity.
   */
  async health(): Promise<{ status: string; timestamp: number }> {
    const response = await fetchWithTimeout(`${this.baseUrl}/health`, undefined, this.timeoutMs);

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    return (await response.json()) as { status: string; timestamp: number };
  }
}

/**
 * Helper function to create a conversation ID from two addresses.
 * This must match the deterministic ID generation in crypto.ts.
 */
export function getConversationId(addressA: string, addressB: string): string {
  const sorted = [addressA, addressB].sort();
  const combined = sorted[0] + sorted[1];
  return Buffer.from(sha256(new TextEncoder().encode(combined))).toString("hex");
}

// ── Key rotation detection ───────────────────────────────────────────────────

export interface KeyRotationResult {
  /** `true` when the on-chain key differs from the cached key. */
  rotated: boolean;
  /** The current on-chain key (always present when `onChainKey` was provided). */
  currentKey: Uint8Array;
}

/**
 * Compare an on-chain X25519 public key against a previously-cached key.
 *
 * This is a pure comparison helper – it does **not** touch any storage.
 * The caller is responsible for:
 *  1. Persisting the on-chain key after a successful comparison.
 *  2. Invalidating any cached session keys when `rotated` is `true`.
 *  3. Resetting the sync cursor so messages under the new key are fetched.
 *
 * @param cachedKey  The previously-cached public key, or `null` on first sync.
 * @param onChainKey The current key fetched from the contract.
 * @returns A `KeyRotationResult` indicating whether a rotation occurred.
 */
export function detectKeyRotation(
  cachedKey: Uint8Array | null,
  onChainKey: Uint8Array
): KeyRotationResult {
  if (!cachedKey) {
    return { rotated: false, currentKey: onChainKey };
  }

  if (cachedKey.length !== onChainKey.length) {
    return { rotated: true, currentKey: onChainKey };
  }

  for (let i = 0; i < cachedKey.length; i++) {
    if (cachedKey[i] !== onChainKey[i]) {
      return { rotated: true, currentKey: onChainKey };
    }
  }

  return { rotated: false, currentKey: onChainKey };
}
