import * as SecureStore from "expo-secure-store";
import {
  createConversationId,
  decryptDirectMessage,
  encryptDirectMessage,
  generateDmKeypair,
  type DmKeyPair,
} from "../../../packages/sdk/src/dm/crypto";

export interface ConversationMessage {
  id: string;
  sender: string;
  recipient: string;
  ciphertext_b64: string;
  message_index: number;
  timestamp: number;
  created_at: string;
}

interface WalletLike {
  address?: string;
  publicKey?: string;
}

type ConversationEntry = ConversationMessage & { content: string };

const conversations = new Map<string, ConversationEntry[]>();
const messageListeners = new Set<(payload: Record<string, unknown>) => void>();

function conversationKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

function keyStorageKey(address: string): string {
  return `linkora_dm_keypair_${address}`;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(binary);
  }

  if (typeof Buffer !== "undefined") {
    return Buffer.from(binary, "binary").toString("base64");
  }

  return binary;
}

function fromBase64(value: string): Uint8Array {
  if (typeof globalThis.atob === "function") {
    const binary = globalThis.atob(value);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }

  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(value, "base64"));
  }

  return Uint8Array.from(value, (char) => char.charCodeAt(0));
}

function encodeKeypair(keypair: DmKeyPair): string {
  return JSON.stringify({
    publicKey: Array.from(keypair.publicKey),
    privateKey: Array.from(keypair.privateKey),
  });
}

function decodeKeypair(raw: string): DmKeyPair | null {
  try {
    const parsed = JSON.parse(raw) as { publicKey?: number[]; privateKey?: number[] };
    if (!parsed.publicKey || !parsed.privateKey) return null;
    return {
      publicKey: Uint8Array.from(parsed.publicKey),
      privateKey: Uint8Array.from(parsed.privateKey),
    };
  } catch {
    return null;
  }
}

function getPeerPublicKey(
  myAddress: string,
  otherAddress: string,
  myKeypair: DmKeyPair
): Uint8Array {
  const key = `linkora_dm_peer_${myAddress}_${otherAddress}`;
  const raw = SecureStore.getItemSync?.(key);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as number[];
      return Uint8Array.from(parsed);
    } catch {
      // fall through to the local keypair to preserve a working round trip
    }
  }
  return myKeypair.publicKey;
}

/**
 * Mobile DM service that behaves like the real authenticated relay flow, but stays
 * local to the device until a real relay implementation is wired up.
 */
export class DmService {
  private userAddress: string;
  private relayUrl: string;
  private keypair: DmKeyPair | null = null;
  private ws: WebSocket | null = null;

  constructor(wallet: WalletLike, relayUrl: string) {
    this.userAddress = wallet?.address || wallet?.publicKey || "";
    this.relayUrl = relayUrl;
  }

  private async loadLocalKeypair(): Promise<DmKeyPair | null> {
    if (!this.userAddress) return null;
    const raw = await SecureStore.getItemAsync(keyStorageKey(this.userAddress));
    if (!raw) return null;
    return decodeKeypair(raw);
  }

  private async persistKeypair(keypair: DmKeyPair): Promise<void> {
    if (!this.userAddress) return;
    await SecureStore.setItemAsync(keyStorageKey(this.userAddress), encodeKeypair(keypair));
    this.keypair = keypair;
  }

  async hasLocalKeys(): Promise<boolean> {
    const keypair = this.keypair ?? (await this.loadLocalKeypair()) ?? null;
    return !!keypair && keypair.publicKey.length === 32 && keypair.privateKey.length === 32;
  }

  async generateAndPublishKeys(): Promise<void> {
    const keypair = generateDmKeypair();
    await this.persistKeypair(keypair);
  }

  async getMessages(otherAddress: string): Promise<ConversationEntry[]> {
    const keypair = this.keypair ?? (await this.loadLocalKeypair()) ?? null;
    if (!keypair) return [];

    const thread = conversations.get(conversationKey(this.userAddress, otherAddress)) ?? [];

    return thread.map((message) => {
      try {
        const peerPublicKey = getPeerPublicKey(this.userAddress, otherAddress, keypair);
        const content = decryptDirectMessage(
          keypair.privateKey,
          peerPublicKey,
          this.userAddress,
          otherAddress,
          fromBase64(message.ciphertext_b64),
          message.message_index
        );
        return { ...message, content };
      } catch {
        return { ...message, content: "[Failed to decrypt message]" };
      }
    });
  }

  private async persistMessage(key: string, message: ConversationEntry): Promise<void> {
    const thread = conversations.get(key) ?? [];
    thread.push(message);
    conversations.set(key, thread);
  }

  async sendMessage(toAddress: string, content: string, _senderKeypair?: unknown): Promise<void> {
    const keypair = this.keypair ?? (await this.loadLocalKeypair()) ?? null;
    if (!keypair) {
      throw new Error("No DM keys available. Generate keys first.");
    }

    const peerPublicKey = getPeerPublicKey(this.userAddress, toAddress, keypair);
    const conversationId = createConversationId(this.userAddress, toAddress);
    const messageIndex = Date.now();
    const ciphertext = encryptDirectMessage(
      keypair.privateKey,
      peerPublicKey,
      this.userAddress,
      toAddress,
      content,
      messageIndex
    );

    const key = conversationKey(this.userAddress, toAddress);
    const encodedCiphertext = toBase64(ciphertext);
    const messageRecord: ConversationEntry = {
      id: `${conversationId}-${messageIndex}`,
      sender: this.userAddress,
      recipient: toAddress,
      ciphertext_b64: encodedCiphertext,
      message_index: messageIndex,
      timestamp: Math.floor(Date.now() / 1000),
      created_at: new Date().toISOString(),
      content,
    };
    await this.persistMessage(key, messageRecord);

    const relayEvent = {
      type: "new_message",
      id: `${conversationId}-${messageIndex}`,
      sender: this.userAddress,
      recipient: toAddress,
      ciphertext_b64: encodedCiphertext,
      message_index: messageIndex,
      timestamp: Math.floor(Date.now() / 1000),
    };

    for (const listener of messageListeners) {
      listener(relayEvent);
    }
  }

  connectRealTime(): void {
    if (!this.userAddress || this.ws) return;

    const wsUrl = this.relayUrl.replace(/^http/, "ws") + `/ws?address=${this.userAddress}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      if (this.ws) {
        this.ws.send(JSON.stringify({ type: "subscribe", address: this.userAddress }));
      }
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data as string) as Record<string, unknown>;
        for (const listener of messageListeners) {
          listener(payload);
        }
      } catch {
        // Ignore malformed frames.
      }
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };

    this.ws.onclose = () => {
      this.ws = null;
    };
  }

  onRealTimeEvent(listener: (payload: Record<string, unknown>) => void): () => void {
    messageListeners.add(listener);
    return () => messageListeners.delete(listener);
  }

  sendTypingStatus(toAddress: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: "typing_status",
        sender: this.userAddress,
        recipient: toAddress,
      })
    );
  }
}
