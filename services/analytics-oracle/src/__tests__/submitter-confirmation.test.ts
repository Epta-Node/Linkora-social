/**
 * Tests for submitAttestation's confirmation check (#1536).
 *
 * `rpc.Server.pollTransaction` RESOLVES without throwing when its attempt
 * budget is exhausted and the transaction was never found on chain. A
 * submission that the RPC accepted but that never landed (dropped from the
 * mempool, bad sequence number, too low a fee to be included) must therefore be
 * rejected, not reported and cached as a successful attestation.
 */

import { submitAttestation, resetFootprintTracking } from "../submitter.js";
import { AttestationCache } from "../attestation-cache.js";
import { rpc, Keypair, Contract, SorobanDataBuilder } from "@stellar/stellar-sdk";
import { jest } from "@jest/globals";

const CONTRACT_ID = "CAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABDQF";
const NETWORK = "Test SDF Network ; September 2015";

function buildSimulation() {
  const data = new SorobanDataBuilder();
  data.setReadOnly([new Contract(CONTRACT_ID).getFootprint()]).setReadWrite([]);
  return {
    _parsed: true,
    transactionData: data,
    minResourceFee: "0",
    result: { auth: [] },
  };
}

const account = {
  accountId: () => "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  sequenceNumber: () => "100",
  incrementSequenceNumber: () => {},
  sequence: "100",
};

type PollResult = { status: string } | undefined;

function mockServer(pollResult: PollResult) {
  const mock = {
    getAccount: jest.fn(async () => account),
    simulateTransaction: jest.fn(async () => buildSimulation()),
    sendTransaction: jest.fn(async () => ({ hash: "unconfirmed-tx-hash" })),
    pollTransaction: jest.fn(async () => pollResult),
  };
  return mock as unknown as rpc.Server & typeof mock;
}

function call(server: rpc.Server, keypair: Keypair): Promise<string> {
  return submitAttestation(
    server,
    NETWORK,
    CONTRACT_ID,
    "oracle",
    Buffer.from("report"),
    Buffer.from("signature"),
    keypair,
    keypair.publicKey(),
    1000n,
    2000n
  );
}

beforeEach(() => {
  resetFootprintTracking();
});

describe("submitAttestation — unconfirmed transactions", () => {
  it("rejects when the polled transaction is never found (NOT_FOUND)", async () => {
    const server = mockServer({ status: rpc.Api.GetTransactionStatus.NOT_FOUND });
    const keypair = Keypair.random();

    await expect(call(server, keypair)).rejects.toThrow(/not confirmed on chain/i);
    expect(server.pollTransaction).toHaveBeenCalledTimes(1);
  });

  it("rejects when the polled transaction reports a non-success status (FAILED)", async () => {
    const server = mockServer({ status: rpc.Api.GetTransactionStatus.FAILED });
    const keypair = Keypair.random();

    await expect(call(server, keypair)).rejects.toThrow(/status=FAILED/);
  });

  it("rejects when pollTransaction resolves with no status at all", async () => {
    const server = mockServer(undefined);
    const keypair = Keypair.random();

    await expect(call(server, keypair)).rejects.toThrow(/status=unknown/);
  });

  it("never returns a hash for an unconfirmed submission", async () => {
    const server = mockServer({ status: rpc.Api.GetTransactionStatus.NOT_FOUND });
    const keypair = Keypair.random();

    const hash = await call(server, keypair).then(
      (h) => h,
      () => null
    );
    expect(hash).toBeNull();
  });

  it("passes an explicit poll attempt budget rather than relying on the SDK default", async () => {
    const server = mockServer({ status: rpc.Api.GetTransactionStatus.SUCCESS });
    const keypair = Keypair.random();

    await call(server, keypair);

    const [txHash, options] = (server.pollTransaction as unknown as jest.Mock).mock.calls[0] as [
      string,
      { attempts?: number },
    ];
    expect(txHash).toBe("unconfirmed-tx-hash");
    expect(typeof options?.attempts).toBe("number");
    expect(options.attempts).toBeGreaterThan(0);
  });

  it("returns the hash for a confirmed submission", async () => {
    const server = mockServer({ status: rpc.Api.GetTransactionStatus.SUCCESS });
    const keypair = Keypair.random();

    await expect(call(server, keypair)).resolves.toBe("unconfirmed-tx-hash");
  });
});

describe("runWindow — an unconfirmed submission is never cached", () => {
  it("does not call attestationCache.set when the tx is unconfirmed", async () => {
    const server = mockServer({ status: rpc.Api.GetTransactionStatus.NOT_FOUND });
    const keypair = Keypair.random();
    const cache = new AttestationCache<Record<string, unknown>>({ maxSize: 10, ttlMs: 3_600_000 });
    const setSpy = jest.spyOn(cache, "set");

    // Mirrors runWindow's per-creator loop: the cache write is reached only when
    // submitAttestation resolves.
    const failedCreators: string[] = [];
    const creator = keypair.publicKey();
    let txHash: string | null = null;
    try {
      txHash = await call(server, keypair);
    } catch (err) {
      failedCreators.push(creator);
    }

    if (txHash) {
      cache.set(creator, { txHash });
    }

    expect(failedCreators).toEqual([creator]);
    expect(setSpy).not.toHaveBeenCalled();
    expect(cache.get(creator)).toBeUndefined();
  });
});
