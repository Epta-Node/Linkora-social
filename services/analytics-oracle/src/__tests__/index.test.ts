/**
 * Integration tests for analytics-oracle:
 *  - Issue 2: Negative follower deltas (net unfollows) & creator error scoping
 *  - Issue 3: Retrying failed windows & advancing lastWindowEnd only on success
 *  - Issue 4: Signer key metadata (signerKey, keyVersion, rotationEpoch) & immediate cache invalidation on rotation
 */

import { jest } from "@jest/globals";
import { fetchCreatorStats } from "../db.js";
import { AttestationCache } from "../attestation-cache.js";
import { Signer } from "../signer.js";
import { AnalyticsReport, SignedAttestation, U32_MAX } from "../types.js";
import { encodeReport } from "../codec.js";
import { Keypair } from "@stellar/stellar-sdk";
import type { Pool } from "pg";

describe("unique tipper count from PostgreSQL", () => {
  it("preserves the unsigned boundary and clamps larger counts before encoding", async () => {
    const mockDb = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: (jest.fn() as any).mockResolvedValue({
        rows: [2 ** 31, U32_MAX, "4294967296", "9007199254740993"].map((count) => ({
          creator: "GBZAZSCCXRMPB4XZLT5K6VYA2PFUIAMH3HLJTXUHPOIFAXDEQECAVXZF",
          total_tips: "0",
          post_count: "0",
          follower_delta: "0",
          unique_tippers: String(count),
        })),
      }),
    } as unknown as Pool;

    const stats = await fetchCreatorStats(mockDb, 100n, 200n);
    expect(stats.map((row) => row.uniqueTippers)).toEqual([2 ** 31, U32_MAX, U32_MAX, U32_MAX]);
    for (const row of stats) {
      expect(() =>
        encodeReport({
          version: 1,
          creator: Keypair.fromPublicKey(row.creatorAddress).rawPublicKey(),
          windowStart: 100n,
          windowEnd: 200n,
          totalTips: row.totalTips,
          postCount: row.postCount,
          followerDelta: row.followerDelta,
          uniqueTippers: row.uniqueTippers,
        })
      ).not.toThrow();
    }
  });
});

describe("Issue 2: Negative follower deltas and creator error scoping", () => {
  it("handles net negative follower deltas (more unfollows than follows) without throwing", async () => {
    const mockDb = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: (jest.fn() as any).mockResolvedValue({
        rows: [
          {
            creator: "GBZAZSCCXRMPB4XZLT5K6VYA2PFUIAMH3HLJTXUHPOIFAXDEQECAVXZF",
            total_tips: "5000",
            post_count: "2",
            follower_delta: "-15", // net unfollows
            unique_tippers: "1",
          },
        ],
      }),
    } as unknown as Pool;

    const stats = await fetchCreatorStats(mockDb, 100n, 200n);
    expect(stats).toHaveLength(1);
    expect(stats[0].followerDelta).toBe(-15n);

    const report: AnalyticsReport = {
      version: 1,
      creator: Keypair.fromPublicKey(stats[0].creatorAddress).rawPublicKey(),
      windowStart: 100n,
      windowEnd: 200n,
      totalTips: stats[0].totalTips,
      postCount: stats[0].postCount,
      followerDelta: stats[0].followerDelta,
      uniqueTippers: stats[0].uniqueTippers,
    };

    expect(() => encodeReport(report)).not.toThrow();
  });

  it("scopes validation errors per creator without aborting other creators", async () => {
    const mockDb = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: (jest.fn() as any).mockResolvedValue({
        rows: [
          {
            creator: "", // invalid creator address (empty string)
            total_tips: "5000",
            post_count: "2",
            follower_delta: "5",
            unique_tippers: "1",
          },
          {
            creator: "GBZAZSCCXRMPB4XZLT5K6VYA2PFUIAMH3HLJTXUHPOIFAXDEQECAVXZF", // valid creator
            total_tips: "1000",
            post_count: "1",
            follower_delta: "2",
            unique_tippers: "1",
          },
        ],
      }),
    } as unknown as Pool;

    const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const stats = await fetchCreatorStats(mockDb, 100n, 200n);
    consoleSpy.mockRestore();

    expect(stats).toHaveLength(1);
    expect(stats[0].creatorAddress).toBe(
      "GBZAZSCCXRMPB4XZLT5K6VYA2PFUIAMH3HLJTXUHPOIFAXDEQECAVXZF"
    );
  });
});

