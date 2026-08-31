import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { Keypair } from "@stellar/stellar-sdk";
import { hashReport } from "./codec.js";
import { logger } from "./logger.js";

// @noble/ed25519 v2 requires a SHA-512 implementation to be injected.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

/**
 * Stateful Ed25519 signer bound to the oracle key.
 *
 * Holds the currently active signing seed (as a Stellar Keypair and the raw
 * noble seed used to sign attestation report hashes). The key can be swapped
 * atomically via `rotate()` so key rotation does not require a process restart.
 * The previous raw seed is zeroed (overwritten) as soon as the swap is
 * complete, and `dispose()` zeroes the active raw seed on shutdown.
 */
export class Signer {
  private seed: Uint8Array;
  private _keypair: Keypair;
  private disposed = false;

  constructor(seed: Uint8Array) {
    // Take our own copy so the caller's buffer can be zeroed independently.
    this.seed = new Uint8Array(seed);
    this._keypair = Keypair.fromRawEd25519Seed(Buffer.from(this.seed));
    logger.info(
      { fingerprint: this.fingerprint(), source: "signer-init" },
      "Oracle signer initialised"
    );
  }

  /** Fingerprint of the current public key (hex). Used in audit logs. */
  fingerprint(): string {
    return Buffer.from(this.seedPublicKey()).toString("hex");
  }

  /** Raw public key bytes (32-byte Ed25519 public key). */
  publicKeyBytes(): Uint8Array {
    return this.seedPublicKey();
  }

  /** Stellar public key (G...) for on-chain account management. */
  stellarPublicKey(): string {
    return this._keypair.publicKey();
  }

  /** The Stellar Keypair used to build and sign on-chain transactions. */
  keypair(): Keypair {
    if (this.disposed) throw new Error("Signer has been disposed");
    return this._keypair;
  }

  /**
   * Atomically swap the signing key. The previous raw seed is zeroed
   * immediately after this returns. Returns the new fingerprint.
   */
  rotate(newSeed: Uint8Array): string {
    if (this.disposed) throw new Error("Signer has been disposed");
    const old = this.seed;
    this.seed = new Uint8Array(newSeed);
    this._keypair = Keypair.fromRawEd25519Seed(Buffer.from(this.seed));
    zeroise(old);
    logger.info(
      { fingerprint: this.fingerprint(), source: "signer-rotate" },
      "Oracle signer key rotated"
    );
    return this.fingerprint();
  }

  /**
   * Zero out the active raw seed on the heap. The signer is unusable
   * afterwards.
   */
  dispose(): void {
    if (this.disposed) return;
    zeroise(this.seed);
    this.disposed = true;
  }

  /**
   * Sign a report hash with the current oracle Ed25519 key.
   *
   * @returns { signature, reportHash } where reportHash is the sha256 digest.
   */
  signReport(reportCbor: Buffer): { signature: Buffer; reportHash: Buffer } {
    if (this.disposed) throw new Error("Signer has been disposed");
    const reportHash = hashReport(reportCbor);
    const signature = ed.sign(reportHash, Buffer.from(this.seed));
    return { signature: Buffer.from(signature), reportHash };
  }

  private seedPublicKey(): Uint8Array {
    return ed.getPublicKey(Buffer.from(this.seed));
  }
}

/**
 * Backwards-compatible standalone signature helper for existing callers that
 * build a fresh key each time. Not used by the oracle hot path.
 */
export function signReport(
  reportCbor: Buffer,
  privateKey: Uint8Array
): { signature: Buffer; reportHash: Buffer } {
  const reportHash = hashReport(reportCbor);
  const signature = ed.sign(reportHash, privateKey);
  return { signature: Buffer.from(signature), reportHash };
}

function zeroise(buf: Uint8Array): void {
  buf.fill(0);
}
