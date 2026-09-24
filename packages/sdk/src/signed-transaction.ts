/**
 * Offline signing helpers (issue #1357).
 *
 * Export a SIGNED transaction envelope to a portable, tamper-evident
 * format, transfer it through an air gap (file, clipboard, QR, …), and
 * re-import it for submission with full validation — no manual XDR
 * cobbling, no loss of the SDK's type safety and error handling.
 *
 * The portable payload carries a SHA-256 digest of the envelope XDR so any
 * tampering in transit is rejected loudly on import, together with the
 * network passphrase so the importer can confirm it targets the intended
 * network before submitting.
 */

import { Transaction, TransactionBuilder, type FeeBumpTransaction, hash } from "@stellar/stellar-base";
import { InvalidSignedTransactionError } from "./errors.js";

export const SIGNED_TRANSACTION_FORMAT = "linkora-sdk/signed-transaction";
export const SIGNED_TRANSACTION_VERSION = 1;

/** A portable, tamper-evident representation of a signed transaction. */
export interface PortableSignedTransaction {
  format: typeof SIGNED_TRANSACTION_FORMAT;
  version: number;
  /** Network the transaction targets (e.g. `Test SDF Network ; September 2015`). */
  networkPassphrase: string;
  /** Base-64 XDR of the signed transaction envelope. */
  envelope: string;
  /** SHA-256 hex digest of `envelope` — verified on import. */
  digest: string;
}

function toHex(bytes: Buffer): string {
  return bytes.toString("hex");
}

function isTransactionLike(value: unknown): value is Transaction | FeeBumpTransaction {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toEnvelope?: unknown }).toEnvelope === "function"
  );
}

/**
 * Build the portable payload for a signed transaction.
 *
 * @param signedXdrOrTx A base-64 XDR string of a SIGNED transaction envelope,
 * or an already-parsed `Transaction` / `FeeBumpTransaction`.
 * @param networkPassphrase The network the transaction targets.
 * @returns The portable payload (also usable via `JSON.stringify`).
 */
export function buildPortableSignedTransaction(
  signedXdrOrTx: string | Transaction | FeeBumpTransaction,
  networkPassphrase: string
): PortableSignedTransaction {
  const envelope =
    typeof signedXdrOrTx === "string"
      ? signedXdrOrTx
      : signedXdrOrTx.toEnvelope().toXDR("base64");

  if (typeof envelope !== "string" || envelope.trim().length === 0) {
    throw new InvalidSignedTransactionError("Cannot export an empty transaction envelope.");
  }

  return {
    format: SIGNED_TRANSACTION_FORMAT,
    version: SIGNED_TRANSACTION_VERSION,
    networkPassphrase,
    envelope: envelope.trim(),
    digest: toHex(hash(Buffer.from(envelope.trim(), "utf8"))),
  };
}

/**
 * Serialize a signed transaction to a portable JSON string suitable for
 * offline (air-gapped) transfer.
 */
export function exportSignedTransaction(
  signedXdrOrTx: string | Transaction | FeeBumpTransaction,
  networkPassphrase: string
): string {
  return JSON.stringify(buildPortableSignedTransaction(signedXdrOrTx, networkPassphrase), null, 2);
}

/**
 * Parse and validate a portable signed transaction payload for submission.
 *
 * Rejects, with clear errors:
 * - malformed JSON or unknown payload shape,
 * - a digest that no longer matches the envelope (tampered in transit),
 * - an envelope that does not parse on the expected network,
 * - an envelope carrying no signatures (not actually signed).
 *
 * @param portable The payload previously produced by
 * {@link exportSignedTransaction} / {@link buildPortableSignedTransaction}.
 * @param opts Options: `networkPassphrase` to assert the imported
 * transaction targets the expected network.
 * @returns The parsed transaction, ready for
 * `LinkoraClient.submitTransaction(...)`.
 */
