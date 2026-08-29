/**
 * RPC Client Adapter
 *
 * Adapts the Stellar SDK's rpc.Server to implement the RpcClient interface.
 * This allows TransactionQueue to use the standard Stellar RPC server while
 * maintaining the RpcClient's XDR-string-based API.
 */

import * as rpc from "@stellar/stellar-sdk/rpc";
import { TransactionBuilder } from "@stellar/stellar-base";
import type { RpcClient, SimulationResult } from "./queue.js";

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
