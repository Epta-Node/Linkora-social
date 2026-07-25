import { Request, Response, NextFunction } from "express";
import { Keypair } from "@stellar/stellar-sdk";
import { createHash } from "crypto";
import { logger } from "../logger";

const SIGNATURE_TIMESTAMP_TOLERANCE_MS = 30_000;

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

function verifyEd25519Signature(address: string, timestamp: number, signature: string): boolean {
  try {
    const message = `${address}:${timestamp}`;
    const hash = createHash("sha256").update(message).digest();
    const keypair = Keypair.fromPublicKey(address);
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

export function requireStellarAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

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
      error: {
        code: "INVALID_AUTH_HEADER",
        message:
          "Missing or malformed Authorization header. Expected: Authorization: StellarSig <base64(JSON { address, timestamp, signature })>",
        requestId: req.context?.requestId,
      },
    });
    return;
  }

  const { address, timestamp, signature } = parsed;

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
      error: {
        code: "INVALID_TIMESTAMP",
        message: "Timestamp is in the future",
        requestId: req.context?.requestId,
      },
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
      error: {
        code: "EXPIRED_TIMESTAMP",
        message: `Timestamp is more than ${SIGNATURE_TIMESTAMP_TOLERANCE_MS / 1000}s old. Request rejected for security (replay protection).`,
        requestId: req.context?.requestId,
      },
    });
    return;
  }

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
      error: {
        code: "INVALID_SIGNATURE",
        message: "Invalid signature",
        requestId: req.context?.requestId,
      },
    });
    return;
  }

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
