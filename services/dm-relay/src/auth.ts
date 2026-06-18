/**
 * Authentication utilities for DM relay service.
 * 
 * Verifies Stellar signatures to prevent unauthorized message submission.
 */

import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { sha256 } from '@noble/hashes/sha256';

export interface AuthData {
  sender: string;
  timestamp: number;
  signature: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class AuthService {
  private readonly maxTimestampSkew: number;
  private readonly stellarNetwork: string;

  constructor(maxTimestampSkew: number = 30, stellarNetwork: string = 'Testnet') {
    this.maxTimestampSkew = maxTimestampSkew;
    this.stellarNetwork = stellarNetwork;
  }

  /**
   * Verify that a message submission is authentically signed by the sender.
   * 
   * @param authData - Authentication data from the request
   * @returns true if authentication is valid
   * @throws AuthError if authentication fails
   */
  verifyMessageAuth(authData: AuthData): boolean {
    const { sender, timestamp, signature } = authData;

    // Validate Stellar address format
    if (!StrKey.isValidEd25519PublicKey(sender)) {
      throw new AuthError('Invalid sender address format');
    }

    // Check timestamp freshness (prevent replay attacks)
    const now = Math.floor(Date.now() / 1000);
    const timestampSkew = Math.abs(now - timestamp);
    
    if (timestampSkew > this.maxTimestampSkew) {
      throw new AuthError(`Timestamp too old or too far in future. Skew: ${timestampSkew}s, max: ${this.maxTimestampSkew}s`);
    }

    // Verify signature
    try {
      const isValid = this.verifySignature(sender, timestamp, signature);
      if (!isValid) {
        throw new AuthError('Invalid signature');
      }
      return true;
    } catch (error) {
      if (error instanceof AuthError) {
        throw error;
      }
      throw new AuthError(`Signature verification failed: ${error}`);
    }
  }

  /**
   * Verify the Stellar signature for the authentication data.
   */
  private verifySignature(sender: string, timestamp: number, signatureHex: string): boolean {
    // Recreate the signed data: sha256(sender + timestamp)
    const authMessage = sender + timestamp.toString();
    const hash = sha256(new TextEncoder().encode(authMessage));

    // Parse signature from hex
    const signature = Buffer.from(signatureHex, 'hex');
    if (signature.length !== 64) {
      throw new AuthError('Invalid signature length');
    }

    // Create keypair from public key and verify
    const keypair = Keypair.fromPublicKey(sender);
    return keypair.verify(hash, signature);
  }

  /**
   * Create an auth signature for testing purposes.
   */
  static createAuthSignature(keypair: Keypair, timestamp: number): string {
    const authMessage = keypair.publicKey() + timestamp.toString();
    const hash = sha256(new TextEncoder().encode(authMessage));
    const signature = keypair.sign(hash);
    return Buffer.from(signature).toString('hex');
  }
}