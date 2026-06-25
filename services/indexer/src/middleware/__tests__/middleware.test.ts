/**
 * Middleware tests for:
 *   1. Rate limiting (rateLimit.ts) — sliding-window, 429 + Retry-After
 *   2. Stellar authentication (stellarAuth.ts) — Ed25519 sig validation
 *   3. /health endpoint shape
 *
 * Acceptance criteria:
 *   - Burst 70 read requests from same IP → 61st returns 429
 *   - Valid Stellar-signed write request → 202 Accepted
 *   - Write request with 60-second-old timestamp → 403
 *   - Write request with invalid signature → 401
 *
 * NOTE: We derive Ed25519 test keypairs using Node's built-in `crypto` module
 * (avoiding the ESM-only @noble/hashes transitive dependency of stellar-sdk
 * which can't be resolved by Jest's CJS transformer). The middleware under test
 * still uses @stellar/stellar-sdk to verify.
 */

import request from "supertest";
import {
  createHash,
  generateKeyPairSync,
  createPublicKey,
  verify as cryptoVerify,
  sign as cryptoSign,
} from "crypto";
import express, { Request, Response } from "express";
import { requestLoggingMiddleware } from "../../logger";
import { rateLimitRead, rateLimitWrite, resetRateLimiter, RateLimiter } from "../rateLimit";
import { requireStellarAuth } from "../stellarAuth";

// ── Mock @stellar/stellar-sdk to avoid ESM dep chain ─────────────────────────
//
// The middleware uses Keypair.fromPublicKey(address).verifyHash(hash, sigBuf).
// We replace the entire SDK with a shim that wraps Node's crypto Ed25519.
//
// Stellar Ed25519 public keys are 32 raw bytes encoded in strkey (base32 with
// version byte 6 = 'G'). For tests we skip strkey and store raw hex in the
// address field; the mock resolves them back.

jest.mock("@stellar/stellar-sdk", () => {
  return {
    Keypair: {
      fromPublicKey: (address: string) => ({
        verify: (hash: Buffer, sig: Buffer): boolean => {
          try {
            // address is "ed25519hex:<hex of raw 32-byte public key>"
            const rawPubHex = address.replace("ed25519hex:", "");
            const rawPub = Buffer.from(rawPubHex, "hex");
            // Re-create the DER-encoded SubjectPublicKeyInfo that Node crypto expects
            const PREFIX = Buffer.from("302a300506032b6570032100", "hex");
            const keyDer = Buffer.concat([PREFIX, rawPub]);
            const publicKey = createPublicKey({ key: keyDer, format: "der", type: "spki" });
            return cryptoVerify(null, hash, publicKey, sig);
          } catch {
            return false;
          }
        },
      }),
    },
  };
});

// ── Test key pair generation (native Node crypto) ─────────────────────────────

interface TestKeypair {
  /** fake "Stellar address" — ed25519hex:<hex-pubkey> */
  address: string;
  /** sign a buffer and return the 64-byte signature */
  sign: (data: Buffer) => Buffer;
}

function generateTestKeypair(): TestKeypair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");

  // Extract raw 32-byte public key from SubjectPublicKeyInfo DER
  const spkiDer = publicKey.export({ format: "der", type: "spki" });
  const rawPub = spkiDer.slice(spkiDer.length - 32);
  const address = `ed25519hex:${rawPub.toString("hex")}`;

  const sign = (data: Buffer): Buffer => Buffer.from(cryptoSign(null, data, privateKey));

  return { address, sign };
}

// ── Helper: build a valid Authorization header ────────────────────────────────

function buildStellarAuthHeader(kp: TestKeypair, timestampMs: number): string {
  const message = `${kp.address}:${timestampMs}`;
  const hash = createHash("sha256").update(message).digest();
  const sig = kp.sign(hash);
  const payload = JSON.stringify({
    address: kp.address,
    timestamp: timestampMs,
    signature: sig.toString("base64"),
  });
  return `StellarSig ${Buffer.from(payload).toString("base64")}`;
}

// ── Rate Limiter Unit Tests ───────────────────────────────────────────────────

