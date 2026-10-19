import { Signer, TransactionLike } from "../types.js";
import { SigningError } from "../errors.js";

/** Well-known Stellar network passphrases. */
export const NETWORK_PASSPHRASES = {
  mainnet: "Public Global Stellar Network ; September 2015",
  testnet: "Test SDF Network ; September 2015",
  futurenet: "Test SDF Future Network ; October 2022",
} as const;

export type KnownNetwork = keyof typeof NETWORK_PASSPHRASES;

/**
 * All passphrases that FreighterSigner considers valid.
 * Custom passphrases are accepted when `allowCustomNetwork` is true.
 */
const KNOWN_PASSPHRASES = new Set<string>(Object.values(NETWORK_PASSPHRASES));

declare const window:
  | undefined
  | {
      freighter?: {
        getPublicKey(): Promise<string>;
        signTransaction(
          xdr: string,
          opts?: { networkPassphrase?: string; network?: string }
        ): Promise<string>;
      };
    };

type FreighterApi = NonNullable<NonNullable<typeof window>["freighter"]>;

export interface FreighterSignerConfig {
  /**
   * The Stellar network passphrase this signer is bound to.
   *
   * Accepts a well-known name (`"mainnet"` | `"testnet"` | `"futurenet"`) or a
   * raw passphrase string. When provided, it is validated against the set of
   * known passphrases (unless `allowCustomNetwork` is `true`) and forwarded to
   * the Freighter extension on every `signTransaction` call.
   *
   * Defaults to the mainnet passphrase when omitted.
   */
  network?: KnownNetwork | string;
  /**
   * When `true`, arbitrary network passphrases are accepted without validation.
   * Use for private / custom networks. Defaults to `false`.
   */
  allowCustomNetwork?: boolean;
}

/**
 * Freighter signer implementation for browser extension.
 * Works with the Freighter Stellar wallet browser extension.
 */
export class FreighterSigner implements Signer {
  private publicKey: string | null = null;
  private readonly networkPassphrase: string;

  constructor(config: FreighterSignerConfig = {}) {
    const { network = "mainnet", allowCustomNetwork = false } = config;

    // Resolve named network → passphrase, or treat as a raw passphrase string.
    const passphrase =
      network in NETWORK_PASSPHRASES ? NETWORK_PASSPHRASES[network as KnownNetwork] : network;

    // Validate — reject unknown passphrases unless the caller opts out.
    if (!allowCustomNetwork && !KNOWN_PASSPHRASES.has(passphrase)) {
      throw new SigningError(
        `Unknown network passphrase: "${passphrase}". ` +
          `Pass allowCustomNetwork: true to use a custom passphrase.`,
        { reason: "unknown_network", passphrase }
      );
    }

    this.networkPassphrase = passphrase;
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("User declined") || errorMessage.includes("User rejected")) {
        throw new SigningError(
          "User declined access to Freighter",
          { reason: "user_rejected" },
          error
        );
      }
      throw new SigningError(
        `Failed to get public key from Freighter: ${errorMessage}`,
        { reason: "get_public_key_failed" },
        error
      );
    }
  }

  /**
   * Sign a transaction using Freighter and return the signed XDR string.
   *
   * The network passphrase configured on this signer is forwarded to Freighter
   * so the extension can confirm the user is signing on the intended network.
   *
   * @param tx The transaction to sign — either a base64 XDR string or a
   *   `TransactionLike` object. When a `TransactionLike` is passed its
   *   `networkPassphrase` property (if present) must match the signer's
   *   configured passphrase, otherwise a `SigningError` is thrown.
   * @returns The signed transaction envelope as a base64 XDR string.
   */
  async signTransaction(tx: string | TransactionLike): Promise<string> {
    // ── Passphrase cross-check for TransactionLike inputs ────────────────────
    if (typeof tx !== "string" && tx.networkPassphrase !== undefined) {
      if (tx.networkPassphrase !== this.networkPassphrase) {
        throw new SigningError(
          `Transaction network passphrase mismatch. ` +
            `Signer is configured for "${this.networkPassphrase}" ` +
            `but the transaction targets "${tx.networkPassphrase}".`,
          {
            reason: "passphrase_mismatch",
            expected: this.networkPassphrase,
            actual: tx.networkPassphrase,
          }
        );
      }
    }

    const freighter = this.getFreighter();
    try {
      const xdrString = typeof tx === "string" ? tx : tx.toEnvelope().toXDR("base64");
      const signedXdr = await freighter.signTransaction(xdrString, {
        networkPassphrase: this.networkPassphrase,
      });
      return signedXdr;
    } catch (error) {
      if (error instanceof SigningError) throw error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("User declined") || errorMessage.includes("User rejected")) {
        throw new SigningError(
          "Transaction signing rejected by user",
          { reason: "user_rejected" },
          error
        );
      }
      throw new SigningError(
        `Failed to sign transaction with Freighter: ${errorMessage}`,
        { reason: "sign_failed" },
        error
      );
    }
  }
}
