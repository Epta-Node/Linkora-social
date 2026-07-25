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

function conversationKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

/**
 * In-memory mock of the direct-message service. Messages are not persisted or
 * encrypted; they only live for the lifetime of the app session.
 */
export class DmService {
  private userAddress: string;

  constructor(wallet: WalletLike, _relayUrl: string) {
    this.userAddress = wallet?.address || wallet?.publicKey || "";
  }

  async hasLocalKeys(): Promise<boolean> {
    return true;
  }

  async generateAndPublishKeys(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
  }

  async getMessages(otherAddress: string): Promise<ConversationEntry[]> {
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    return conversations.get(conversationKey(this.userAddress, otherAddress)) ?? [];
  }

  async sendMessage(toAddress: string, content: string): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    const key = conversationKey(this.userAddress, toAddress);
    const thread = conversations.get(key) ?? [];
    const index = thread.length;
    thread.push({
      id: `${key}-${index}`,
      sender: this.userAddress,
      recipient: toAddress,
      ciphertext_b64: "",
      message_index: index,
      timestamp: Math.floor(Date.now() / 1000),
      created_at: new Date().toISOString(),
      content,
    });
    conversations.set(key, thread);
  }

  connectRealTime(): void {
    // No real-time transport in mock mode.
  }

  onRealTimeEvent(_listener: (payload: Record<string, unknown>) => void): () => void {
    return () => {};
  }

  sendTypingStatus(_toAddress: string): void {
    // No-op in mock mode.
  }
}
