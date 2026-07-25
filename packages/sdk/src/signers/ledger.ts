import { Signer, TransactionLike } from "../types";
import { SigningError } from "../errors";

declare const window: undefined | object;

interface LedgerTransport {
  close(): Promise<void>;
}

interface LedgerWebHidTransport {
  create(): Promise<LedgerTransport>;
}

interface LedgerNodeHidTransport {
  list(): Promise<unknown[]>;
  open(device: unknown): Promise<LedgerTransport>;
}

interface StellarLedgerPublicKey {
  publicKey?: string;
  rawPublicKey: Buffer;
}

interface StellarLedgerApp {
  getPublicKey(derivationPath: string): Promise<StellarLedgerPublicKey>;
  signTransaction(derivationPath: string, txBytes: Buffer): Promise<{ signature: Buffer }>;
}

type StellarLedgerAppConstructor = new (transport: LedgerTransport) => StellarLedgerApp;

function defaultExport<T>(module: unknown): T {
  const first =
    module && typeof module === "object" && "default" in module
      ? (module as { default: unknown }).default
      : module;

  return (
    first && typeof first === "object" && "default" in first
      ? (first as { default: T }).default
      : first
  ) as T;
}

/**
 * Ledger signer implementation for hardware wallet support.
 * Works in both browser (WebHID) and Node.js (HID) environments.
 */
export class LedgerSigner implements Signer {
  private publicKeyCache: Map<string, string> = new Map();
  private transport: LedgerTransport | null = null;

  constructor() {
    // Transport is lazy-loaded on first use
  }

  /**
   * Get or create the appropriate transport based on environment.
   */
  private async getTransport(): Promise<LedgerTransport> {
    if (this.transport) {
      return this.transport;
    }

    if (typeof window !== "undefined") {
      try {
        const TransportWebHID = defaultExport<LedgerWebHidTransport>(
          await import("@ledgerhq/hw-transport-webhid")
        );
        this.transport = await TransportWebHID.create();
      } catch (error) {
        throw new SigningError(
          `Failed to initialize Ledger WebHID transport: ${error instanceof Error ? error.message : String(error)}`,
          { reason: "webhid_init_failed" },
          error
        );
      }
    } else {
      try {
        const TransportNodeHID = defaultExport<LedgerNodeHidTransport>(
          await import("@ledgerhq/hw-transport-node-hid")
        );
        const devices = await TransportNodeHID.list();
        if (devices.length === 0) {
          throw new SigningError("No Ledger device found. Please connect your Ledger device.", {
            reason: "device_not_found",
          });
        }
        this.transport = await TransportNodeHID.open(devices[0]);
      } catch (error) {
        if (error instanceof SigningError) throw error;
        throw new SigningError(
          `Failed to initialize Ledger Node HID transport: ${error instanceof Error ? error.message : String(error)}`,
          { reason: "nodehid_init_failed" },
          error
        );
      }
    }

    return this.transport as LedgerTransport;
  }

  /**
   * Get the public key from the Ledger device.
   * Results are cached per derivation path. The cache is invalidated on close().
   *
   * @param derivationPath Stellar BIP-44 derivation path (default: "m/44'/148'/0'")
   */
  async getPublicKey(derivationPath: string = "m/44'/148'/0'"): Promise<string> {
    const cached = this.publicKeyCache.get(derivationPath);
    if (cached) return cached;

    try {
      const transport = await this.getTransport();
      const StrApp = defaultExport<StellarLedgerAppConstructor>(
        await import("@ledgerhq/hw-app-str")
      );
      const app = new StrApp(transport);

      const result = await app.getPublicKey(derivationPath);
      const publicKey =
        "publicKey" in result
          ? String(result.publicKey)
          : (await import("@stellar/stellar-base")).StrKey.encodeEd25519PublicKey(
              result.rawPublicKey
            );
      this.publicKeyCache.set(derivationPath, publicKey);
      return publicKey;
    } catch (error) {
      throw new SigningError(
        `Failed to get public key from Ledger: ${error instanceof Error ? error.message : String(error)}`,
        { reason: "get_public_key_failed" },
        error
      );
    }
  }

  /**
   * Sign a transaction using the Ledger device.
   *
   * The @ledgerhq/hw-app-str signTransaction call returns a raw 64-byte Ed25519
   * signature (not a signed XDR envelope). This method attaches that signature
   * as a DecoratedSignature on the transaction and returns the modified object.
   *
   * @param tx Transaction object or base64 XDR string
   * @param derivationPath Stellar BIP-44 derivation path (default: "m/44'/148'/0'")
   */
  async signTransaction(
    tx: string | TransactionLike,
    derivationPath: string = "m/44'/148'/0'"
  ): Promise<unknown> {
    try {
      const transport = await this.getTransport();
      const StrApp = defaultExport<StellarLedgerAppConstructor>(
        await import("@ledgerhq/hw-app-str")
      );
      const app = new StrApp(transport);

      const xdrString = typeof tx === "string" ? tx : tx.toEnvelope().toXDR("base64");
      const txBytes = Buffer.from(xdrString, "base64");

      // Ledger returns { signature: Buffer } — a 64-byte raw Ed25519 signature,
      // not a signed XDR envelope. Attach it to the transaction as a DecoratedSignature.
      const { signature } = await app.signTransaction(derivationPath, txBytes);

      if (typeof tx !== "string") {
        const { Keypair, xdr } = await import("@stellar/stellar-base");
        const publicKey = await this.getPublicKey(derivationPath);
        const keypair = Keypair.fromPublicKey(publicKey);
        const txObj = tx as { signatures?: unknown[] };
        if (!txObj.signatures) {
          txObj.signatures = [];
        }
        txObj.signatures.push(
          new xdr.DecoratedSignature({
            hint: keypair.signatureHint(),
            signature,
          })
        );
        return tx;
      }

      return signature.toString("base64");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("device not found") || errorMessage.includes("not connected")) {
        throw new SigningError(
          "Ledger device not found or not connected",
          {
            reason: "device_not_connected",
          },
          error
        );
      }
      if (errorMessage.includes("app not open")) {
        throw new SigningError(
          "Stellar app not open on Ledger device",
          {
            reason: "app_not_open",
          },
          error
        );
      }
      if (errorMessage.includes("user rejected")) {
        throw new SigningError(
          "Transaction signing rejected by user",
          {
            reason: "user_rejected",
          },
          error
        );
      }
      if (errorMessage.includes("version")) {
        throw new SigningError(
          "Ledger app version mismatch or not installed",
          {
            reason: "version_mismatch",
          },
          error
        );
      }

      throw new SigningError(
        `Failed to sign transaction with Ledger: ${errorMessage}`,
        { reason: "sign_failed" },
        error
      );
    }
  }

  /**
   * Close the Ledger transport connection and invalidate the public key cache.
   */
  async close(): Promise<void> {
    if (this.transport) {
      try {
        await this.transport.close();
      } catch {
        // Silently fail on close
      } finally {
        this.transport = null;
        this.publicKeyCache.clear();
      }
    }
  }
}
