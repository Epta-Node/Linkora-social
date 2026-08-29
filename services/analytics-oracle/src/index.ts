import express, { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { Pool } from "pg";
import { Keypair, rpc as StellarRpc } from "@stellar/stellar-sdk";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { randomUUID } from "crypto";
import { encodeReport } from "./codec.js";
import { Signer } from "./signer.js";
import { fetchCreatorStats } from "./db.js";
import { submitAttestation } from "./submitter.js";
import { AnalyticsReport, SignedAttestation } from "./types.js";
import { logger } from "./logger.js";
import { rateLimiter, initRateLimiter } from "./middleware/rate-limiter.js";
import { loadRateLimitConfig } from "./config.js";
import { createHealthRouter } from "./routes/health.js";
import { createAdminRouter } from "./routes/admin.js";
import { validateParams } from "./middleware/validate.js";
import { AttestationCache } from "./attestation-cache.js";
import { createKeystore, Keystore } from "./secrets.js";
import { z } from "zod";
import { notFoundError, isAppError } from "@linkora/types/src/errors.js";

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

// Validate the rate-limiting environment before anything else binds a port:
// this throws when NODE_ENV=production and no shared Redis store is
// configured, so a scaled deployment can never boot with per-replica limits.
loadRateLimitConfig();

const DATABASE_URL = requireEnv("DATABASE_URL");
const SOROBAN_RPC_URL = requireEnv("SOROBAN_RPC_URL");
const CONTRACT_ID = requireEnv("CONTRACT_ID");
const ORACLE_NAME = process.env["ORACLE_NAME"] ?? "default";
const WINDOW_LEDGERS = BigInt(process.env["WINDOW_LEDGERS"] ?? "1000");
const PORT = parseInt(process.env["PORT"] ?? "4000", 10);
const NETWORK_PASSPHRASE = process.env["NETWORK_PASSPHRASE"] ?? "Test SDF Network ; September 2015";
const ATTESTATION_CACHE_MAX_SIZE = parseInt(
  process.env["ATTESTATION_CACHE_MAX_SIZE"] ?? "10000",
  10
);
const ATTESTATION_CACHE_TTL_MS = parseInt(process.env["ATTESTATION_CACHE_TTL_MS"] ?? "3600000", 10);
const SHUTDOWN_DRAIN_TIMEOUT_MS = parseInt(process.env["SHUTDOWN_DRAIN_TIMEOUT_MS"] ?? "30000", 10);

// Load the signing key from the configured secrets backend (a mounted secret
// file, or — for local dev only — an env var). The raw bytes are handed to the
// Signer and immediately zeroed on the heap, so they do not persist in memory.
const keystore: Keystore = createKeystore();
const oracleSeed = keystore.loadSeed();
const oracleSigner = new Signer(oracleSeed);
keystore.zeroise();

const db = new Pool({ connectionString: DATABASE_URL });

/** Shared rpc.Server instance — created once at startup and reused for all
 *  Soroban RPC calls (ledger polling + attestation submission). */
const rpcServer = new StellarRpc.Server(SOROBAN_RPC_URL);

const attestationCache = new AttestationCache<SignedAttestation>({
  maxSize: ATTESTATION_CACHE_MAX_SIZE,
  ttlMs: ATTESTATION_CACHE_TTL_MS,
});

// Bind the cache to the current signer key. If the key rotates (reload of the
// signing key), calling setSignerId again with the new fingerprint clears every
// cached signature produced under the previous key.
const signerId = oracleSigner.fingerprint();
attestationCache.setSignerId(signerId);

let lastWindowEnd = BigInt(0);

function generateRequestId(): string {
  return randomUUID();
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

async function runWindow(windowStart: bigint, windowEnd: bigint): Promise<void> {
  logger.info(
    { windowStart: windowStart.toString(), windowEnd: windowEnd.toString() },
    "Computing analytics for ledger window"
  );

  const stats = await fetchCreatorStats(db, windowStart, windowEnd);
  if (stats.length === 0) {
    logger.info(
      { windowStart: windowStart.toString(), windowEnd: windowEnd.toString() },
      "No active creators in window, skipping"
    );
    return;
  }

  for (const s of stats) {
    let creatorBytes: Uint8Array;
    try {
      creatorBytes = Keypair.fromPublicKey(s.creatorAddress).rawPublicKey();
    } catch {
      logger.warn({ creatorAddress: s.creatorAddress }, "Skipping invalid address");
      continue;
    }

    const report: AnalyticsReport = {
      version: 1,
      creator: creatorBytes,
      windowStart,
      windowEnd,
      totalTips: s.totalTips,
      postCount: s.postCount,
      followerDelta: s.followerDelta,
      uniqueTippers: s.uniqueTippers,
    };

    const reportCbor = encodeReport(report);
    const { signature, reportHash } = oracleSigner.signReport(reportCbor);

    // Audit log: every signing includes the public-key fingerprint and the
    // ledger window, never the private key material.
    logger.info(
      {
        fingerprint: oracleSigner.fingerprint(),
        creatorAddress: s.creatorAddress,
        windowStart: windowStart.toString(),
        windowEnd: windowEnd.toString(),
        reportHash: reportHash.toString("hex"),
      },
      "Attestation signed"
    );

    let txHash: string;
    try {
      txHash = await submitAttestation(
        rpcServer,
        NETWORK_PASSPHRASE,
        CONTRACT_ID,
        ORACLE_NAME,
        reportCbor,
        signature,
        oracleSigner.keypair(),
        s.creatorAddress,
        windowStart,
        windowEnd
      );
      logger.info({ creatorAddress: s.creatorAddress, txHash }, "Creator attested");
    } catch (err) {
      logger.error({ creatorAddress: s.creatorAddress, err }, "Attestation submission failed");
      continue;
    }

    attestationCache.set(s.creatorAddress, {
      oracleName: ORACLE_NAME,
      reportCbor,
      reportHash: reportHash.toString("hex"),
      signature,
      txHash,
      report,
      submittedAt: Date.now(),
    });
  }
}

async function scheduleLoop(currentLedger: bigint): Promise<void> {
  const windowStart =
    lastWindowEnd === BigInt(0) ? currentLedger - WINDOW_LEDGERS : lastWindowEnd + BigInt(1);
  const windowEnd = currentLedger;

  if (windowEnd <= windowStart) {
    return;
  }

  // Window-start invalidation: cached attestations reference the *previous*
  // report window, which is now closed. Drop them so a stale attestation is
  // never served once the oracle begins covering the new window.
  attestationCache.beginWindow(windowStart, windowEnd);

  lastWindowEnd = windowEnd;
  await runWindow(windowStart, windowEnd);
}

const app = express();
app.use(helmet());
app.set("trust proxy", 1); // trust first proxy
const startTime = Date.now();

let started = false;
let startedAt: string | null = null;
let shuttingDown = false;

function markStarted(): void {
  if (started) return;
  started = true;
  startedAt = new Date().toISOString();
}

function requestIdMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const existing = req.headers["x-request-id"];
  const raw = Array.isArray(existing) ? existing[0] : existing;
  const id = (typeof raw === "string" ? raw : null) ?? generateRequestId();
  req.requestId = id;
  next();
}

// ── Health endpoints ──────────────────────────────────────────────────────────
// Liveness / readiness / startup probes — see routes/health.ts for details.

app.use(requestIdMiddleware);

app.use(
  createHealthRouter({
    db,
    rpcUrl: SOROBAN_RPC_URL,
    startTime,
    isStarted: () => started,
    startedAt: () => startedAt,
    isShuttingDown: () => shuttingDown,
  })
);

// Per-IP rate limiting applied to attestation-serving endpoints. See
// services/analytics-oracle/src/middleware/rate-limiter.ts and config.ts.
app.use(rateLimiter);

const creatorParamsSchema = z.object({
  creator: z.string().regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar address format"),
});

app.get("/attestations/:creator", validateParams(creatorParamsSchema), (req, res) => {
  const { creator } = req.params;
  const att = attestationCache.get(creator as string);
  if (!att) {
    const err = notFoundError("no attestation found for this creator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res.status(err.statusCode).json(err.toJSON((req as any).requestId));
    return;
  }

  res.json({
    oracleName: att.oracleName,
    reportHash: att.reportHash,
    reportCbor: att.reportCbor.toString("hex"),
    signature: att.signature.toString("hex"),
    txHash: att.txHash,
    submittedAt: att.submittedAt,
    report: {
      version: att.report.version,
      creator: Buffer.from(att.report.creator).toString("hex"),
      windowStart: att.report.windowStart.toString(),
      windowEnd: att.report.windowEnd.toString(),
      totalTips: att.report.totalTips.toString(),
      postCount: att.report.postCount.toString(),
      followerDelta: att.report.followerDelta.toString(),
      uniqueTippers: att.report.uniqueTippers,
    },
  });
});

app.get("/metrics/cache", (_req, res) => {
  res.json(attestationCache.getStats());
});

// ── Admin endpoints ───────────────────────────────────────────────────────────
// Authenticated key-rotation API. Only reachable with a valid ADMIN_SECRET.

app.use(
  createAdminRouter({
    signer: oracleSigner,
    keystore,
    invalidateCache: (fingerprint) => attestationCache.setSignerId(fingerprint),
    isReady: () => started,
  })
);

// ── Bootstrap ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
app.use((err: Error, req: any, res: Response, _next: NextFunction): void => {
  logger.error({ requestId: req.requestId, err }, "Unhandled error");

  const statusCode = isAppError(err) ? err.statusCode : 500;
  const code = isAppError(err) ? err.code : "INTERNAL_ERROR";
  const message = process.env.NODE_ENV === "development" ? err.message : "Internal server error";

  res.status(statusCode).json({
    error: {
      code,
      message,
      requestId: req.requestId,
    },
  });
});

async function main(): Promise<void> {
  const stellarAddress = oracleSigner.stellarPublicKey();
  logger.info(
    {
      pubkeyHex: oracleSigner.fingerprint(),
      stellarAddress,
      contractId: CONTRACT_ID,
      windowLedgers: WINDOW_LEDGERS.toString(),
      cacheMaxSize: ATTESTATION_CACHE_MAX_SIZE,
      cacheTtlMs: ATTESTATION_CACHE_TTL_MS,
      keySource: keystore.source,
    },
    "Oracle starting"
  );

  // Initialise rate limiter (upgrades to Redis store when REDIS_URL is set).
  await initRateLimiter();

  const httpServer = app.listen(PORT, () => {
    logger.info({ port: PORT }, "Oracle API listening");
    markStarted();
  });

  let pollInterval: ReturnType<typeof setInterval> | null = null;
  // Promise for the window tick currently in flight, so shutdown can wait for
  // in-progress attestation submissions to complete before closing resources.
  let currentTick: Promise<void> = Promise.resolve();

  async function gracefulShutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(
      { signal, drainTimeoutMs: SHUTDOWN_DRAIN_TIMEOUT_MS },
      "Oracle shutting down — failing readiness probe"
    );

    // Force-exit if draining takes longer than the configured timeout.
    const forceExitTimer = setTimeout(() => {
      logger.error(
        { drainTimeoutMs: SHUTDOWN_DRAIN_TIMEOUT_MS },
        "Drain timeout exceeded — forcing exit"
      );
      process.exit(1);
    }, SHUTDOWN_DRAIN_TIMEOUT_MS);
    forceExitTimer.unref();

    try {
      // 1. Stop scheduling new window ticks.
      if (pollInterval !== null) {
        clearInterval(pollInterval);
        pollInterval = null;
      }

      // 2. Stop accepting new HTTP connections and drain existing ones.
      const httpClosed = new Promise<void>((resolve) => {
        httpServer.close((err) => {
          if (err) logger.warn({ err }, "Error while closing HTTP server");
          resolve();
        });
      });

      // 3. Wait for the in-flight window tick (attestation submissions) to
      //    finish. tick() handles its own errors, but guard anyway.
      await currentTick.catch(() => undefined);
      logger.info("In-flight window tick completed");

      await httpClosed;
      logger.info("HTTP server closed");

      // 4. Close the PostgreSQL pool once nothing can issue new queries.
      await db.end();
      logger.info("PostgreSQL pool closed");

      // 5. Zero the private key off the heap before exiting.
      oracleSigner.dispose();
      keystore.zeroise();

      clearTimeout(forceExitTimer);
      logger.info({ signal }, "Graceful shutdown complete");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error during graceful shutdown");
      process.exit(1);
    }
  }
  process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => void gracefulShutdown("SIGINT"));

  const pollMs = Number(WINDOW_LEDGERS) * 5_000;
  logger.info({ pollIntervalMs: pollMs }, "Oracle polling interval set");

  // Periodically sweep stale TTL entries so memory is reclaimed even for
  // creators that are never queried again after their attestation is stored.
  // Run every quarter of the TTL (minimum every 5 minutes).
  const purgeIntervalMs = Math.max(ATTESTATION_CACHE_TTL_MS / 4, 5 * 60 * 1000);
  setInterval(() => {
    const evicted = attestationCache.purgeExpired();
    if (evicted > 0) {
      logger.info({ evicted, ...attestationCache.getStats() }, "Attestation cache TTL sweep");
    }
  }, purgeIntervalMs).unref(); // unref so the timer does not prevent clean shutdown

  const tick = async () => {
    try {
      const info = await rpcServer.getLatestLedger();
      await scheduleLoop(BigInt(info.sequence));
    } catch (err) {
      logger.error({ err }, "Oracle tick error");
    }
  };

  // Track the running tick so gracefulShutdown can await its completion.
  const runTick = (): Promise<void> => {
    if (shuttingDown) return currentTick;
    currentTick = tick();
    return currentTick;
  };

  await runTick();
  pollInterval = setInterval(() => void runTick(), pollMs);
}

main().catch((err) => {
  logger.error({ err }, "Oracle fatal error");
  keystore.zeroise();
  oracleSigner.dispose();
  process.exit(1);
});
