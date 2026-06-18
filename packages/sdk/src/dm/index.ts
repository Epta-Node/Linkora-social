/**
 * End-to-end encrypted direct messages for Linkora.
 * 
 * This module provides cryptographic functions and relay client for secure
 * direct messaging without central key management.
 */

import { LinkoraClient } from '../client';
import { 
  generateDmKeypair, 
  deriveSharedSecret, 
  encryptDirectMessage, 
  decryptDirectMessage,
  type DmKeyPair 
} from './crypto';
import { 
  RelayClient, 
  type ConversationMessage,
  type RelayMessage 
} from './relay';

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

  constructor(wallet: any, relayUrl: string) {
    // Create a minimal client config for contract interaction
    this.client = new LinkoraClient({
      networkPassphrase: wallet?.networkPassphrase || 'Test SDF Network ; September 2015',
      rpcUrl: wallet?.rpcUrl || 'https://soroban-testnet.stellar.org',
      contractId: process.env.NEXT_PUBLIC_CONTRACT_ID || ''
    });
    this.relayClient = new RelayClient(relayUrl, wallet);
    this.userAddress = wallet?.address || wallet?.publicKey || '';
  }

  async hasLocalKeys(): Promise<boolean> {
    // Check if keys are stored locally (implementation depends on storage mechanism)
    return this.keypair !== null || typeof localStorage !== 'undefined' && localStorage.getItem('dm_keypair') !== null;
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

    // Store keys locally
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('dm_keypair', JSON.stringify({
        publicKey: Array.from(this.keypair.publicKey),
        privateKey: Array.from(this.keypair.privateKey)
      }));
    }
  }

  async getMessages(otherAddress: string): Promise<Array<ConversationMessage & { content: string }>> {
    try {
      const response = await this.relayClient.getMessages(otherAddress);
      
      if (!this.keypair) {
        // Try to load from localStorage
        if (typeof localStorage !== 'undefined') {
          const stored = localStorage.getItem('dm_keypair');
          if (stored) {
            const parsed = JSON.parse(stored);
            this.keypair = {
              publicKey: new Uint8Array(parsed.publicKey),
              privateKey: new Uint8Array(parsed.privateKey)
            };
          }
        }
      }

      if (!this.keypair) {
        throw new Error('No DM keys available. Generate keys first.');
      }

      // Get the other user's public key for decryption
      const otherPubKey = await this.client.getDmKey(otherAddress);

      if (!otherPubKey) {
        throw new Error('Cannot decrypt messages: other user has not published DM keys');
      }

      // Decrypt messages
      return response.messages.map(msg => {
        try {
          const content = decryptDirectMessage(
            msg.ciphertext_b64,
            this.keypair!.privateKey,
            otherPubKey
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
      // Try to load from localStorage
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('dm_keypair');
        if (stored) {
          const parsed = JSON.parse(stored);
          this.keypair = {
            publicKey: new Uint8Array(parsed.publicKey),
            privateKey: new Uint8Array(parsed.privateKey)
          };
        }
      }
    }

    if (!this.keypair) {
      throw new Error('No DM keys available. Generate keys first.');
    }

    // Get recipient's public key from contract
    const recipientPubKey = await this.client.getDmKey(toAddress);

    if (!recipientPubKey) {
      throw new Error('Recipient has not published DM keys');
    }

    // Encrypt message
    const encrypted = encryptDirectMessage(
      content,
      this.keypair.privateKey,
      recipientPubKey
    );

    // Send via relay
    await this.relayClient.sendMessage(toAddress, encrypted);
  }
}