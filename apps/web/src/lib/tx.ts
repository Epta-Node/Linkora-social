import {
  TransactionBuilder,
  BASE_FEE,
  Contract,
  Address,
  rpc as StellarRpc,
  Transaction,
  xdr,
} from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/freighter-api";

export interface TransactionConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
}

export interface TransactionResult {
  hash: string;
  status: string;
}

/**
 * Sign and submit a Soroban transaction using Freighter wallet.
 *
 * This function:
 * 1. Simulates the transaction to get resource fees
 * 2. Signs the transaction with the user's wallet
 * 3. Submits it to the RPC server
 * 4. Waits for transaction confirmation
 *
 * @param xdr - The base64-encoded transaction XDR to sign and submit
 * @param config - Transaction configuration (contract ID, RPC URL, network passphrase)
 * @param timeout - Maximum time to wait for confirmation in milliseconds (default: 30000)
 *
 * @returns The transaction hash and final status
 *
 * @throws Error if simulation, signing, submission, or confirmation fails
 *
 * @example
 * ```ts
 * const result = await signAndSubmitTransaction(txXdr, {
 *   contractId: process.env.NEXT_PUBLIC_CONTRACT_ID!,
 *   rpcUrl: process.env.NEXT_PUBLIC_RPC_URL!,
 *   networkPassphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE!,
 * });
 * console.log("Transaction hash:", result.hash);
 * ```
 */
export async function signAndSubmitTransaction(
  xdr: string,
  config: TransactionConfig,
  timeout: number = 30000
): Promise<TransactionResult> {
  const { rpcUrl, networkPassphrase } = config;
  const server = new StellarRpc.Server(rpcUrl);

  // Sign the transaction with Freighter
  const signedXdr = await signTransaction(xdr, {
    networkPassphrase,
  });

  const signedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);

  // Submit the transaction
  const sendResponse = await server.sendTransaction(signedTx);

  if (sendResponse.status === "ERROR") {
    throw new Error("Transaction failed to submit");
  }

  // Wait for transaction confirmation
  let status: string = sendResponse.status;
  const startTime = Date.now();

  while (status === "PENDING" && Date.now() - startTime < timeout) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const txResponse = await server.getTransaction(sendResponse.hash);
    status = txResponse.status as string;
  }

  if (status === "PENDING") {
    throw new Error(`Transaction confirmation timeout after ${timeout}ms`);
  }

  if (status === "ERROR") {
    throw new Error("Transaction failed during execution");
  }

  return {
    hash: sendResponse.hash,
    status,
  };
}

/**
 * Build, sign, and submit a contract method call transaction.
 * This is a convenience wrapper that combines transaction building with signing/submission.
 *
 * @param method - The contract method name to call
 * @param args - Array of ScVal arguments for the method
 * @param sourceAddress - The Stellar public key of the transaction source account
 * @param config - Transaction configuration
 * @param timeout - Maximum time to wait for confirmation in milliseconds
 *
 * @returns The transaction hash and final status
 *
 * @example
 * ```ts
 * const result = await buildSignAndSubmit(
 *   "like_post",
 *   [
 *     Address.fromString(userAddress).toScVal(),
 *     nativeToScVal(postId, { type: "u32" })
 *   ],
 *   userAddress,
 *   {
 *     contractId: process.env.NEXT_PUBLIC_CONTRACT_ID!,
 *     rpcUrl: process.env.NEXT_PUBLIC_RPC_URL!,
 *     networkPassphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE!,
 *   }
 * );
 * ```
 */
export async function buildSignAndSubmit(
  method: string,
  args: xdr.ScVal[],
  sourceAddress: string,
  config: TransactionConfig,
  timeout: number = 30000
): Promise<TransactionResult> {
  const { contractId, rpcUrl, networkPassphrase } = config;
  const server = new StellarRpc.Server(rpcUrl);

  // Get the source account
  const account = await server.getAccount(sourceAddress);

  // Build the operation
  const contract = new Contract(contractId);
  const op = contract.call(method, ...args);

  // Build the transaction
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  // Simulate the transaction
  const simulated = await server.simulateTransaction(tx);
  if (StellarRpc.Api.isSimulationError(simulated)) {
    throw new Error(`Transaction simulation failed: ${simulated.error}`);
  }

  // Assemble the final transaction with simulation results
  const finalTx = StellarRpc.assembleTransaction(tx, simulated).build();
  const xdrString = finalTx.toXDR();

  // Sign and submit
  return signAndSubmitTransaction(xdrString, config, timeout);
}
