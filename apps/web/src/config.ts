const fallback = {
  sorobanRpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  contractId: "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
};

export const config = {
  sorobanRpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? fallback.sorobanRpcUrl,
  networkPassphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? fallback.networkPassphrase,
  contractId: process.env.NEXT_PUBLIC_CONTRACT_ID ?? fallback.contractId,
} as const;
