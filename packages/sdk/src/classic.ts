import { fetchWithTimeout } from "./utils/fetch.js";
import { NetworkError, ValidationError } from "./errors.js";

export interface ClassicBalance {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
  limit?: string;
}

export interface ClassicAccountInfo {
  id: string;
  account_id: string;
  sequence: string;
  balances: ClassicBalance[];
}

export interface ClassicAccountConfig {
  networkPassphrase?: string;
  horizonUrl?: string;
  timeoutMs?: number;
}

const DEFAULT_NETWORK = "Test SDF Network ; September 2015";

/**
 * Resolve the appropriate Horizon URL based on network passphrase and config options.
 */
export function resolveHorizonUrl(networkPassphrase?: string, horizonUrl?: string): string {
  if (horizonUrl) return horizonUrl;
  const passphrase = networkPassphrase || DEFAULT_NETWORK;
  if (passphrase.includes("Test")) {
    return "https://horizon-testnet.stellar.org";
  }
  if (passphrase === "Public Global Stellar Network ; September 2015") {
    return "https://horizon.stellar.org";
  }
  throw new ValidationError(
    `Cannot determine Horizon URL for custom network passphrase: "${passphrase}". Please provide horizonUrl in ClientConfig.`,
    { networkPassphrase: passphrase }
  );
}

/**
 * Documented SDK client surface for Stellar classic-account operations (Horizon API).
 * Handles account sequence fetching, XLM native balances, and asset trustlines.
 */
export class ClassicAccountClient {
  private readonly horizonUrl: string;
  private readonly timeoutMs: number;

  constructor(config: ClassicAccountConfig = {}) {
    this.horizonUrl = resolveHorizonUrl(config.networkPassphrase, config.horizonUrl);
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  /** Get the configured Horizon URL endpoint. */
  getHorizonUrl(): string {
    return this.horizonUrl;
  }

  /**
   * Fetch classic account details from Horizon.
   *
   * @param address Stellar public key of the account.
   */
  async getAccount(address: string): Promise<ClassicAccountInfo> {
    if (!address) throw new ValidationError("address is required for Horizon query.");
    const url = `${this.horizonUrl}/accounts/${address}`;
    const res = await fetchWithTimeout(url, undefined, this.timeoutMs);
    if (!res.ok) {
      throw new NetworkError(
        `Failed to fetch account from Horizon (HTTP ${res.status}).`,
        { status: res.status, address }
      );
    }
    return (await res.json()) as ClassicAccountInfo;
  }

  /**
   * Fetch all balances (native XLM + assets) for an account.
   *
   * @param address Stellar public key of the account.
   */
  async getAccountBalances(address: string): Promise<ClassicBalance[]> {
    const account = await this.getAccount(address);
    return (account.balances ?? []).map((b) => {
      if (b.asset_type === "native" && !b.asset_code) {
        return { ...b, asset_code: "XLM", asset_issuer: "" };
      }
      return b;
    });
  }

  /**
   * Fetch non-native asset trustlines for an account.
   *
   * @param address Stellar public key of the account.
   */
  async getAccountTrustlines(address: string): Promise<ClassicBalance[]> {
    const balances = await this.getAccountBalances(address);
    return balances.filter((b) => b.asset_type !== "native");
  }
}
