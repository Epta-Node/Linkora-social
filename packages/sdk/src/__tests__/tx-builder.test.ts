/**
 * Issue #1346 — fee-bump / bump-sequence helpers.
 *
 * Uses REAL Stellar classes (no mocks) so the produced bump envelopes are
 * genuine, parseable XDR, mirroring the signed-transaction test style.
 */

import {
  Account,
  Asset,
  FeeBumpTransaction,
  Keypair,
  Networks,
  Operation,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-base";
import {
  buildBumpSequenceTransaction,
  buildFeeBumpTransaction,
} from "../tx-builder";
import { InvalidInputError } from "../errors";
import { LinkoraClient } from "../client";

jest.mock("@stellar/stellar-sdk/rpc", () => ({
  __esModule: true,
  ...jest.requireActual("@stellar/stellar-sdk/rpc"),
  Server: jest.fn(() => ({ simulateTransaction: jest.fn().mockResolvedValue({ result: null }) })),
}));

const NETWORK = Networks.TESTNET;

function makeSignedTx(keypair: Keypair = Keypair.random()): { tx: Transaction; xdr: string } {
  const account = new Account(keypair.publicKey(), "1");
  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: NETWORK,
  })
    .addOperation(
      // Self-payment keeps the envelope valid without any network access.
      Operation.payment({
        destination: keypair.publicKey(),
        asset: Asset.native(),
        amount: "1",
      })
    )
    .setTimeout(30)
    .build();
  tx.sign(keypair);
  return { tx, xdr: tx.toEnvelope().toXDR("base64") };
}

function makeUnsignedTx(): Transaction {
  const keypair = Keypair.random();
  return new TransactionBuilder(new Account(keypair.publicKey(), "1"), {
    fee: "100",
    networkPassphrase: NETWORK,
  })
    .addOperation(
      Operation.payment({
        destination: keypair.publicKey(),
        asset: Asset.native(),
        amount: "1",
      })
    )
    .setTimeout(30)
    .build();
}

describe("buildFeeBumpTransaction (issue #1346)", () => {
  it("wraps a signed inner transaction and preserves it", () => {
    const { tx, xdr } = makeSignedTx();

    const feeBump = buildFeeBumpTransaction(tx, Keypair.random(), "1000", NETWORK);

    expect(feeBump).toBeInstanceOf(FeeBumpTransaction);
    expect(feeBump.innerTransaction.toEnvelope().toXDR("base64")).toBe(xdr);
    expect(String(feeBump.fee)).toBe("1000");
  });

  it("accepts a signed inner transaction given as base-64 XDR", () => {
    const { xdr } = makeSignedTx();

    const feeBump = buildFeeBumpTransaction(xdr, Keypair.random(), "2000", NETWORK);

    expect(feeBump.innerTransaction.toEnvelope().toXDR("base64")).toBe(xdr);
  });

  it("produces an envelope that parses back as a fee bump for submission", () => {
    const { xdr } = makeSignedTx();

    const feeBump = buildFeeBumpTransaction(xdr, Keypair.random(), "1000", NETWORK);
    const envelope = FeeBumpTransaction.fromXDR(
      feeBump.toEnvelope().toXDR("base64"),
      NETWORK
    );

    expect(envelope.innerTransaction.signatures).toHaveLength(1);
    expect(envelope.signatures).toHaveLength(0);
  });

  it("rejects an unsigned inner transaction with a clear error", () => {
    const unsigned = makeUnsignedTx();

    expect(() =>
      buildFeeBumpTransaction(unsigned, Keypair.random(), "1000", NETWORK)
    ).toThrow(InvalidInputError);
    expect(() =>
      buildFeeBumpTransaction(unsigned, Keypair.random(), "1000", NETWORK)
    ).toThrow(/sign the inner transaction|signed inner transaction/i);
  });

  it("rejects a non-positive fee", () => {
    const { tx } = makeSignedTx();

    expect(() => buildFeeBumpTransaction(tx, Keypair.random(), "0", NETWORK)).toThrow(
      InvalidInputError
    );
    expect(() => buildFeeBumpTransaction(tx, Keypair.random(), "abc", NETWORK)).toThrow(
      InvalidInputError
    );
  });

  it("rejects wrapping an already fee-bumped transaction", () => {
    const { xdr } = makeSignedTx();
    const feeBump = buildFeeBumpTransaction(xdr, Keypair.random(), "1000", NETWORK);

    expect(() =>
      buildFeeBumpTransaction(
        feeBump.toEnvelope().toXDR("base64"),
        Keypair.random(),
        "2000",
        NETWORK
      )
    ).toThrow(InvalidInputError);
  });
});

describe("buildBumpSequenceTransaction (issue #1346)", () => {
  it("builds a standalone transaction with exactly one bump_sequence op", () => {
    const keypair = Keypair.random();
    const account = new Account(keypair.publicKey(), "100");

    const tx = buildBumpSequenceTransaction(account, "150", NETWORK);

    expect(tx.operations).toHaveLength(1);
    expect(tx.operations[0].type).toBe("bumpSequence");
    expect(String((tx.operations[0] as { bumpTo?: string }).bumpTo)).toBe("150");
  });

  it("rejects non-positive sequence targets", () => {
    const keypair = Keypair.random();
    const account = new Account(keypair.publicKey(), "100");

    expect(() => buildBumpSequenceTransaction(account, "0", NETWORK)).toThrow(
      InvalidInputError
    );
    expect(() => buildBumpSequenceTransaction(account, "-5", NETWORK)).toThrow(
      InvalidInputError
    );
  });
});

describe("LinkoraClient fee-bump support (issue #1346)", () => {
  let client: LinkoraClient;

  beforeEach(() => {
    client = new LinkoraClient({ contractId: "CDUMMY", rpcUrl: "https://dummy.example.com" });
  });

  it("exposes feeBumpTransaction that wraps a signed transaction", () => {
    const { tx } = makeSignedTx();

    const feeBump = client.feeBumpTransaction(tx, Keypair.random(), "1000");

    expect(feeBump.innerTransaction).toBe(tx);
  });

  it("surfaces a clear error when the inner transaction is unsigned", () => {
    const unsigned = makeUnsignedTx();

    expect(() => client.feeBumpTransaction(unsigned, Keypair.random(), "1000")).toThrow(
      /signed inner transaction/i
    );
  });
});
