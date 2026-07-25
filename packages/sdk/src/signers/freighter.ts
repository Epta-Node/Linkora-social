import { Signer, TransactionLike } from "../types";
import { SigningError } from "../errors";

declare const window:
  | undefined
  | {
      freighter?: {
        getPublicKey(): Promise<string>;
        signTransaction(xdr: string): Promise<string>;
      };
    };

type FreighterApi = NonNullable<NonNullable<typeof window>["freighter"]>;

/**
 * Freighter signer implementation for browser extension.
 * Works with the Freighter Stellar wallet browser extension.
 */
export class FreighterSigner implements Signer {
  private publicKey: string | null = null;

  constructor() {
    this.validateFreighterAvailability();
  }

  private validateFreighterAvailability(): void {
    this.getFreighter();
  }

  private getFreighter(): FreighterApi {
    if (typeof window === "undefined" || !window.freighter) {
      throw new SigningError(
        "Freighter extension not found. Please install it from https://www.freighter.app/",
        { reason: "extension_not_found" }
      );
    }
    return window.freighter;
  }

  /**
   * Get the public key from Freighter
   */
  async getPublicKey(): Promise<string> {
    if (this.publicKey) {
      return this.publicKey;
    }

    const freighter = this.getFreighter();
    try {
      const publicKey = await freighter.getPublicKey();
      this.publicKey = publicKey;
      return publicKey;
    } catch (error) {
      throw new SigningError(
        `Failed to get public key from Freighter: ${error instanceof Error ? error.message : String(error)}`,
        { reason: "get_public_key_failed" },
        error
      );
    }
  }

  /**
   * Sign a transaction using Freighter
   * @param tx The transaction to sign (can be a Transaction object or XDR string)
   */
  async signTransaction(tx: string | TransactionLike): Promise<unknown> {
    const freighter = this.getFreighter();
    try {
      // If tx is a Transaction object, convert to XDR
      const xdrString = typeof tx === "string" ? tx : tx.toEnvelope().toXDR("base64");
      const signedXdr = await freighter.signTransaction(xdrString);

      // If the original input was a Transaction object, convert back
      if (typeof tx !== "string") {
        const { TransactionBuilder } = await import("@stellar/stellar-base");
        // Parse the signed XDR back into a Transaction
        return TransactionBuilder.fromXDR(signedXdr, tx.networkPassphrase ?? "");
      }

      return signedXdr;
    } catch (error) {
      throw new SigningError(
        `Failed to sign transaction with Freighter: ${error instanceof Error ? error.message : String(error)}`,
        { reason: "sign_rejected" },
        error
      );
    }
  }
}