describe("RateLimiter (sliding window unit)", () => {
  it("allows requests up to the limit", () => {
    const rl = new RateLimiter();
    for (let i = 0; i < 5; i++) {
      expect(rl.isAllowed("key1", 5)).toBe(true);
    }
  });

  it("rejects the request that exceeds the limit", () => {
    const rl = new RateLimiter();
    for (let i = 0; i < 5; i++) rl.isAllowed("key2", 5);
    expect(rl.isAllowed("key2", 5)).toBe(false);
  });

  it("reports remaining time > 0 after limit exceeded", () => {
    const rl = new RateLimiter();
    for (let i = 0; i < 3; i++) rl.isAllowed("key3", 3);
    expect(rl.getRemainingTime("key3")).toBeGreaterThan(0);
  });

  it("tracks independent keys separately", () => {
    const rl = new RateLimiter();
    for (let i = 0; i < 3; i++) rl.isAllowed("keyA", 3);
    expect(rl.isAllowed("keyA", 3)).toBe(false);
    expect(rl.isAllowed("keyB", 3)).toBe(true);
  });

  it("getRequestCount returns 0 for unknown key", () => {
    const rl = new RateLimiter();
    expect(rl.getRequestCount("unknown")).toBe(0);
  });
});

// ── HTTP-level Rate Limit Tests ───────────────────────────────────────────────

describe("rateLimitRead middleware (60 req/min per IP)", () => {
  let app: express.Express;

  beforeEach(() => {
    resetRateLimiter();

    app = express();
    app.use(requestLoggingMiddleware);
    app.get("/test", rateLimitRead, (_req: Request, res: Response) => {
      res.json({ ok: true });
    });
  });

  it("allows the first 60 requests and returns 429 on the 61st", async () => {
    const ip = "10.0.0.1";
    const headers = { "x-forwarded-for": ip };

    for (let i = 0; i < 60; i++) {
      const res = await request(app).get("/test").set(headers);
      expect(res.status).toBe(200);
    }

    const res = await request(app).get("/test").set(headers);
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
    expect(res.body.code).toBe("RATE_LIMIT_EXCEEDED");
  }, 30_000);

  it("burst of 70 requests: exactly 60 allowed and 10 rate-limited", async () => {
    const ip = "10.0.0.2";
    const headers = { "x-forwarded-for": ip };
    const statuses: number[] = [];

    for (let i = 0; i < 70; i++) {
      const res = await request(app).get("/test").set(headers);
      statuses.push(res.status);
    }

    const allowed = statuses.filter((s) => s === 200).length;
    const limited = statuses.filter((s) => s === 429).length;
    expect(allowed).toBe(60);
    expect(limited).toBe(10);
  }, 30_000);

  it("different IPs have independent counters", async () => {
    for (let i = 0; i < 60; i++) {
      await request(app).get("/test").set({ "x-forwarded-for": "10.1.0.1" });
    }
    expect((await request(app).get("/test").set({ "x-forwarded-for": "10.1.0.1" })).status).toBe(
      429
    );
    expect((await request(app).get("/test").set({ "x-forwarded-for": "10.1.0.2" })).status).toBe(
      200
    );
  }, 30_000);

  it("includes Retry-After header with a value in [1, 60] seconds", async () => {
    const headers = { "x-forwarded-for": "10.0.0.3" };
    for (let i = 0; i < 60; i++) await request(app).get("/test").set(headers);

    const res = await request(app).get("/test").set(headers);
    expect(res.status).toBe(429);
    const retryAfter = parseInt(res.headers["retry-after"] as string, 10);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  }, 30_000);
});

// ── Stellar Auth Tests ────────────────────────────────────────────────────────

