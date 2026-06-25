const getEnv = (value: string | undefined, name: string): string => {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export const config = {
  sorobanRpcUrl: getEnv(process.env.NEXT_PUBLIC_SOROBAN_RPC_URL, "NEXT_PUBLIC_SOROBAN_RPC_URL"),
  networkPassphrase: getEnv(
    process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE,
    "NEXT_PUBLIC_NETWORK_PASSPHRASE"
  ),
  contractId: getEnv(process.env.NEXT_PUBLIC_CONTRACT_ID, "NEXT_PUBLIC_CONTRACT_ID"),
} as const;
