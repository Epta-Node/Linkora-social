/**
 * Tests for submitAttestation — verifies that the rpc.Server instance is
 * accepted as a parameter and reused across multiple calls (not recreated),
 * and that a fresh LedgerFootprint is re-derived on every submission with a
 * warning surfaced when the footprint grows between attestations.
 */

import { submitAttestation, resetFootprintTracking } from "../submitter.js";
import { rpc, Keypair, Contract, SorobanDataBuilder, StrKey, xdr } from "@stellar/stellar-sdk";
import { logger } from "../logger.js";
import { jest } from "@jest/globals";

// ── helpers ───────────────────────────────────────────────────────────────────

// A valid contract ID used as the target of every submitAttestation call.
const CONTRACT_ID = "CAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABDQF";

// Pre-generate distinct valid contract IDs so each simulated footprint can
// reference a different set of real ledger entries.
const CONTRACT_IDS = Array.from({ length: 64 }, (_, i) => {
  const raw = Buffer.alloc(32);
  raw.writeUInt32BE(i + 1, 0);
  return StrKey.encodeContract(raw);
});

/** Build a distinct, real xdr.LedgerKey (contract data) from a contract index. */
function ledgerKeyFor(idx: number): xdr.LedgerKey {
  return new Contract(CONTRACT_IDS[idx]).getFootprint();
}

/**
 * Build a real simulation response whose footprint references `roCount`
 * read-only and `rwCount` read-write ledger keys. The `iteration` is folded
 * into the key selection so consecutive submissions produce a fresh footprint,
 * mimicking a server whose contract state advances each time.
 */
function buildSimulation(roCount: number, rwCount: number, iteration: number) {
  const data = new SorobanDataBuilder();
  const readOnly: xdr.LedgerKey[] = [];
  const readWrite: xdr.LedgerKey[] = [];
  for (let i = 0; i < roCount; i++) {
    readOnly.push(ledgerKeyFor(iteration * 10 + i));
  }
  for (let i = 0; i < rwCount; i++) {
    readWrite.push(ledgerKeyFor(20 + iteration * 10 + i));
  }
  data.setReadOnly(readOnly).setReadWrite(readWrite);
  return {
    _parsed: true,
    transactionData: data,
    minResourceFee: "0",
    result: { auth: [] },
  };
}

/**
 * Build a minimal mock rpc.Server that records how many times it is used and
 * returns a distinct simulated footprint on each call, so tests can assert the
 * footprint is re-derived per submission rather than reused.
 */
function mockServer(): rpc.Server & {
  callCount: number;
  simulateCalls: number;
  setFootprintKeys: (readOnlyCount: number, readWriteCount: number) => void;
} {
  const account = {
    accountId: () => "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    sequenceNumber: () => "100",
    incrementSequenceNumber: () => {},
    sequence: "100",
  };

  let readOnlyCount = 1;
  let readWriteCount = 1;

  const mock = {
    callCount: 0,
    simulateCalls: 0,
    setFootprintKeys: (ro: number, rw: number) => {
      readOnlyCount = ro;
      readWriteCount = rw;
    },
    getAccount: jest.fn(async () => {
      mock.callCount++;
      return account;
    }),
    // Each call re-simulates and returns a *fresh* footprint derived from the
    // current key counts and the call counter, so the footprint is always
    // re-derived rather than reused from a previous submission.
    simulateTransaction: jest.fn(async () => {
      mock.simulateCalls++;
      return buildSimulation(readOnlyCount, readWriteCount, mock.simulateCalls);
    }),
    sendTransaction: jest.fn(async () => ({ hash: "mock-tx-hash" })),
    pollTransaction: jest.fn(async () => ({ status: "SUCCESS" })),
  };

  return mock as unknown as rpc.Server & typeof mock;
}

function makeKeypair(): Keypair {
  return Keypair.random();
}

// Spy on the real logger's `warn` to capture growth warnings without letting
// pino write to the test output.
const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => logger);

beforeEach(() => {
  resetFootprintTracking();
  warnSpy.mockClear();
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("submitAttestation — rpc.Server reuse", () => {
  it("accepts an rpc.Server instance and uses it without creating a new one", async () => {
    const server = mockServer();
    const keypair = makeKeypair();

    await submitAttestation(
      server,
      "Test SDF Network ; September 2015",
      CONTRACT_ID,
      "oracle",
      Buffer.from("report"),
      Buffer.from("signature"),
      keypair,
      keypair.publicKey(),
      1000n,
      2000n
    );

    // The server's getAccount was called — confirming the passed instance was used
    expect(server.getAccount).toHaveBeenCalledTimes(1);
    expect(server.simulateTransaction).toHaveBeenCalledTimes(1);
    expect(server.sendTransaction).toHaveBeenCalledTimes(1);
  });

  it("reuses the same server instance across multiple submitAttestation calls", async () => {
    const server = mockServer();
    const keypair = makeKeypair();

    const args = [
      server,
      "Test SDF Network ; September 2015",
      CONTRACT_ID,
      "oracle",
      Buffer.from("report"),
      Buffer.from("sig"),
      keypair,
    ] as const;

    await submitAttestation(...args, keypair.publicKey(), 1000n, 2000n);
    await submitAttestation(...args, keypair.publicKey(), 2001n, 3000n);
    await submitAttestation(...args, keypair.publicKey(), 3001n, 4000n);

    // getAccount called once per submission — all on the same server instance
    expect(server.getAccount).toHaveBeenCalledTimes(3);
    expect(server.callCount).toBe(3);

    // All three calls went to the exact same mock object
    const allCalls = (server.getAccount as unknown as jest.Mock).mock.instances;
    expect(allCalls.every((inst) => inst === server)).toBe(true);
  });
});

describe("submitAttestation — fresh footprint per submission", () => {
  it("re-simulates on every submission, re-deriving the footprint (not reusing it)", async () => {
    const server = mockServer();
    const keypair = makeKeypair();

    const args = [
      server,
      "Test SDF Network ; September 2015",
      CONTRACT_ID,
      "oracle",
      Buffer.from("report"),
      Buffer.from("sig"),
      keypair,
    ] as const;

    // Footprint changes between submissions (contract state evolved).
    await submitAttestation(...args, keypair.publicKey(), 1000n, 2000n);
    server.setFootprintKeys(2, 1);
    await submitAttestation(...args, keypair.publicKey(), 2001n, 3000n);

    // Each submission triggered its own fresh simulation — the footprint was
    // re-derived rather than carried over from the previous submission.
    expect(server.simulateTransaction).toHaveBeenCalledTimes(2);
  });

  it("surfaces a warning when the freshly derived footprint grows", async () => {
    const server = mockServer();
    const keypair = makeKeypair();

    const args = [
      server,
      "Test SDF Network ; September 2015",
      CONTRACT_ID,
      "oracle",
      Buffer.from("report"),
      Buffer.from("sig"),
      keypair,
    ] as const;

    // First submission: small footprint (1 read-only + 1 read-write key).
    server.setFootprintKeys(1, 1);
    await submitAttestation(...args, keypair.publicKey(), 1000n, 2000n);
    expect(warnSpy).not.toHaveBeenCalled();

    // Second submission: footprint grows (more keys touched).
    server.setFootprintKeys(3, 2);
    await submitAttestation(...args, keypair.publicKey(), 2001n, 3000n);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [fields, msg] = warnSpy.mock.calls[0] as [Record<string, unknown>, string];
    expect(msg).toMatch(/footprint grew/i);
    expect(fields.previousKeys).toBe(2);
    expect(fields.currentKeys).toBe(5);
    expect(fields.addedKeys).toBe(3);
  });
});
