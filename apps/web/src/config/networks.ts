export const HORIZON_ENDPOINTS: Record<string, string> = {
  TESTNET: "https://horizon-testnet.stellar.org",
  PUBLIC: "https://horizon.stellar.org",
  MAINNET: "https://horizon.stellar.org",
  FUTURENET: "https://horizon-futurenet.stellar.org",
};

export const DEFAULT_HORIZON_ENDPOINT = "https://horizon-testnet.stellar.org";

/**
 * Returns the Horizon API endpoint URL corresponding to the given network name.
 * Defaults to testnet endpoint if network is null, undefined, or unrecognized.
 */
export function getHorizonUrl(network?: string | null): string {
  if (!network) return DEFAULT_HORIZON_ENDPOINT;
  const key = network.toUpperCase();
  return HORIZON_ENDPOINTS[key] ?? DEFAULT_HORIZON_ENDPOINT;
}
