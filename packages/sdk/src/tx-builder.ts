import {
  Account,
  Operation,
  Transaction,
  TransactionBuilder,
  type FeeBumpTransaction,
  type Keypair,
} from "@stellar/stellar-base";
import { InvalidInputError } from "./errors.js";

export interface SourceAccountSigner {
  getPublicKey?: () => Promise<string> | string;
}

/** Validate that the signer identity matches the transaction source account. */
export async function validateTransactionSource(
  transaction: Transaction,
  signer: SourceAccountSigner
): Promise<void> {
  if (!signer.getPublicKey) return;
  const signerAddress = await signer.getPublicKey();
  const sourceAddress = transaction.source;
  if (signerAddress !== sourceAddress) {
    throw new Error(
      `Transaction source account mismatch: transaction uses ${sourceAddress}, ` +
        `but signer is ${signerAddress}. Pass the intended source account explicitly ` +
        "or use a signer for that account."
    );
  }
}

/**
 * Wraps a signed inner transaction into a fee-bump transaction so it can be
 * resubmitted with a higher fee when it is stuck (issue #1346).
 *
 * @param innerTx A SIGNED transaction: a parsed `Transaction` or its base-64
 * XDR envelope. Fee bumps wrap arbitrary existing operation XDR, so the inner
 * transaction must already carry its required signatures.
 * @param feePayer The `Keypair` (or public key of the account) paying the
 * higher fee.
 * @param fee The higher fee in stroops. Must exceed the inner transaction's
 * fee, otherwise the network rejects the envelope.
 * @param networkPassphrase The network the inner transaction targets.
 * @returns The fee-bump transaction, ready for the fee payer's signature and
 * submission via `LinkoraClient.submitTransaction`.
 * @throws {InvalidInputError} When the inner transaction carries no
 * signatures, is itself a fee bump, or the arguments are malformed.
 */
export function buildFeeBumpTransaction(
  innerTx: Transaction | string,
  feePayer: Keypair | string,
  fee: string,
  networkPassphrase: string
): FeeBumpTransaction {
  const inner =
    typeof innerTx === "string"
      ? parseTransactionXdr(innerTx, networkPassphrase)
      : innerTx;

  if (inner.signatures.length === 0) {
    throw new InvalidInputError(
      "Fee-bump requires a signed inner transaction: sign it first, then wrap it. " +
        "An unsigned envelope cannot be fee-bumped because the network validates " +
        "the inner signatures first."
    );
  }

  if (!Number.isFinite(Number(fee)) || Number(fee) <= 0) {
    throw new InvalidInputError(
      `Fee-bump fee must be a positive stroop amount, got "${String(fee)}".`
    );
  }

  try {
    const feeSource =
      typeof feePayer === "string" ? new Account(feePayer, "0") : feePayer;
    return TransactionBuilder.buildFeeBumpTransaction(
      feeSource,
      fee,
      inner,
      networkPassphrase
    );
  } catch (err) {
    throw new InvalidInputError(
      `Fee-bump is not supported for this transaction: ${
        err instanceof Error ? err.message : String(err)
      }. The fee must be greater than the inner transaction's fee, and an ` +
        "already fee-bumped inner transaction cannot be wrapped again.",
      undefined,
      err
    );
  }
}

/**
 * Builds a standalone `bump_sequence` transaction (issue #1346).
 *
 * Submit it first with the account as source signer to advance the account's
 * sequence past a stuck sequence number; the previously built transactions
 * then fail with `tx_bad_seq` and can be rebuilt at the new sequence.
 *
 * @param sourceAccount The account whose sequence is bumped. Fetch the
 * up-to-date account via `LinkoraClient.getAccount` before building.
 * @param bumpTo The sequence number to bump the account to. Must be greater
 * than the account's current sequence.
 * @param networkPassphrase The network to target.
 * @param fee Transaction fee in stroops (default `"100"`).
 * @returns The unsigned transaction; sign it with the source account's signer
 * and submit.
 * @throws {InvalidInputError} When `bumpTo` is negative or not a finite number.
 */
export function buildBumpSequenceTransaction(
  sourceAccount: Account,
  bumpTo: string | number | bigint,
  networkPassphrase: string,
  fee: string = "100"
): Transaction {
  const sequence = typeof bumpTo === "bigint" ? bumpTo.toString() : String(bumpTo);
  if (!/^\d+$/.test(sequence) || BigInt(sequence) <= 0n) {
    throw new InvalidInputError(
      `bumpTo must be a positive integer sequence number, got "${String(bumpTo)}".`
    );
  }

  return new TransactionBuilder(sourceAccount, { fee, networkPassphrase })
    .addOperation(Operation.bumpSequence({ bumpTo: sequence }))
    .setTimeout(30)
    .build();
}

function parseTransactionXdr(xdr: string, networkPassphrase: string): Transaction {
  if (typeof xdr !== "string" || xdr.trim().length === 0) {
    throw new InvalidInputError(
      "Fee-bump requires a base-64 transaction envelope XDR or a parsed Transaction."
    );
  }

  try {
    const parsed = Transaction.fromXDR(xdr.trim(), networkPassphrase);
    if (parsed instanceof Transaction) {
      return parsed;
    }
    throw new InvalidInputError(
      "Fee-bump cannot wrap a fee-bump envelope: pass the inner Transaction instead."
    );
  } catch (err) {
    if (err instanceof InvalidInputError) throw err;
    throw new InvalidInputError(
      "The provided XDR does not parse as a transaction on this network.",
      undefined,
      err
    );
  }
}
