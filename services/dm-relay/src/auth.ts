/**
 * Authentication utilities for DM relay service.
 *
 * Verifies Stellar signatures to prevent unauthorized message submission.
 */

import { randomUUID } from "crypto";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { sha256 } from "@noble/hashes/sha256";

/**
 * Version prefix for the DM message signature. Bump this whenever the signed
 * layout changes so a captured pre-upgrade signature can never be reinterpreted
 * under the new rules — old clients fail cleanly with 401 instead of being
 * accepted with weaker coverage.
 */
export const DM_AUTH_MESSAGE_VERSION = "v2";

export interface AuthData {
  sender: string;
  to: string;
  nonce: number;
  timestamp: number;
  /** Base64 ciphertext the signature must commit to. */
  ciphertext: string;
  signature: string;
}

/**
 * Lowercase hex SHA-256 over the raw bytes of the base64 ciphertext string.
 *
 * Hashing the encoded form (rather than the decoded bytes) keeps every
 * implementation — relay, SDK, web client — in agreement as long as they all
 * hash `ciphertext_b64` as it appears on the wire.
 */
export function hashCiphertext(ciphertext: string): string {
  return Buffer.from(sha256(new TextEncoder().encode(ciphertext))).toString("hex");
}

/**
 * Builds the exact string that gets SHA-256 hashed and Ed25519 signed for a
 * message submission.
 *
 * Layout: `v2:{to}:{nonce}:{timestamp}:{ciphertextHash}`
 *
 * The ciphertext digest binds the signature to the encrypted payload, so a
 * relay operator or an on-path middlebox cannot swap `ciphertext_b64` on a
 * captured request and have the substituted bytes stored under the original
 * sender's identity.
 */
