/**
 * End-to-end encrypted direct messages for Linkora.
 * 
 * This module provides cryptographic functions and relay client for secure
 * direct messaging without central key management.
 */

import { LinkoraClient } from '../client';
import { Keypair } from '@stellar/stellar-sdk';
import { 
  generateDmKeypair, 
  encryptDirectMessage, 
  decryptDirectMessage,
  type DmKeyPair 
} from './crypto';
import { 
  RelayClient, 
  type ConversationMessage
} from './relay';

interface WalletLike {
  networkPassphrase?: string;
  rpcUrl?: string;
  address?: string;
  publicKey?: string;
}

export {
  generateDmKeypair,
  deriveSharedSecret,
  deriveConversationKey,
  createConversationId,
  deriveNonce,
  encryptMessage,
  decryptMessage,
  encryptDirectMessage,
  decryptDirectMessage,
  DecryptionError,
  type DmKeyPair
} from './crypto';

export {
  RelayClient,
  RelayAuthError,
  getConversationId,
  type RelayMessage,
  type ConversationMessage,
  type SendMessageRequest,
  type GetMessagesResponse
} from './relay';

/**
 * High-level DM service that combines contract interaction, encryption, and relay communication
 */
export class DmService {
  private client: LinkoraClient;
  private relayClient: RelayClient;
  private keypair: DmKeyPair | null = null;
  private userAddress: string;
  private wallet: WalletLike;

  constructor(wallet: WalletLike, relayUrl: string) {
    // Create a minimal client config for contract interaction
    this.client = new LinkoraClient({
      networkPassphrase: wallet?.networkPassphrase || 'Test SDF Network ; September 2015',
      rpcUrl: wallet?.rpcUrl || 'https://soroban-testnet.stellar.org',
      contractId: process.env.NEXT_PUBLIC_CONTRACT_ID || ''
    });
    this.relayClient = new RelayClient(relayUrl);
    this.userAddress = wallet?.address || wallet?.publicKey || '';
    this.wallet = wallet;
  }

  async hasLocalKeys(): Promise<boolean> {
    // Check if keys are stored in memory
    return this.keypair !== null;
  }

  async generateAndPublishKeys(): Promise<void> {
    this.keypair = generateDmKeypair();
    
    // Publish public key to contract - this returns a transaction XDR string
    const txXdr = this.client.publishDmKey(
      this.userAddress,
      this.keypair.publicKey
    );
    
    // Note: In a real implementation, you'd need to sign and submit this transaction
    console.log('Transaction XDR for publishing DM key:', txXdr);

    // Store keys in memory (real app should persist securely)
    // The application layer should handle secure storage based on the environment
  }

  async getMessages(otherAddress: string): Promise<Array<ConversationMessage & { content: string }>> {
    try {
      const response = await this.relayClient.getMessages(otherAddress);
      
      if (!this.keypair) {
        throw new Error('No DM keys available. Generate keys first.');
      }

      // Get the other user's public key for decryption
      const otherPubKey = await this.client.getDmKey(otherAddress);

      if (!otherPubKey) {
        throw new Error('Cannot decrypt messages: other user has not published DM keys');
      }

      // Decrypt messages
      return response.messages.map((msg) => {
        try {
          const content = decryptDirectMessage(
            this.keypair!.privateKey,
            otherPubKey,
            this.userAddress,
            otherAddress,
            Uint8Array.from(atob(msg.ciphertext_b64), c => c.charCodeAt(0)),
            msg.message_index
          );
          return { ...msg, content };
        } catch (error) {
          console.error('Failed to decrypt message:', error);
          return { ...msg, content: '[Failed to decrypt message]' };
        }
      });
    } catch (error) {
      console.error('Failed to get messages:', error);
      return [];
    }
  }

  async sendMessage(toAddress: string, content: string): Promise<void> {
    if (!this.keypair) {
      throw new Error('No DM keys available. Generate keys first.');
    }

    // Get recipient's public key from contract
    const recipientPubKey = await this.client.getDmKey(toAddress);

    if (!recipientPubKey) {
      throw new Error('Recipient has not published DM keys');
    }

    // For now, use a simple incrementing message index - in a real implementation,
    // this should be managed more carefully to prevent replay attacks
    const messageIndex = Date.now();

    // Encrypt message
    const encrypted = encryptDirectMessage(
      this.keypair.privateKey,
      recipientPubKey,
      this.userAddress,
      toAddress,
      content,
      messageIndex
    );

    // Create a keypair for signing (this is a simplified approach)
    // In a real implementation, you'd get this from the wallet
    const signingKeypair = Keypair.random(); // This needs to be the user's actual signing keypair

    // Send via relay
    await this.relayClient.sendMessage(signingKeypair, toAddress, encrypted, messageIndex);
  }
}