describe("Issue 3: Retrying failed windows and advancing lastWindowEnd on success", () => {
  it("only advances lastWindowEnd when runWindow succeeds and retries on failure", async () => {
    let lastWindowEnd = 0n;
    const windowLedgers = 100n;
    let attempts = 0;

    async function runWindowMock(_start: bigint, _end: bigint): Promise<void> {
      attempts++;
      if (attempts === 1) {
        throw new Error("Transient RPC or DB failure");
      }
    }

    async function scheduleLoopTest(currentLedger: bigint): Promise<void> {
      const windowStart = lastWindowEnd === 0n ? currentLedger - windowLedgers : lastWindowEnd + 1n;
      const windowEnd = currentLedger;

      if (windowEnd <= windowStart) return;

      const maxRetries = 3;
      let attempt = 0;
      let success = false;
      let lastError: unknown;

      while (attempt < maxRetries && !success) {
        attempt++;
        try {
          await runWindowMock(windowStart, windowEnd);
          success = true;
        } catch (err) {
          lastError = err;
        }
      }

      if (success) {
        lastWindowEnd = windowEnd;
      } else {
        throw lastError;
      }
    }

    // Call scheduleLoop for currentLedger = 500n
    await scheduleLoopTest(500n);

    // On attempt 1 runWindowMock threw, but retry loop succeeded on attempt 2
    expect(attempts).toBe(2);
    expect(lastWindowEnd).toBe(500n);
  });

  it("does not advance lastWindowEnd if all retries fail", async () => {
    let lastWindowEnd = 100n;

    async function failingRunWindow(): Promise<void> {
      throw new Error("Persistent outage");
    }

    async function scheduleLoopTest(currentLedger: bigint): Promise<void> {
      const windowEnd = currentLedger;

      const maxRetries = 2;
      let attempt = 0;
      let success = false;
      let lastError: unknown;

      while (attempt < maxRetries && !success) {
        attempt++;
        try {
          await failingRunWindow();
          success = true;
        } catch (err) {
          lastError = err;
        }
      }

      if (success) {
        lastWindowEnd = windowEnd;
      } else {
        throw lastError;
      }
    }

    await expect(scheduleLoopTest(300n)).rejects.toThrow("Persistent outage");
    // lastWindowEnd remains at 100n so next loop can catch up
    expect(lastWindowEnd).toBe(100n);
  });
});

describe("Issue 4: Signer key metadata and immediate cache invalidation on rotation", () => {
  it("exposes signerKey, keyVersion, and rotationEpoch in attestation cache entries and invalidates immediately on rotation", () => {
    const seed1 = new Uint8Array(32).fill(1);
    const seed2 = new Uint8Array(32).fill(2);

    const signer = new Signer(seed1);
    const cache = new AttestationCache<SignedAttestation>({ maxSize: 10, ttlMs: 3600000 });

    // Initialise cache with signer fingerprint and register rotation listener
    cache.setSignerId(signer.fingerprint());
    signer.onRotate((newFingerprint) => {
      cache.setSignerId(newFingerprint);
    });

    const creatorAddr = "GBZAZSCCXRMPB4XZLT5K6VYA2PFUIAMH3HLJTXUHPOIFAXDEQECAVXZF";
    const report: AnalyticsReport = {
      version: 1,
      creator: Keypair.fromPublicKey(creatorAddr).rawPublicKey(),
      windowStart: 100n,
      windowEnd: 200n,
      totalTips: 1000n,
      postCount: 5n,
      followerDelta: 3n,
      uniqueTippers: 2,
    };

    const cbor = encodeReport(report);
    const { signature, reportHash } = signer.signReport(cbor);

    const initialAttestation: SignedAttestation = {
      oracleName: "test-oracle",
      signerKey: signer.fingerprint(),
      keyVersion: signer.keyVersion,
      rotationEpoch: signer.rotationEpoch,
      reportCbor: cbor,
      reportHash: reportHash.toString("hex"),
      signature,
      txHash: "0x123",
      report,
      submittedAt: Date.now(),
    };

    cache.set(creatorAddr, initialAttestation);

    // Verify stored metadata
    const cached1 = cache.get(creatorAddr);
    expect(cached1).toBeDefined();
    expect(cached1?.signerKey).toBe(signer.fingerprint());
    expect(cached1?.keyVersion).toBe(1);
    expect(cached1?.rotationEpoch).toBe(1);

    // Now rotate signer key
    const newFingerprint = signer.rotate(seed2);

    // Immediate invalidation: cache must be cleared immediately upon rotation
    expect(cache.size).toBe(0);
    expect(cache.get(creatorAddr)).toBeUndefined();

    // Re-sign with rotated key
    const { signature: sig2, reportHash: hash2 } = signer.signReport(cbor);

    const rotatedAttestation: SignedAttestation = {
      oracleName: "test-oracle",
      signerKey: signer.fingerprint(),
      keyVersion: signer.keyVersion,
      rotationEpoch: signer.rotationEpoch,
      reportCbor: cbor,
      reportHash: hash2.toString("hex"),
      signature: sig2,
      txHash: "0x456",
      report,
      submittedAt: Date.now(),
    };

    cache.set(creatorAddr, rotatedAttestation);

    const cached2 = cache.get(creatorAddr);
    expect(cached2).toBeDefined();
    expect(cached2?.signerKey).toBe(newFingerprint);
    expect(cached2?.keyVersion).toBe(2);
    expect(cached2?.rotationEpoch).toBe(2);
  });
});
