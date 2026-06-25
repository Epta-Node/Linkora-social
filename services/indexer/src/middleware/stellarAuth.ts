import { Request, Response, NextFunction } from "express";
import { Keypair } from "@stellar/stellar-sdk";
import { createHash } from "crypto";
import { logger } from "../logger";

// ── Configuration ─────────────────────────────────────────────────────────────

const SIGNATURE_TIMESTAMP_TOLERANCE_MS = 30_000; // 30 seconds

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parses "StellarSig <base64(JSON { address, timestamp, signature })>" format.
 * Returns { address, timestamp, signature } or null if invalid.
 */
function parseStellarSignatureHeader(
  header: string | undefined
): { address: string; timestamp: number; signature: string } | null {
  if (!header) return null;

  const parts = header.split(" ");
  if (parts.length !== 2 || parts[0] !== "StellarSig") {
    return null;
  }

  const base64Payload = parts[1];

  try {
    const jsonStr = Buffer.from(base64Payload, "base64").toString("utf8");
    const parsed = JSON.parse(jsonStr) as {
      address?: unknown;
      timestamp?: unknown;
      signature?: unknown;
    };

    if (
      typeof parsed.address !== "string" ||
      parsed.address.trim() === "" ||
      typeof parsed.timestamp !== "number" ||
      !Number.isFinite(parsed.timestamp) ||
      typeof parsed.signature !== "string" ||
      parsed.signature.trim() === ""
    ) {
      return null;
    }

    return {
      address: parsed.address,
      timestamp: parsed.timestamp,
      signature: parsed.signature,
    };
  } catch {
    return null;
  }
}

/**
 * Verifies an Ed25519 signature against a message.
 * Returns true if valid, false otherwise.
 */
function verifyEd25519Signature(address: string, timestamp: number, signature: string): boolean {
  try {
    // Construct the message: address:timestamp
    const message = `${address}:${timestamp}`;

    // Hash it with SHA256
    const hash = createHash("sha256").update(message).digest();

    // Parse the Stellar address (public key)
    const keypair = Keypair.fromPublicKey(address);

    // Verify the signature using the public key.
    // The signature is expected to be base64-encoded.
    // stellar-sdk's verify(data, signature) takes the raw data buffer directly.
    return keypair.verify(hash, Buffer.from(signature, "base64"));
  } catch (error) {
    logger.debug(
      {
        address,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      "Signature verification failed"
    );
    return false;
  }
}

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Middleware to require and verify Stellar Ed25519 signatures.
 * Expects: Authorization: StellarSig <base64(JSON { address, timestamp, signature })>

 *
 * On success:
 *   - Sets req.context.stellarAddress
 *   - Calls next()
 *
 * On failure:
 *   - Returns 400 for malformed header
 *   - Returns 403 for expired timestamp (>30s old)
 *   - Returns 401 for invalid signature
 */

export function requireStellarAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  // Parse the authorization header
  const parsed = parseStellarSignatureHeader(authHeader);
  if (!parsed) {
    logger.warn(
      {
        requestId: req.context?.requestId,
        authHeader: authHeader ? "malformed" : "missing",
      },
      "Missing or malformed Stellar authorization header"
    );
    res.status(400).json({
      error:
        "Missing or malformed Authorization header. Expected: Authorization: StellarSig <base64(JSON { address, timestamp, signature })>",
      code: "INVALID_AUTH_HEADER",
    });
    return;
  }

  const { address, timestamp, signature } = parsed;

  // Check if timestamp is within tolerance (prevent replay attacks)
  const now = Date.now();
  const age = now - timestamp;

  if (age < 0) {
    logger.warn(
      {
        requestId: req.context?.requestId,
        address,
        reason: "future timestamp",
      },
      "Rejecting request with future timestamp"
    );
    res.status(403).json({
      error: "Timestamp is in the future",
      code: "INVALID_TIMESTAMP",
    });
    return;
  }

  if (age > SIGNATURE_TIMESTAMP_TOLERANCE_MS) {
    logger.warn(
      {
        requestId: req.context?.requestId,
        address,
        ageMs: age,
        toleranceMs: SIGNATURE_TIMESTAMP_TOLERANCE_MS,
      },
      "Rejecting request with expired timestamp"
    );
    res.status(403).json({
      error: `Timestamp is more than ${SIGNATURE_TIMESTAMP_TOLERANCE_MS / 1000}s old. Request rejected for security (replay protection).`,
      code: "EXPIRED_TIMESTAMP",
    });
    return;
  }

  // Verify the signature
  if (!verifyEd25519Signature(address, timestamp, signature)) {
    logger.warn(
      {
        requestId: req.context?.requestId,
        address,
        reason: "invalid signature",
      },
      "Signature verification failed"
    );
    res.status(401).json({
      error: "Invalid signature",
      code: "INVALID_SIGNATURE",
    });
    return;
  }

  // Success: attach the address to context and continue
  if (req.context) {
    req.context.stellarAddress = address;
  }

  logger.debug(
    {
      requestId: req.context?.requestId,
      address,
    },
    "Stellar authentication successful"
  );

  next();
}

export default requireStellarAuth;