describe("requireStellarAuth middleware", () => {
  let app: express.Express;
  let kp: TestKeypair;

  beforeEach(() => {
    resetRateLimiter();
    kp = generateTestKeypair();

    app = express();
    app.use(express.json());
    app.use(requestLoggingMiddleware);
    app.post("/write", requireStellarAuth, rateLimitWrite, (req: Request, res: Response) => {
      res.json({ ok: true, address: req.context?.stellarAddress });
    });
  });

  // ── Happy path ─────────────────────────────────────────────────────────────

  it("accepts a request with a valid, fresh Stellar signature → 200", async () => {
    const authHeader = buildStellarAuthHeader(kp, Date.now());
    const res = await request(app).post("/write").set("Authorization", authHeader).send({});
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.address).toBe(kp.address);
  });

  it("attaches stellarAddress to request context on success", async () => {
    const authHeader = buildStellarAuthHeader(kp, Date.now());
    const res = await request(app).post("/write").set("Authorization", authHeader).send({});
    expect(res.body.address).toBe(kp.address);
  });

  // ── Expired timestamp → 403 ────────────────────────────────────────────────

  it("rejects a 60-second-old timestamp → 403 EXPIRED_TIMESTAMP", async () => {
    const authHeader = buildStellarAuthHeader(kp, Date.now() - 60_000);
    const res = await request(app).post("/write").set("Authorization", authHeader).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EXPIRED_TIMESTAMP");
  });

  it("rejects a 31-second-old timestamp (tolerance is 30s) → 403", async () => {
    const authHeader = buildStellarAuthHeader(kp, Date.now() - 31_000);
    const res = await request(app).post("/write").set("Authorization", authHeader).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EXPIRED_TIMESTAMP");
  });

  it("accepts a timestamp within the 30s window → 200", async () => {
    const authHeader = buildStellarAuthHeader(kp, Date.now() - 15_000);
    const res = await request(app).post("/write").set("Authorization", authHeader).send({});
    expect(res.status).toBe(200);
  });

  // ── Invalid signature → 401 ────────────────────────────────────────────────

  it("rejects a tampered (wrong-keypair) signature → 401 INVALID_SIGNATURE", async () => {
    const now = Date.now();
    const otherKp = generateTestKeypair();
    // Sign with otherKp but claim to be kp
    const message = `${kp.address}:${now}`;
    const hash = createHash("sha256").update(message).digest();
    const badSig = otherKp.sign(hash).toString("base64");
    const payload = JSON.stringify({ address: kp.address, timestamp: now, signature: badSig });
    const authHeader = `StellarSig ${Buffer.from(payload).toString("base64")}`;

    const res = await request(app).post("/write").set("Authorization", authHeader).send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_SIGNATURE");
  });

  it("rejects a garbage signature → 401 INVALID_SIGNATURE", async () => {
    const now = Date.now();
    const payload = JSON.stringify({
      address: kp.address,
      timestamp: now,
      signature: Buffer.from("garbage-not-a-real-ed25519-sig").toString("base64"),
    });
    const authHeader = `StellarSig ${Buffer.from(payload).toString("base64")}`;

    const res = await request(app).post("/write").set("Authorization", authHeader).send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_SIGNATURE");
  });

  // ── Missing / malformed header → 400 ─────────────────────────────────────

  it("returns 400 when Authorization header is missing", async () => {
    const res = await request(app).post("/write").send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_AUTH_HEADER");
    expect(res.body.error).toBeDefined();
  });

  it("returns 400 for wrong scheme (Bearer)", async () => {
    const res = await request(app).post("/write").set("Authorization", "Bearer sometoken").send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_AUTH_HEADER");
  });

  it("returns 400 for invalid base64 in StellarSig payload", async () => {
    const res = await request(app)
      .post("/write")
      .set("Authorization", "StellarSig !!!not-base64!!!")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_AUTH_HEADER");
  });

  it("returns 403 for a future timestamp (replay attack from future)", async () => {
    const authHeader = buildStellarAuthHeader(kp, Date.now() + 999_999);
    const res = await request(app).post("/write").set("Authorization", authHeader).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("INVALID_TIMESTAMP");
  });
});

// ── /health endpoint shape ────────────────────────────────────────────────────

describe("getHealth() shape", () => {
  it("returns an object with the required fields", async () => {
    const { getHealth } = await import("../../logger");
    const health = getHealth();
    expect(health).toHaveProperty("status");
    expect(health).toHaveProperty("uptime");
    expect(health).toHaveProperty("dbConnected");
    expect(health).toHaveProperty("rpcConnected");
    expect(["ok", "degraded"]).toContain(health.status);
    expect(typeof health.uptime).toBe("number");
    expect(health.uptime).toBeGreaterThanOrEqual(0);
  });
});
