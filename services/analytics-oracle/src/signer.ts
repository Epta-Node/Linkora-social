import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { hashReport } from "./codec.js";

// @noble/ed25519 v2 requires a SHA-512 implementation to be injected.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

/**
 * Signs a report hash with the oracle Ed25519 private key.
 *
 * @param reportCbor - The canonical CBOR encoding of the analytics report.
 * @param privateKey - 32-byte Ed25519 private key.
 * @returns { signature, reportHash } where reportHash is the sha256 digest.
 */
export function signReport(
  reportCbor: Buffer,
  privateKey: Uint8Array
): { signature: Buffer; reportHash: Buffer } {
  const reportHash = hashReport(reportCbor);
  const signature = ed.sign(reportHash, privateKey);
  return { signature: Buffer.from(signature), reportHash };
}
