/**
 * Linkora Analytics Oracle
 *
 * Runs on a ledger-window schedule:
 *   1. Queries the indexer PostgreSQL DB for per-creator activity in the window.
 *   2. Encodes each creator's analytics as a CBOR report.
 *   3. Signs the SHA-256 of the CBOR with the oracle Ed25519 key.
 *   4. Submits `verify_analytics_attestation` to the Soroban contract.
 *   5. Caches the latest signed attestation per creator.
 *
 * Exposes GET /attestations/:creator returning the latest signed report + signature.
 */

import express from "express";
import { Pool } from "pg";
import { Keypair } from "@stellar/stellar-sdk";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha512";
import { encodeReport } from "./codec.js";
import { signReport } from "./signer.js";
import { fetchCreatorStats } from "./db.js";
import { submitAttestation } from "./submitter.js";
import { AnalyticsReport, SignedAttestation } from "./types.js";

// Wire sha512 for @noble/ed25519 synchronous API
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

// ── Config ────────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const DATABASE_URL = requireEnv("DATABASE_URL");
const SOROBAN_RPC_URL = requireEnv("SOROBAN_RPC_URL");
const CONTRACT_ID = requireEnv("CONTRACT_ID");
const ORACLE_PRIVATE_KEY_HEX = requireEnv("ORACLE_PRIVATE_KEY_HEX");
const ORACLE_NAME = process.env["ORACLE_NAME"] ?? "default";
const WINDOW_LEDGERS = BigInt(process.env["WINDOW_LEDGERS"] ?? "1000");
const PORT = parseInt(process.env["PORT"] ?? "4000", 10);
const NETWORK_PASSPHRASE =
  process.env["NETWORK_PASSPHRASE"] ?? "Test SDF Network ; September 2015";

// ── Init ──────────────────────────────────────────────────────────────────────

const oraclePrivateKey = Buffer.from(ORACLE_PRIVATE_KEY_HEX, "hex");
// Stellar keypair derived from the same 32-byte seed for fee payment.
const oracleKeypair = Keypair.fromRawEd25519Seed(oraclePrivateKey);

const db = new Pool({ connectionString: DATABASE_URL });

// In-memory cache: creator address -> latest attestation
const attestationCache = new Map<string, SignedAttestation>();

// ── Analytics loop ────────────────────────────────────────────────────────────

let lastWindowEnd = BigInt(0);

async function runWindow(windowStart: bigint, windowEnd: bigint): Promise<void> {
  console.log(`[oracle] computing analytics for ledgers ${windowStart}–${windowEnd}`);

  const stats = await fetchCreatorStats(db, windowStart, windowEnd);
  if (stats.length === 0) {
    console.log("[oracle] no active creators in window, skipping");
    return;
  }

  for (const s of stats) {
    // Decode the creator's Stellar address to its raw 32-byte public key.
    let creatorBytes: Uint8Array;
    try {
      creatorBytes = Keypair.fromPublicKey(s.creatorAddress).rawPublicKey();
    } catch {
      console.warn(`[oracle] skipping invalid address: ${s.creatorAddress}`);
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
    const { signature, reportHash } = signReport(reportCbor, oraclePrivateKey);

    // Submit on-chain.
    let txHash: string;
    try {
      txHash = await submitAttestation(
        SOROBAN_RPC_URL,
        NETWORK_PASSPHRASE,
        CONTRACT_ID,
        ORACLE_NAME,
        reportCbor,
        signature,
        oracleKeypair,
        s.creatorAddress,
        windowStart,
        windowEnd
      );
      console.log(
        `[oracle] attested ${s.creatorAddress} tx=${txHash}`
      );
    } catch (err) {
      console.error(`[oracle] submission failed for ${s.creatorAddress}:`, err);
      continue;
    }

    // Cache for API.
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
  const windowStart = lastWindowEnd === BigInt(0) ? currentLedger - WINDOW_LEDGERS : lastWindowEnd + BigInt(1);
  const windowEnd = currentLedger;

  if (windowEnd <= windowStart) {
    return;
  }

  lastWindowEnd = windowEnd;
  await runWindow(windowStart, windowEnd);
}

// ── REST API ──────────────────────────────────────────────────────────────────

const app = express();

/**
 * GET /attestations/:creator
 * Returns the latest signed attestation for a creator address.
 */
app.get("/attestations/:creator", (req, res) => {
  const att = attestationCache.get(req.params["creator"] ?? "");
  if (!att) {
    res.status(404).json({ error: "no attestation found for this creator" });
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

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const pubkeyHex = Buffer.from(ed.getPublicKey(oraclePrivateKey)).toString("hex");
  console.log(`[oracle] public key: ${pubkeyHex}`);
  console.log(`[oracle] stellar address: ${oracleKeypair.publicKey()}`);
  console.log(`[oracle] contract: ${CONTRACT_ID}`);
  console.log(`[oracle] window: ${WINDOW_LEDGERS} ledgers`);

  app.listen(PORT, () => console.log(`[oracle] API listening on :${PORT}`));

  // Poll every WINDOW_LEDGERS * 5s for simplicity. In production, subscribe
  // to the indexer's event bus WebSocket for exact ledger-close events.
  const pollMs = Number(WINDOW_LEDGERS) * 5_000;
  console.log(`[oracle] polling every ${pollMs / 1000}s`);

  const { rpc: StellarRpc } = await import("@stellar/stellar-sdk");
  const server = new StellarRpc.Server(SOROBAN_RPC_URL);

  const tick = async () => {
    try {
      const info = await server.getLatestLedger();
      await scheduleLoop(BigInt(info.sequence));
    } catch (err) {
      console.error("[oracle] tick error:", err);
    }
  };

  // Run once immediately, then on interval.
  await tick();
  setInterval(tick, pollMs);
}

main().catch((err) => {
  console.error("[oracle] fatal:", err);
  process.exit(1);
});
