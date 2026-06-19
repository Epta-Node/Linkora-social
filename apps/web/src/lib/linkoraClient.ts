/**
 * Returns a singleton LinkoraClient configured from environment variables.
 * Import this wherever you need to call read or write SDK methods.
 */
import { LinkoraClient } from "linkora-sdk";

let _client: LinkoraClient | null = null;

export function getLinkoraClient(): LinkoraClient {
  if (_client) return _client;

  const contractId = process.env.NEXT_PUBLIC_LINKORA_CONTRACT_ID;
  const factoryContractId = process.env.NEXT_PUBLIC_TOKEN_FACTORY_CONTRACT_ID;
  const rpcUrl = process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";
  const networkPassphrase =
    process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";

  if (!contractId) {
    throw new Error(
      "NEXT_PUBLIC_LINKORA_CONTRACT_ID is not set. Configure it in your .env.local file."
    );
  }

  _client = new LinkoraClient({
    contractId,
    factoryContractId,
    rpcUrl,
    networkPassphrase,
  });

  return _client;
}
