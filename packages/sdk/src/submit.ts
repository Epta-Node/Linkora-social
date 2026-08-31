/**
 * RPC Client Adapter
 *
 * Adapts the Stellar SDK's rpc.Server to implement the RpcClient interface.
 * This allows TransactionQueue to use the standard Stellar RPC server while
 * maintaining the RpcClient's XDR-string-based API.
 */

import * as rpc from "@stellar/stellar-sdk/rpc";
import { TransactionBuilder, Transaction } from "@stellar/stellar-base";
import type { RpcClient, SimulationResult } from "./queue.js";
import { TransactionQueue, QueueSigner, RunOptions } from "./queue.js";
import type { LinkoraClient } from "./client.js";

/**
 * Adapter that wraps rpc.Server to implement the RpcClient interface.
 *
 * The Stellar SDK's rpc.Server.simulateTransaction accepts Transaction objects,
 * while our RpcClient interface expects XDR strings. This adapter converts
 * between the two formats.
 */
export class RpcServerAdapter implements RpcClient {
  private readonly server: rpc.Server;
  private readonly networkPassphrase: string;

  constructor(rpcUrl: string, networkPassphrase: string, allowHttp = false) {
    this.server = new rpc.Server(rpcUrl, { allowHttp });
    this.networkPassphrase = networkPassphrase;
  }

  /**
   * Simulate a transaction from XDR string.
   *
   * Parses the XDR string into a Transaction object, calls the Stellar SDK's
   * simulateTransaction, and converts the result back to our SimulationResult format.
   */
  async simulateTransaction(xdrString: string): Promise<SimulationResult> {
    const tx = TransactionBuilder.fromXDR(xdrString, this.networkPassphrase);

    const result = await this.server.simulateTransaction(tx);

    if (rpc.Api.isSimulationError(result)) {
      return {
        success: false,
        resourceFee: "0",
        error: result.error,
      };
    }

    return {
      success: true,
      resourceFee: "0",
    };
  }

  /**
   * Send a signed transaction to the network.
   */
  async sendTransaction(
    signedXdr: string
  ): Promise<{ hash: string; status: string; errorResultXdr?: string }> {
    const tx = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);
    const result = await this.server.sendTransaction(tx);

    return {
      hash: result.hash,
      status: result.status,
      errorResultXdr: result.errorResult?.toXDR("base64"),
    };
  }

  /**
   * Get transaction status by hash.
   */
  async getTransaction(hash: string): Promise<{ status: string; errorResultXdr?: string }> {
    const result = await this.server.getTransaction(hash);

    return {
      status: result.status,
      errorResultXdr: undefined,
    };
  }
}

/**
 * Create an RpcClient from an RPC URL and network passphrase.
 *
 * This is a convenience function that returns an RpcServerAdapter,
 * which implements the RpcClient interface using the Stellar SDK's rpc.Server.
 */
export function createRpcClient(
  rpcUrl: string,
  networkPassphrase: string,
  allowHttp = false
): RpcClient {
  return new RpcServerAdapter(rpcUrl, networkPassphrase, allowHttp);
}

/**
 * Convenience helper to sign and submit a single transaction.
 * Internally sets up a TransactionQueue, enqueues the transaction, and runs it.
 *
 * @param client The LinkoraClient instance used for RPC communication.
 * @param xdrOrTx The transaction to submit (base64 XDR string or Transaction object).
 * @param signer The wallet signer (e.g. FreighterSigner or LedgerSigner).
 * @param opts Optional RunOptions for the queue.
 * @returns The hash of the submitted transaction.
 */
export async function submitTransaction(
  client: LinkoraClient,
  xdrOrTx: string | Transaction,
  signer: QueueSigner,
  opts?: RunOptions
): Promise<string> {
  const xdrString = typeof xdrOrTx === "string" ? xdrOrTx : xdrOrTx.toEnvelope().toXDR("base64");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rpcClient = await (client as any).createRpcClient();

  const queue = new TransactionQueue({
    signer,
    rpc: rpcClient,
  });

  queue.enqueue(xdrString);
  await queue.run(opts);

  const hashes = queue.submittedHashes;
  if (hashes.length === 0 && !opts?.dryRun) {
    throw new Error("Transaction was not submitted successfully.");
  }

  return hashes[0] ?? "";
}