export function buildDmAuthMessage(
  to: string,
  nonce: number,
  timestamp: number,
  ciphertext: string
): string {
  return [
    DM_AUTH_MESSAGE_VERSION,
    to,
    nonce,
    timestamp,
    hashCiphertext(ciphertext),
  ].join(":");
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

// ── Nonce / replay cache ──────────────────────────────────────────────────────
//
// Each valid signature is stored for `maxTimestampSkew` seconds. A captured
// signed request re-presented within the skew window is rejected as a replay.
// Entries are swept lazily on each auth call to keep the Map bounded.

interface ReplayCacheEntry {
  /** Unix timestamp (seconds) after which this entry may be evicted. */
  expiresAt: number;
}

const dmRelaySeenSignatures = new Map<string, ReplayCacheEntry>();

function sweepDmRelayNonces(nowSecs: number): void {
  for (const [sig, entry] of dmRelaySeenSignatures) {
    if (entry.expiresAt <= nowSecs) {
      dmRelaySeenSignatures.delete(sig);
    }
  }
}

function isDmRelayReplay(signature: string, nowSecs: number, maxSkewSecs: number): boolean {
  sweepDmRelayNonces(nowSecs);
  if (dmRelaySeenSignatures.has(signature)) {
    return true;
  }
  dmRelaySeenSignatures.set(signature, { expiresAt: nowSecs + maxSkewSecs });
  return false;
}

/** Exposed for unit tests — clears the dm-relay replay cache. */
export function clearDmRelayReplayCache(): void {
  dmRelaySeenSignatures.clear();
}

export class AuthService {
  private readonly maxTimestampSkew: number;
  private readonly stellarNetwork: string;

  constructor(maxTimestampSkew: number = 30, stellarNetwork: string = "Testnet") {
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
    const { sender, to, nonce, timestamp, ciphertext, signature } = authData;

    if (typeof ciphertext !== "string" || ciphertext.length === 0) {
      throw new AuthError("Missing ciphertext: the signature must cover the message payload");
    }

    // Validate Stellar address formats
    if (!StrKey.isValidEd25519PublicKey(sender)) {
      throw new AuthError("Invalid sender address format");
    }
    if (!StrKey.isValidEd25519PublicKey(to)) {
      throw new AuthError("Invalid recipient address format");
    }

    // Check timestamp freshness (prevent replay attacks)
    const now = Math.floor(Date.now() / 1000);
    const timestampSkew = Math.abs(now - timestamp);

    if (timestampSkew > this.maxTimestampSkew) {
      throw new AuthError(
        `Timestamp too old or too far in future. Skew: ${timestampSkew}s, max: ${this.maxTimestampSkew}s`
      );
    }

    // Verify signature over {version, to, nonce, timestamp, ciphertextHash}
    try {
      const isValid = this.verifySignature(sender, to, nonce, timestamp, ciphertext, signature);
      if (!isValid) {
        throw new AuthError("Invalid signature");
      }

      // Replay guard: reject signatures that have already been honoured within
      // the skew window, even though the timestamp is still technically fresh.
      if (isDmRelayReplay(signature, now, this.maxTimestampSkew)) {
        throw new AuthError("Replayed signature: this signed request has already been used");
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
   * Verify address ownership via a signed challenge.
   *
   * The challenge payload is `address:timestamp`, signed by the address's
   * private key. Used to authenticate GET requests and WebSocket handshakes.
   */
  verifyAddressOwnership(address: string, timestamp: number, signatureHex: string): boolean {
    if (!StrKey.isValidEd25519PublicKey(address)) {
      throw new AuthError("Invalid address format");
    }

    const now = Math.floor(Date.now() / 1000);
    const skew = Math.abs(now - timestamp);
    if (skew > this.maxTimestampSkew) {
      throw new AuthError(
        `Timestamp too old or too far in future. Skew: ${skew}s, max: ${this.maxTimestampSkew}s`
      );
    }

    try {
      const challenge = `${address}:${timestamp}`;
      const hash = sha256(new TextEncoder().encode(challenge));

      const signature = Buffer.from(signatureHex, "hex");
      if (signature.length !== 64) {
        throw new AuthError("Invalid signature length");
      }

      const keypair = Keypair.fromPublicKey(address);
      const isValid = keypair.verify(Buffer.from(hash), signature);
      if (!isValid) {
        throw new AuthError("Invalid signature");
      }

      // Replay guard: reject re-use of the same address ownership proof within
      // the skew window.
      if (isDmRelayReplay(signatureHex, now, this.maxTimestampSkew)) {
        throw new AuthError("Replayed signature: this address ownership proof has already been used");
      }

      return true;
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError(`Address ownership verification failed: ${error}`);
    }
  }

  /**
   * Create an address ownership signature for testing.
   * Signs sha256(address + ":" + timestamp).
   */
  static createAddressOwnershipSignature(
    keypair: Keypair,
    address: string,
    timestamp: number
  ): string {
    const challenge = `${address}:${timestamp}`;
    const hash = sha256(new TextEncoder().encode(challenge));
    const signature = keypair.sign(Buffer.from(hash));
    return Buffer.from(signature).toString("hex");
  }

  /**
   * Parse an Authorization header value in the format:
   *   Stellar <address> <signature> <timestamp>
   *
   * Returns the parsed components or throws an AuthError.
   */
  static parseAuthHeader(header: string | undefined): {
    address: string;
    signature: string;
    timestamp: number;
  } {
    if (!header) {
      throw new AuthError("Missing Authorization header");
    }

    const parts = header.split(" ");
    if (parts.length !== 4 || parts[0] !== "Stellar") {
      throw new AuthError(
        "Invalid Authorization header format. Expected: Stellar <address> <signature> <timestamp>"
      );
    }

    const [, address, signature, timestampStr] = parts;
    const timestamp = parseInt(timestampStr, 10);

    if (isNaN(timestamp)) {
      throw new AuthError("Invalid timestamp in Authorization header");
    }

    return { address, signature, timestamp };
  }

  /**
   * Create a signed Authorization header value for testing.
   */
  static createAuthHeader(keypair: Keypair): string {
    const address = keypair.publicKey();
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = AuthService.createAddressOwnershipSignature(keypair, address, timestamp);
    return `Stellar ${address} ${signature} ${timestamp}`;
  }

  /**
   * Create the Stellar signature. Message is
   * sha256(buildDmAuthMessage(to, nonce, timestamp, ciphertext)).
   */
  private verifySignature(
    sender: string,
    to: string,
    nonce: number,
    timestamp: number,
    ciphertext: string,
    signatureHex: string
  ): boolean {
    const authMessage = buildDmAuthMessage(to, nonce, timestamp, ciphertext);
    const hash = sha256(new TextEncoder().encode(authMessage));

    const signature = Buffer.from(signatureHex, "hex");
    if (signature.length !== 64) {
      throw new AuthError("Invalid signature length");
    }

    const keypair = Keypair.fromPublicKey(sender);
    return keypair.verify(Buffer.from(hash), signature);
  }

  /**
   * Create an auth signature for testing: signs
   * sha256(buildDmAuthMessage(to, nonce, timestamp, ciphertext)).
   */
  static createAuthSignature(
    keypair: Keypair,
    to: string,
    nonce: number,
    timestamp: number,
    ciphertext: string
  ): string {
    const authMessage = buildDmAuthMessage(to, nonce, timestamp, ciphertext);
    const hash = sha256(new TextEncoder().encode(authMessage));
    const signature = keypair.sign(Buffer.from(hash));
    return Buffer.from(signature).toString("hex");
  }

  /**
   * Create a WebSocket challenge for the given address.
   * Returns the challenge string the client must sign and the timestamp.
   */
  createWsChallenge(address: string): { challenge: string; timestamp: number } {
    if (!StrKey.isValidEd25519PublicKey(address)) {
      throw new AuthError("Invalid address format");
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = randomUUID();
    const challenge = `ws_challenge:${address}:${nonce}:${timestamp}`;
    return { challenge, timestamp };
  }

  /**
   * Verify a WebSocket challenge-response signature.
   *
   * @param address - The Stellar address claiming to own the connection
   * @param challenge - The original challenge string sent by the server
   * @param timestamp - The timestamp from the challenge
   * @param signatureHex - The client's Ed25519 signature (hex-encoded)
   * @throws AuthError if verification fails
   */
  verifyWsChallenge(
    address: string,
    challenge: string,
    timestamp: number,
    signatureHex: string
  ): void {
    // Validate address format
    if (!StrKey.isValidEd25519PublicKey(address)) {
      throw new AuthError("Invalid address format");
    }

    // Check timestamp freshness
    const now = Math.floor(Date.now() / 1000);
    const skew = Math.abs(now - timestamp);
    if (skew > this.maxTimestampSkew) {
      throw new AuthError(
        `Challenge timestamp expired. Skew: ${skew}s, max: ${this.maxTimestampSkew}s`
      );
    }

    // Verify the challenge format matches what we'd generate:
    // ws_challenge:<address>:<uuid>:<timestamp>  (exactly 4 colon-separated parts)
    const expectedPrefix = `ws_challenge:${address}:`;
    if (!challenge.startsWith(expectedPrefix)) {
      throw new AuthError("Invalid challenge format");
    }
    const parts = challenge.split(":");
    if (parts.length !== 4) {
      throw new AuthError("Invalid challenge format");
    }
    const challengeTimestamp = parseInt(parts[3], 10);
    if (isNaN(challengeTimestamp) || challengeTimestamp !== timestamp) {
      throw new AuthError("Invalid challenge format");
    }

    // Verify signature
    const hash = sha256(new TextEncoder().encode(challenge));
    const signature = Buffer.from(signatureHex, "hex");
    if (signature.length !== 64) {
      throw new AuthError("Invalid signature length");
    }

    const keypair = Keypair.fromPublicKey(address);
    const valid = keypair.verify(Buffer.from(hash), signature);
    if (!valid) {
      throw new AuthError("Invalid WebSocket challenge signature");
    }
  }
}
