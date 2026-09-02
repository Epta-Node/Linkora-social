import { Request, Response, NextFunction } from "express";
import { Keypair } from "@stellar/stellar-sdk";
import { createHash } from "crypto";
import { buildAuthMessage, canonicalizeAuthPath } from "@linkora/types/src/auth";
import { logger } from "../logger";
import "./rawBody";

const SIGNATURE_TIMESTAMP_TOLERANCE_MS = 30_000;

// ── Nonce / replay cache ──────────────────────────────────────────────────────
//
// Tracks every signature seen within the tolerance window. A captured signed
// request cannot be successfully replayed before its 30 s window expires
// because the signature is rejected as "already used".
//
// The cache is keyed by the raw base64 signature string, which is unique per
// (keypair, message) combination. Entries are evicted once they are older than
// the tolerance window so the Map stays bounded.

interface NonceEntry {
  /** Wall-clock time (ms) when this entry may be evicted. */
  expiresAt: number;
}

const seenSignatures = new Map<string, NonceEntry>();

/**
 * Sweep expired entries from the replay cache.
 * Called once per request, before the cache lookup, so the Map stays small
 * without a separate background timer.
 */
function sweepExpiredNonces(nowMs: number): void {
  for (const [sig, entry] of seenSignatures) {
    if (entry.expiresAt <= nowMs) {
      seenSignatures.delete(sig);
    }
  }
}

/**
 * Return true if `signature` has already been seen within the tolerance window.
 * Records the signature on a cache-miss so subsequent calls from the same
 * request are rejected.
 */
function isReplay(signature: string, nowMs: number): boolean {
  sweepExpiredNonces(nowMs);
  if (seenSignatures.has(signature)) {
    return true;
  }
  seenSignatures.set(signature, { expiresAt: nowMs + SIGNATURE_TIMESTAMP_TOLERANCE_MS });
  return false;
}

/** Exposed for unit tests — clears the replay cache. */
export function clearReplayCache(): void {
  seenSignatures.clear();
}

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
 * Hex SHA-256 of the exact bytes the client sent.
 *
 * A request with no JSON body never reaches body-parser's `verify` hook, so an
 * absent `rawBody` hashes as the empty string — the same thing the client does
 * when it has nothing to send.
 */
function hashRequestBody(req: Request): string {
  return createHash("sha256")
    .update(req.rawBody ?? Buffer.alloc(0))
    .digest("hex");
}

function verifyEd25519Signature(
  req: Request,
  address: string,
  timestamp: number,
  signature: string
): boolean {
  try {
    const message = buildAuthMessage({
      method: req.method,
      canonicalPath: canonicalizeAuthPath(req.originalUrl),
      address,
      timestamp,
      bodyHash: hashRequestBody(req),
    });
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

  if (!verifyEd25519Signature(req, address, timestamp, signature)) {
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

  // ── Replay guard ────────────────────────────────────────────────────────────
  // The timestamp window is necessary but not sufficient: a valid signed request
  // captured within the 30 s window can be replayed. The nonce cache below
  // ensures each signature is honoured at most once.
  if (isReplay(signature, now)) {
    logger.warn(
      {
        requestId: req.context?.requestId,
        address,
        reason: "replayed signature",
      },
      "Rejecting replayed signature"
    );
    res.status(403).json({
      error: {
        code: "REPLAYED_SIGNATURE",
        message: "This signed request has already been used. Please sign a new request.",
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

/**
 * Optional Stellar auth middleware.
 *
 * Unlike `requireStellarAuth`, this middleware never blocks the request.
 * When a valid `StellarSig` header is present it populates
 * `req.context.stellarAddress` so downstream middleware (e.g. rate limiters)
 * can use the per-address bucket. When the header is absent or invalid the
 * request continues without an address — the caller is treated as anonymous.
 *
 * Use this on read routes that are publicly accessible but should reward
 * authenticated users with a higher rate-limit tier.
 */
export function optionalStellarAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  // No header at all — anonymous request, just continue.
  if (!authHeader) {
    next();
    return;
  }

  const parsed = parseStellarSignatureHeader(authHeader);
  if (!parsed) {
    // Malformed header — treat as anonymous rather than hard-failing.
    next();
    return;
  }

  const { address, timestamp, signature } = parsed;
  const now = Date.now();
  const age = now - timestamp;

  // Out-of-window or future timestamp — treat as anonymous.
  if (age < 0 || age > SIGNATURE_TIMESTAMP_TOLERANCE_MS) {
    next();
    return;
  }

  // Invalid signature — treat as anonymous.
  if (!verifyEd25519Signature(req, address, timestamp, signature)) {
    next();
    return;
  }

  // Already-seen signature — treat as anonymous (replay attempt).
  if (isReplay(signature, now)) {
    next();
    return;
  }

  // Valid, fresh, non-replayed auth — set the address and continue.
  if (req.context) {
    req.context.stellarAddress = address;
  }

  logger.debug(
    {
      requestId: req.context?.requestId,
      address,
    },
    "Optional Stellar authentication successful"
  );

  next();
}
