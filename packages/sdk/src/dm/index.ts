/**
 * End-to-end encrypted direct messages for Linkora.
 * 
 * This module provides cryptographic functions and relay client for secure
 * direct messaging without central key management.
 */

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