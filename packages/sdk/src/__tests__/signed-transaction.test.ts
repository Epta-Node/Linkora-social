/**
 * Issue #1357 — Round-trip tests for the offline signed-XDR helpers.
 *
 * Uses REAL Stellar classes (no mocks): builds and signs a genuine payment
 * envelope, exports it to the portable format, re-imports it, and asserts
 * tampering is rejected loudly.
 */

import {
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  Account,
  Asset,
} from "@stellar/stellar-base";
import {
  buildPortableSignedTransaction,
  exportSignedTransaction,
  importSignedTransaction,
  roundTripSignedTransaction,
  SIGNED_TRANSACTION_FORMAT,
  SIGNED_TRANSACTION_VERSION,
} from "../signed-transaction";
import { InvalidSignedTransactionError } from "../errors";

const NETWORK = Networks.TESTNET;

function makeSignedXdr(): { xdr: string; keypair: Keypair } {
  const keypair = Keypair.random();
  const account = new Account(keypair.publicKey(), "1");
  const tx = new TransactionBuilder(account, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      // Self-payment keeps the envelope valid without any network access.
      Operation.payment({
        destination: keypair.publicKey(),
        asset: Asset.native(),
        amount: "10",
      })
    )
    .setTimeout(30)
    .build();
  tx.sign(keypair);
  return { xdr: tx.toEnvelope().toXDR("base64"), keypair };
}

describe("signed-XDR export/import (issue #1357)", () => {
  it("exports a signed transaction to a portable payload", () => {
    const { xdr } = makeSignedXdr();
    const portable = buildPortableSignedTransaction(xdr, Networks.TESTNET);

    expect(portable.format).toBe(SIGNED_TRANSACTION_FORMAT);
    expect(portable.version).toBe(1);
    expect(portable.networkPassphrase).toBe(Networks.TESTNET);
    expect(portable.envelope).toBe(xdr);
    expect(portable.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("round-trips export → import for submission", () => {
    const { xdr } = makeSignedXdr();

    const json = exportSignedTransaction(xdr, Networks.TESTNET);
    expect(typeof json).toBe("string");

    const imported = importSignedTransaction(json, { networkPassphrase: Networks.TESTNET });
    expect(imported.toEnvelope().toXDR("base64")).toBe(xdr);

    // Object-form round trip too.
    const objForm = roundTripSignedTransaction(
      buildPortableSignedTransaction(xdr, Networks.TESTNET).envelope,
      Networks.TESTNET
    );
    expect(objForm.toEnvelope().toXDR("base64")).toBe(xdr);
  });

  it("rejects a tampered payload clearly (digest mismatch)", () => {
    const { xdr } = makeSignedXdr();
    const portable = buildPortableSignedTransaction(xdr, Networks.TESTNET);

    // Tamper: change one op parameter inside the JSON envelope payload.
    const tamperedEnvelope = portable.envelope.replace(/^A/, "B");
    const tampered = JSON.stringify({ ...portable, envelope: tamperedEnvelope });

    expect(() =>
      importSignedTransaction(tampered, { networkPassphrase: Networks.TESTNET })
    ).toThrow(/tampered/i);
  });

  it("rejects a payload whose JSON envelope was swapped without a digest update", () => {
    const first = makeSignedXdr();
    const second = makeSignedXdr();

    const portable = buildPortableSignedTransaction(first.xdr, Networks.TESTNET);
    const swapped = JSON.stringify({ ...portable, envelope: second.xdr });

    expect(() =>
      importSignedTransaction(swapped, { networkPassphrase: Networks.TESTNET })
    ).toThrow(InvalidSignedTransactionError);
  });

  it("rejects malformed JSON and unknown formats", () => {
    expect(() => importSignedTransaction("{not json")).toThrow(InvalidSignedTransactionError);
    expect(() => importSignedTransaction({ format: "other/format" } as never)).toThrow(
      /Unknown signed-transaction payload format/i
    );
  });

  it("rejects unsigned envelopes", () => {
    const keypair = Keypair.random();
    const account = new Account(keypair.publicKey(), "1");
    const unsigned = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: Networks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: keypair.publicKey(),
          asset: Asset.native(),
          amount: "10",
        })
      )
      .setTimeout(30)
      .build();

    const json = exportSignedTransaction(
      unsigned.toEnvelope().toXDR("base64"),
      Networks.TESTNET
    );
    expect(() => importSignedTransaction(json)).toThrow(/no signatures/i);
  });

  it("rejects a network mismatch on import", () => {
    const { xdr } = makeSignedXdr();
    const json = exportSignedTransaction(xdr, Networks.TESTNET);
    expect(() =>
      importSignedTransaction(json, { networkPassphrase: Networks.PUBLIC })
    ).toThrow(/network/i);
  });
});