export function importSignedTransaction(
  portable: string | PortableSignedTransaction,
  opts?: { networkPassphrase?: string }
): Transaction | FeeBumpTransaction {
  let payload: PortableSignedTransaction;

  if (typeof portable === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(portable);
    } catch (err) {
      throw new InvalidSignedTransactionError(
        "Portable signed transaction is not valid JSON.",
        undefined,
        err
      );
    }
    if (typeof parsed !== "object" || parsed === null) {
      throw new InvalidSignedTransactionError(
        "Portable signed transaction must be a JSON object."
      );
    }
    payload = parsed as PortableSignedTransaction;
  } else if (typeof portable === "object" && portable !== null) {
    payload = portable;
  } else {
    throw new InvalidSignedTransactionError(
      "Portable signed transaction must be an object or a JSON string."
    );
  }

  if (payload.format !== SIGNED_TRANSACTION_FORMAT) {
    throw new InvalidSignedTransactionError(
      `Unknown signed-transaction payload format: ${String(
        (payload as { format?: unknown }).format
      )} (expected "${SIGNED_TRANSACTION_FORMAT}").`
    );
  }

  if (payload.version !== SIGNED_TRANSACTION_VERSION) {
    throw new InvalidSignedTransactionError(
      `Unsupported signed-transaction payload version: ${String(payload.version)}.`
    );
  }

  if (typeof payload.envelope !== "string" || payload.envelope.trim().length === 0) {
    throw new InvalidSignedTransactionError("Signed transaction payload has no envelope XDR.");
  }
  if (typeof payload.networkPassphrase !== "string" || payload.networkPassphrase.length === 0) {
    throw new InvalidSignedTransactionError(
      "Signed transaction payload has no network passphrase."
    );
  }

  const envelope = payload.envelope.trim();

  // Tamper check (issue #1357): the digest must match the envelope exactly.
  if (typeof payload.digest !== "string" || payload.digest.length === 0) {
    throw new InvalidSignedTransactionError("Signed transaction payload has no digest.");
  }
  const actualDigest = toHex(hash(Buffer.from(envelope, "utf8")));
  if (actualDigest !== payload.digest.trim().toLowerCase()) {
    throw new InvalidSignedTransactionError(
      "Signed transaction payload failed the integrity check — the envelope was tampered with or truncated.",
      { expectedDigest: payload.digest, actualDigest }
    );
  }

  if (
    opts?.networkPassphrase !== undefined &&
    opts.networkPassphrase !== payload.networkPassphrase
  ) {
    throw new InvalidSignedTransactionError(
      `Signed transaction targets network "${payload.networkPassphrase}" but the importer expected "${opts.networkPassphrase}".`
    );
  }

  let tx: Transaction | FeeBumpTransaction;
  try {
    tx = TransactionBuilder.fromXDR(envelope, payload.networkPassphrase) as
      | Transaction
      | FeeBumpTransaction;
  } catch (err) {
    throw new InvalidSignedTransactionError(
      "Envelope XDR could not be parsed on the payload's network.",
      undefined,
      err
    );
  }

  // The whole point of this helper is OFFLINE-SIGNED transactions — an
  // envelope without signatures is rejected up front rather than failing at
  // submission time.
  const hasSignatures = (() => {
    try {
      if (tx instanceof FeeBumpTransaction) {
        return tx.signatures.length > 0;
      }
      return (tx as Transaction).signatures.length > 0;
    } catch {
      return false;
    }
  })();

  if (!hasSignatures) {
    throw new InvalidSignedTransactionError(
      "Signed transaction payload carries no signatures — refusing to import an unsigned envelope."
    );
  }

  return tx;
}

/**
 * Convenience: export → import round trip in one call, re-serialized as a
 * string (useful for clipboard / file flows).
 */
export function roundTripSignedTransaction(
  signedXdrOrTx: string | Transaction | FeeBumpTransaction,
  networkPassphrase: string
): Transaction | FeeBumpTransaction {
  return importSignedTransaction(exportSignedTransaction(signedXdrOrTx, networkPassphrase));
}
