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
import {
  rateLimitRead,
  rateLimitWrite,
  resetRateLimiter,
  RateLimiter,
  getClientIP,
  isIpInCidr,
  normalizeIp,
} from "../rateLimit";

describe("getClientIP & Trusted Proxy validation", () => {
  it("normalizes IPv4 and IPv6-mapped IPv4 addresses", () => {
    expect(normalizeIp("1.2.3.4")).toBe("1.2.3.4");
    expect(normalizeIp("::ffff:1.2.3.4")).toBe("1.2.3.4");
  });

  it("validates CIDR matches correctly", () => {
    expect(isIpInCidr("10.0.0.5", "10.0.0.0/8")).toBe(true);
    expect(isIpInCidr("172.16.1.1", "172.16.0.0/12")).toBe(true);
    expect(isIpInCidr("192.168.1.100", "192.168.0.0/16")).toBe(true);
    expect(isIpInCidr("203.0.113.1", "10.0.0.0/8")).toBe(false);
  });

  it("ignores spoofed X-Forwarded-For from untrusted direct connection", () => {
    const req = {
      headers: { "x-forwarded-for": "1.2.3.4" },
      socket: { remoteAddress: "203.0.113.50" },
    };
    expect(getClientIP(req, ["10.0.0.0/8", "127.0.0.1"])).toBe("203.0.113.50");
  });

  it("trusts X-Forwarded-For header when connection comes from trusted proxy", () => {
    const req = {
      headers: { "x-forwarded-for": "198.51.100.25" },
      socket: { remoteAddress: "10.0.0.1" },
    };
    expect(getClientIP(req, ["10.0.0.0/8"])).toBe("198.51.100.25");
  });

  it("extracts true client IP from multi-hop X-Forwarded-For header", () => {
    const req = {
      headers: { "x-forwarded-for": "198.51.100.25, 10.0.0.2" },
      socket: { remoteAddress: "10.0.0.1" },
    };
    expect(getClientIP(req, ["10.0.0.0/8"])).toBe("198.51.100.25");
  });
});
import { requireStellarAuth, optionalStellarAuth, clearReplayCache } from "../stellarAuth";
import { jsonWithRawBody } from "../rawBody";
import { buildAuthMessage, canonicalizeAuthPath } from "@linkora/types/src/auth";

// Generous default timeout: this suite issues ~400 HTTP requests and is run
// concurrently (via turbo) with the cargo test suite on 2-core CI runners, so
// event-loop stalls can easily exceed Jest's 5s default.
jest.setTimeout(30_000);

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

interface SignedRequest {
  /** HTTP method the credential is bound to. */
  method?: string;
  /** Path the credential is bound to, as the client would send it. */
  path?: string;
  /**
   * Body the credential is bound to.
   * `undefined` / omitted → defaults to `{}` (JSON object, for write requests).
   * `null` → explicitly no body (empty bytes), for GET / no-payload requests.
   */
  body?: unknown;
}

