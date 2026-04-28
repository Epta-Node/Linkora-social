const required = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

export const config = {
  sorobanRpcUrl: required("NEXT_PUBLIC_SOROBAN_RPC_URL"),
  networkPassphrase: required("NEXT_PUBLIC_NETWORK_PASSPHRASE"),
  contractId: required("NEXT_PUBLIC_CONTRACT_ID"),
} as const;
