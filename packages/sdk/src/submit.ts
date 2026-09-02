import { Transaction, TransactionBuilder } from "@stellar/stellar-base";
import * as rpc from "@stellar/stellar-sdk/rpc";
import { TransactionQueue, QueueSigner, RunOptions, RpcClient } from "./queue.js";
import type { LinkoraClient } from "./client.js";

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
  const networkPassphrase =
    (client as unknown as { _networkPassphrase?: string })._networkPassphrase ??
    (client as unknown as { networkPassphrase?: string }).networkPassphrase ??
    "Test SDF Network ; September 2015";

  const server = client.createRpcServer();
  const rpcAdapter: RpcClient = {
    async simulateTransaction(xdr: string) {
      const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
      const res = await server.simulateTransaction(tx);
      if (rpc.Api.isSimulationSuccess(res)) {
        return {
          success: true,
          resourceFee: res.minResourceFee || "0",
        };
      }
      return {
        success: false,
        resourceFee: "0",
        error: rpc.Api.isSimulationError(res) ? res.error : "Simulation failed",
      };
    },
    async sendTransaction(signedXdr: string) {
      const tx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
      const res = await server.sendTransaction(tx);
      const rawXdr = (res as unknown as { errorResultXdr?: string }).errorResultXdr;
      const errorResultXdr = rawXdr ?? (res.errorResult ? res.errorResult.toXDR("base64") : undefined);
      return {
        hash: res.hash,
        status: res.status,
        errorResultXdr,
      };
    },
    async getTransaction(hash: string) {
      const res = await server.getTransaction(hash);
      const failedRes =
        res.status === rpc.Api.GetTransactionStatus.FAILED
          ? (res as rpc.Api.GetFailedTransactionResponse)
          : undefined;
      const errorResultXdr = failedRes?.resultXdr ? failedRes.resultXdr.toXDR("base64") : undefined;
      return {
        status: res.status,
        errorResultXdr,
      };
    },
  };

  const queue = new TransactionQueue({
    signer,
    rpc: rpcAdapter,
  });

  queue.enqueue(xdrString);
  await queue.run(opts);
  
  const hashes = queue.submittedHashes;
  if (hashes.length === 0 && !opts?.dryRun) {
    throw new Error("Transaction was not submitted successfully.");
  }
  
  return hashes[0] ?? "";
}
