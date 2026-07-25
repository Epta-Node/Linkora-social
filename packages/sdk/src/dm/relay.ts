/**
 * HTTP client for the DM relay service.
 *
 * The relay service stores and routes encrypted messages without ever having
 * access to the plaintext content. Authentication is via Stellar signatures.
 */

import { Keypair } from "@stellar/stellar-base";
import { sha256 } from "@noble/hashes/sha256";

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

export class RelayClient {
  private baseUrl: string;
  private ws: WebSocket | null = null;
  private messageListeners: Set<(payload: Record<string, unknown>) => void> = new Set();

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
  }

  /**
   * Connect to the real-time WebSocket for pushes.
   */
  connectWs(address: string) {
    if (this.ws) return;
    const wsUrl = this.baseUrl.replace(/^http/, "ws") + `/ws?address=${address}`;
    this.ws = new WebSocket(wsUrl);
    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data as string);
        this.messageListeners.forEach((listener) => listener(payload));
      } catch (_e) {}
    };
    this.ws.onclose = () => {
      this.ws = null;
    };
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
    messageIndex: number
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

    const response = await fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.text();
      if (response.status === 401) {
        throw new RelayAuthError(`Authentication failed: ${error}`);
      }
      if (response.status === 403) {
        throw new RelayAuthError(`Request rejected: ${error}`);
      }
      throw new Error(`Relay request failed: ${response.status} ${error}`);
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

    const response = await fetch(`${this.baseUrl}/messages/${conversationId}?${params}`);

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
    const response = await fetch(`${this.baseUrl}/health`);

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