function buildStellarAuthHeader(
  kp: TestKeypair,
  timestampMs: number,
  { method = "POST", path = "/write", body = {} }: SignedRequest = {}
): string {
  // supertest serialises objects with JSON.stringify, so this reproduces the
  // exact bytes the server will hash.
  // `null` means "no body at all" — hash empty bytes, same as req.rawBody === undefined.
  const rawBody = body === null ? "" : JSON.stringify(body);
  const message = buildAuthMessage({
    method,
    canonicalPath: canonicalizeAuthPath(path),
    address: kp.address,
    timestamp: timestampMs,
    bodyHash: createHash("sha256").update(rawBody).digest("hex"),
  });
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

describe("rateLimitRead middleware (100 req/min per IP)", () => {
  let app: express.Express;

  beforeEach(() => {
    resetRateLimiter();

    app = express();
    // Mirrors the production app (api/index.ts): trust exactly one proxy hop
    // so `req.ip` resolves from the rightmost X-Forwarded-For entry instead
    // of a client-supplied one.
    app.set("trust proxy", 1);
    app.use(requestLoggingMiddleware);
    app.get("/test", rateLimitRead, (_req: Request, res: Response) => {
      res.json({ ok: true });
    });
  });

  it("allows the first 100 requests and returns 429 on the 101st", async () => {
    const ip = "10.0.0.1";
    const headers = { "x-forwarded-for": ip };

    for (let i = 0; i < 100; i++) {
      const res = await request(app).get("/test").set(headers);
      expect(res.status).toBe(200);
    }

    const res = await request(app).get("/test").set(headers);
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
    expect(res.body.error.code).toBe("RATE_LIMITED");
  }, 30_000);

  it("burst of 110 requests: exactly 100 allowed and 10 rate-limited", async () => {
    const ip = "10.0.0.2";
    const headers = { "x-forwarded-for": ip };
    const statuses: number[] = [];

    for (let i = 0; i < 110; i++) {
      const res = await request(app).get("/test").set(headers);
      statuses.push(res.status);
    }

    const allowed = statuses.filter((s) => s === 200).length;
    const limited = statuses.filter((s) => s === 429).length;
    expect(allowed).toBe(100);
    expect(limited).toBe(10);
  }, 30_000);

  it("different IPs have independent counters", async () => {
    for (let i = 0; i < 100; i++) {
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
    for (let i = 0; i < 100; i++) await request(app).get("/test").set(headers);

    const res = await request(app).get("/test").set(headers);
    expect(res.status).toBe(429);
    const retryAfter = parseInt(res.headers["retry-after"] as string, 10);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  }, 30_000);

  it("does not let a spoofed X-Forwarded-For prefix reset the limit", async () => {
    // With one trusted proxy hop, the client-supplied portion of the header
    // is everything except the rightmost entry (the address our own proxy
    // observed). Rotating the spoofed prefix must not grant a fresh budget.
    const realClientIp = "203.0.113.195";
    for (let i = 0; i < 100; i++) {
      const res = await request(app)
        .get("/test")
        .set("x-forwarded-for", `${i}.${i}.${i}.${i}, ${realClientIp}`);
      expect(res.status).toBe(200);
    }

    const spoofed = await request(app)
      .get("/test")
      .set("x-forwarded-for", `198.51.100.${Math.floor(Math.random() * 254) + 1}, ${realClientIp}`);
    expect(spoofed.status).toBe(429);
  }, 30_000);

  it("still isolates genuinely different clients behind the trusted proxy", async () => {
    for (let i = 0; i < 100; i++) {
      await request(app).get("/test").set("x-forwarded-for", "1.2.3.4, 203.0.113.10");
    }
    expect(
      (await request(app).get("/test").set("x-forwarded-for", "1.2.3.4, 203.0.113.10")).status
    ).toBe(429);
    expect(
      (await request(app).get("/test").set("x-forwarded-for", "1.2.3.4, 203.0.113.11")).status
    ).toBe(200);
  }, 30_000);
});

// ── Stellar Auth Tests ────────────────────────────────────────────────────────

describe("requireStellarAuth middleware", () => {
  let app: express.Express;
  let kp: TestKeypair;

  beforeEach(() => {
    resetRateLimiter();
    clearReplayCache();
    kp = generateTestKeypair();

    app = express();
    app.use(jsonWithRawBody());
    app.use(requestLoggingMiddleware);
    const handler = (req: Request, res: Response): void => {
      res.json({ ok: true, address: req.context?.stellarAddress });
    };
    app.post("/write", requireStellarAuth, rateLimitWrite, handler);
    // A second endpoint, so a credential minted for /write can be replayed at it.
    app.post("/other", requireStellarAuth, rateLimitWrite, handler);
    app.put("/write", requireStellarAuth, rateLimitWrite, handler);
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
    expect(res.body.error.code).toBe("EXPIRED_TIMESTAMP");
  });

  it("rejects a 31-second-old timestamp (tolerance is 30s) → 403", async () => {
    const authHeader = buildStellarAuthHeader(kp, Date.now() - 31_000);
    const res = await request(app).post("/write").set("Authorization", authHeader).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("EXPIRED_TIMESTAMP");
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
    const message = buildAuthMessage({
      method: "POST",
      canonicalPath: "/write",
      address: kp.address,
      timestamp: now,
      bodyHash: createHash("sha256").update("{}").digest("hex"),
    });
    const hash = createHash("sha256").update(message).digest();
    const badSig = otherKp.sign(hash).toString("base64");
    const payload = JSON.stringify({ address: kp.address, timestamp: now, signature: badSig });
    const authHeader = `StellarSig ${Buffer.from(payload).toString("base64")}`;

    const res = await request(app).post("/write").set("Authorization", authHeader).send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_SIGNATURE");
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
    expect(res.body.error.code).toBe("INVALID_SIGNATURE");
  });

  // ── Missing / malformed header → 400 ─────────────────────────────────────

  it("returns 400 when Authorization header is missing", async () => {
    const res = await request(app).post("/write").send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AUTH_HEADER");
    expect(res.body.error.message).toBeDefined();
  });

  it("returns 400 for wrong scheme (Bearer)", async () => {
    const res = await request(app).post("/write").set("Authorization", "Bearer sometoken").send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AUTH_HEADER");
  });

  it("returns 400 for invalid base64 in StellarSig payload", async () => {
    const res = await request(app)
      .post("/write")
      .set("Authorization", "StellarSig !!!not-base64!!!")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AUTH_HEADER");
  });

  // Freighter's `signBlob` is typed `Promise<string>` but resolves to a Buffer, which
  // `JSON.stringify` renders as `{"type":"Buffer","data":[…]}`. The header must be rejected
  // on shape before any verification runs — note that `Buffer.from(obj, "base64")` would
  // happily recover the bytes, so the string check is the only thing standing here.
  it("returns 400 when signature is a serialised Buffer rather than a base64 string", async () => {
    const valid = buildStellarAuthHeader(kp, Date.now());
    const payload = JSON.parse(Buffer.from(valid.split(" ")[1], "base64").toString("utf8"));
    payload.signature = JSON.parse(JSON.stringify(Buffer.from(payload.signature, "base64")));
    expect(payload.signature.type).toBe("Buffer");

    const header = `StellarSig ${Buffer.from(JSON.stringify(payload)).toString("base64")}`;
    const res = await request(app).post("/write").set("Authorization", header).send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AUTH_HEADER");
  });

  it("returns 400 when signature is a number rather than a string", async () => {
    const valid = buildStellarAuthHeader(kp, Date.now());
    const payload = JSON.parse(Buffer.from(valid.split(" ")[1], "base64").toString("utf8"));
    payload.signature = 12345;

    const header = `StellarSig ${Buffer.from(JSON.stringify(payload)).toString("base64")}`;
    const res = await request(app).post("/write").set("Authorization", header).send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AUTH_HEADER");
  });

  it("returns 403 for a future timestamp (replay attack from future)", async () => {
    const authHeader = buildStellarAuthHeader(kp, Date.now() + 999_999);
    const res = await request(app).post("/write").set("Authorization", authHeader).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("INVALID_TIMESTAMP");
  });

  // ── Request binding / replay (issue #1171) ─────────────────────────────────
  //
  // The signature commits to method, path and body, so a captured credential
  // only authorises the exact request it was minted for.

  describe("request binding", () => {
    it("accepts a credential replayed against the request it was minted for → 200", async () => {
      const authHeader = buildStellarAuthHeader(kp, Date.now(), {
        method: "POST",
        path: "/write",
        body: { hello: "world" },
      });
      const res = await request(app)
        .post("/write")
        .set("Authorization", authHeader)
        .send({ hello: "world" });
      expect(res.status).toBe(200);
      expect(res.body.address).toBe(kp.address);
    });

    it("rejects a credential replayed against a different path → 401", async () => {
      // Minted for /write, presented at /other within the tolerance window.
      const authHeader = buildStellarAuthHeader(kp, Date.now(), { path: "/write" });
      const res = await request(app).post("/other").set("Authorization", authHeader).send({});
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_SIGNATURE");
    });

    it("rejects a credential replayed with a different method → 401", async () => {
      const authHeader = buildStellarAuthHeader(kp, Date.now(), { method: "POST" });
      const res = await request(app).put("/write").set("Authorization", authHeader).send({});
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_SIGNATURE");
    });

    it("rejects a credential replayed with a tampered body → 401", async () => {
      const authHeader = buildStellarAuthHeader(kp, Date.now(), {
        body: { followee: "GVICTIM" },
      });
      const res = await request(app)
        .post("/write")
        .set("Authorization", authHeader)
        .send({ followee: "GATTACKER" });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_SIGNATURE");
    });

    it("rejects a credential replayed on the same path after the 30s window → 403", async () => {
      const authHeader = buildStellarAuthHeader(kp, Date.now() - 31_000, { path: "/write" });
      const res = await request(app).post("/write").set("Authorization", authHeader).send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("EXPIRED_TIMESTAMP");
    });

    it("ignores the query string when binding the path → 200", async () => {
      const authHeader = buildStellarAuthHeader(kp, Date.now(), { path: "/write" });
      const res = await request(app)
        .post("/write?trace=1")
        .set("Authorization", authHeader)
        .send({});
      expect(res.status).toBe(200);
    });
  });
});

// ── Signed message format ─────────────────────────────────────────────────────
//
// Pins the wire format itself: reordering or dropping a field has to fail here,
// not just drift silently between signer and verifier.

describe("buildAuthMessage", () => {
  it("lays the message out as v1:METHOD:path:address:timestamp:bodyHash", () => {
    expect(
      buildAuthMessage({
        method: "post",
        canonicalPath: "/api/follows",
        address: "GABC",
        timestamp: 1700000000000,
        bodyHash: "deadbeef",
      })
    ).toBe("v1:POST:/api/follows:GABC:1700000000000:deadbeef");
  });

  it("canonicalises paths by dropping the query string and trailing slash", () => {
    expect(canonicalizeAuthPath("/api/follows?cursor=5")).toBe("/api/follows");
    expect(canonicalizeAuthPath("/api/follows/")).toBe("/api/follows");
    expect(canonicalizeAuthPath("/api/follows")).toBe("/api/follows");
    expect(canonicalizeAuthPath("/")).toBe("/");
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

// ── Replay protection tests (issue #1326) ─────────────────────────────────────
//
// A valid signed request replayed within the 30 s tolerance window must be
// rejected with 403 REPLAYED_SIGNATURE.

describe("requireStellarAuth — replay protection (#1326)", () => {
  let app: express.Express;
  let kp: TestKeypair;

  beforeEach(() => {
    resetRateLimiter();
    clearReplayCache();
    kp = generateTestKeypair();

    app = express();
    app.use(jsonWithRawBody());
    app.use(requestLoggingMiddleware);
    const handler = (req: Request, res: Response): void => {
      res.json({ ok: true, address: req.context?.stellarAddress });
    };
    app.post("/write", requireStellarAuth, handler);
  });

  it("allows a fresh signed request → 200", async () => {
    const authHeader = buildStellarAuthHeader(kp, Date.now());
    const res = await request(app).post("/write").set("Authorization", authHeader).send({});
    expect(res.status).toBe(200);
  });

  it("rejects an identical replayed request within the 30 s window → 403 REPLAYED_SIGNATURE", async () => {
    const authHeader = buildStellarAuthHeader(kp, Date.now());

    // First request: should succeed.
    const first = await request(app).post("/write").set("Authorization", authHeader).send({});
    expect(first.status).toBe(200);

    // Replay: same header, still within the tolerance window.
    const replay = await request(app).post("/write").set("Authorization", authHeader).send({});
    expect(replay.status).toBe(403);
    expect(replay.body.error.code).toBe("REPLAYED_SIGNATURE");
  });

  it("allows a second request signed with a fresh timestamp (different signature) → 200", async () => {
    const header1 = buildStellarAuthHeader(kp, Date.now());
    const first = await request(app).post("/write").set("Authorization", header1).send({});
    expect(first.status).toBe(200);

    // A new signature with a slightly older (but still in-window) timestamp must pass.
    // Using a past offset (not future) so the middleware's age check passes.
    const header2 = buildStellarAuthHeader(kp, Date.now() - 100);
    const second = await request(app).post("/write").set("Authorization", header2).send({});
    expect(second.status).toBe(200);
  });

  it("allows the same request from two different keypairs (distinct signatures) → both 200", async () => {
    const kp2 = generateTestKeypair();
    const header1 = buildStellarAuthHeader(kp, Date.now());
    const header2 = buildStellarAuthHeader(kp2, Date.now());

    const res1 = await request(app).post("/write").set("Authorization", header1).send({});
    const res2 = await request(app).post("/write").set("Authorization", header2).send({});
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });
});

// ── Auth rate-limit ordering tests (issue #1325) ──────────────────────────────
//
// `optionalStellarAuth` must run before the read rate limiter so authenticated
// requests are counted against the per-address bucket (300 RPM) instead of the
// anon IP bucket (100 RPM).

describe("optionalStellarAuth + rateLimitRead ordering (#1325)", () => {
  let app: express.Express;
  let kp: TestKeypair;

  beforeEach(() => {
    resetRateLimiter();
    clearReplayCache();
    kp = generateTestKeypair();

    app = express();
    app.set("trust proxy", 1);
    app.use(requestLoggingMiddleware);
    app.use(jsonWithRawBody());

    // Mirror the fixed production ordering: optional auth → rate limit → handler.
    app.get(
      "/api/profiles",
      optionalStellarAuth,
      rateLimitRead,
      (_req: Request, res: Response) => {
        res.json({ ok: true });
      }
    );
  });

  it("anonymous request (no auth header) is keyed by IP and hits anon bucket (100 RPM)", async () => {
    const ip = "10.2.0.1";
    const headers = { "x-forwarded-for": ip };

    for (let i = 0; i < 100; i++) {
      const res = await request(app).get("/api/profiles").set(headers);
      expect(res.status).toBe(200);
    }

    const over = await request(app).get("/api/profiles").set(headers);
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe("RATE_LIMITED");
  }, 30_000);

  it("authenticated read is keyed by address and uses the higher auth bucket (300 RPM)", async () => {
    const ip = "10.2.0.2";

    // Build auth headers for a GET request to /api/profiles.
    // Each request needs a fresh timestamp so each header has a unique signature.
    // We issue 101 requests — if the limiter were using the anon IP bucket (100 RPM)
    // the 101st would fail; with the auth bucket (300 RPM) it must still pass.
    for (let i = 0; i < 101; i++) {
      const authHeader = buildStellarAuthHeader(kp, Date.now() - i, {
        method: "GET",
        path: "/api/profiles",
        body: null,
      });
      const res = await request(app)
        .get("/api/profiles")
        .set("Authorization", authHeader)
        .set("x-forwarded-for", ip);
      expect(res.status).toBe(200);
    }
  }, 30_000);

  it("anon and auth counters are independent — exhausting one does not affect the other", async () => {
    const anonIp = "10.2.0.3";

    // Exhaust the anon bucket for anonIp.
    for (let i = 0; i < 100; i++) {
      await request(app).get("/api/profiles").set("x-forwarded-for", anonIp);
    }
    const anonOver = await request(app).get("/api/profiles").set("x-forwarded-for", anonIp);
    expect(anonOver.status).toBe(429);

    // Authenticated request from the same IP should still pass (different key).
    const authHeader = buildStellarAuthHeader(kp, Date.now(), {
      method: "GET",
      path: "/api/profiles",
      body: null,
    });
    const authRes = await request(app)
      .get("/api/profiles")
      .set("Authorization", authHeader)
      .set("x-forwarded-for", anonIp);
    expect(authRes.status).toBe(200);
  }, 30_000);
});
