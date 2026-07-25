/**
 * Tests for DM cryptographic functions.
 */

import {
  generateDmKeypair,
  deriveSharedSecret,
  createConversationId,
  encryptDirectMessage,
  decryptDirectMessage,
  DecryptionError
} from '../crypto';

describe('DM Crypto', () => {
  describe('generateDmKeypair', () => {
    it('should generate valid key pairs', () => {
      const keyPair = generateDmKeypair();
      
      expect(keyPair.publicKey).toHaveLength(32);
      expect(keyPair.privateKey).toHaveLength(32);
      expect(keyPair.publicKey).not.toEqual(keyPair.privateKey);
    });

    it('should generate unique key pairs', () => {
      const keyPair1 = generateDmKeypair();
      const keyPair2 = generateDmKeypair();
      
      expect(keyPair1.publicKey).not.toEqual(keyPair2.publicKey);
      expect(keyPair1.privateKey).not.toEqual(keyPair2.privateKey);
    });
  });

  describe('deriveSharedSecret', () => {
    it('should derive the same shared secret for both parties', () => {
      const alice = generateDmKeypair();
      const bob = generateDmKeypair();
      
      const aliceSecret = deriveSharedSecret(alice.privateKey, bob.publicKey);
      const bobSecret = deriveSharedSecret(bob.privateKey, alice.publicKey);
      
      expect(aliceSecret).toEqual(bobSecret);
    });

    it('should throw error for invalid key lengths', () => {
      const validKey = new Uint8Array(32);
      const invalidKey = new Uint8Array(31);
      
      expect(() => deriveSharedSecret(invalidKey, validKey))
        .toThrow('Keys must be exactly 32 bytes');
      expect(() => deriveSharedSecret(validKey, invalidKey))
        .toThrow('Keys must be exactly 32 bytes');
    });
  });

  describe('createConversationId', () => {
    it('should create the same ID regardless of address order', () => {
      const addressA = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
      const addressB = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF';
      
      const id1 = createConversationId(addressA, addressB);
      const id2 = createConversationId(addressB, addressA);
      
      expect(id1).toEqual(id2);
      expect(id1).toHaveLength(64); // SHA-256 hex string
    });

    it('should create different IDs for different address pairs', () => {
      const addressA = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
      const addressB = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF';
      const addressC = 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCWHF';
      
      const id1 = createConversationId(addressA, addressB);
      const id2 = createConversationId(addressA, addressC);
      
      expect(id1).not.toEqual(id2);
    });
  });

  describe('end-to-end encryption', () => {
    it('should encrypt and decrypt messages correctly', () => {
      const alice = generateDmKeypair();
      const bob = generateDmKeypair();
      
      const aliceAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
      const bobAddress = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF';
      
      const plaintext = 'Hello, this is a secret message!';
      const messageIndex = 1;
      
      // Alice encrypts a message to Bob
      const ciphertext = encryptDirectMessage(
        alice.privateKey,
        bob.publicKey,
        aliceAddress,
        bobAddress,
        plaintext,
        messageIndex
      );
      
      // Bob decrypts the message from Alice
      const decrypted = decryptDirectMessage(
        bob.privateKey,
        alice.publicKey,
        bobAddress,
        aliceAddress,
        ciphertext,
        messageIndex
      );
      
      expect(decrypted).toEqual(plaintext);
    });

    it('should fail to decrypt with wrong keys', () => {
      const alice = generateDmKeypair();
      const bob = generateDmKeypair();
      const eve = generateDmKeypair(); // Attacker
      
      const aliceAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
      const bobAddress = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF';
      
      const plaintext = 'Secret message';
      const messageIndex = 1;
      
      const ciphertext = encryptDirectMessage(
        alice.privateKey,
        bob.publicKey,
        aliceAddress,
        bobAddress,
        plaintext,
        messageIndex
      );
      
      // Eve tries to decrypt with her own key
      expect(() => {
        decryptDirectMessage(
          eve.privateKey,
          alice.publicKey,
          bobAddress,
          aliceAddress,
          ciphertext,
          messageIndex
        );
      }).toThrow(DecryptionError);
    });

    it('should fail to decrypt with wrong message index', () => {
      const alice = generateDmKeypair();
      const bob = generateDmKeypair();
      
      const aliceAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
      const bobAddress = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF';
      
      const plaintext = 'Secret message';
      
      const ciphertext = encryptDirectMessage(
        alice.privateKey,
        bob.publicKey,
        aliceAddress,
        bobAddress,
        plaintext,
        1 // messageIndex = 1
      );
      
      // Try to decrypt with wrong message index
      expect(() => {
        decryptDirectMessage(
          bob.privateKey,
          alice.publicKey,
          bobAddress,
          aliceAddress,
          ciphertext,
          2 // Wrong messageIndex = 2
        );
      }).toThrow(DecryptionError);
    });

    it('should produce unique ciphertexts for sequential messages', () => {
      const alice = generateDmKeypair();
      const bob = generateDmKeypair();
      
      const aliceAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
      const bobAddress = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF';
      
      const plaintext = 'Same message content';
      
      const ciphertext1 = encryptDirectMessage(
        alice.privateKey,
        bob.publicKey,
        aliceAddress,
        bobAddress,
        plaintext,
        1
      );
      
      const ciphertext2 = encryptDirectMessage(
        alice.privateKey,
        bob.publicKey,
        aliceAddress,
        bobAddress,
        plaintext,
        2
      );
      
      // Same content but different message indices should produce different ciphertexts
      expect(ciphertext1).not.toEqual(ciphertext2);
      
      // Both should decrypt correctly
      const decrypted1 = decryptDirectMessage(
        bob.privateKey,
        alice.publicKey,
        bobAddress,
        aliceAddress,
        ciphertext1,
        1
      );
      
      const decrypted2 = decryptDirectMessage(
        bob.privateKey,
        alice.publicKey,
        bobAddress,
        aliceAddress,
        ciphertext2,
        2
      );
      
      expect(decrypted1).toEqual(plaintext);
      expect(decrypted2).toEqual(plaintext);
    });

    it('should handle Unicode messages correctly', () => {
      const alice = generateDmKeypair();
      const bob = generateDmKeypair();
      
      const aliceAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
      const bobAddress = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF';
      
      const plaintext = '🔐 Hello 世界! This is a Unicode message with emojis 🚀';
      const messageIndex = 1;
      
      const ciphertext = encryptDirectMessage(
        alice.privateKey,
        bob.publicKey,
        aliceAddress,
        bobAddress,
        plaintext,
        messageIndex
      );
      
      const decrypted = decryptDirectMessage(
        bob.privateKey,
        alice.publicKey,
        bobAddress,
        aliceAddress,
        ciphertext,
        messageIndex
      );
      
      expect(decrypted).toEqual(plaintext);
    });
  });
});