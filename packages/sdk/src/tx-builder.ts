import type { Transaction } from "@stellar/stellar-base";

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
