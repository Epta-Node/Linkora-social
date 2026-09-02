import { Transaction, TransactionBuilder } from "@stellar/stellar-base";
import * as rpc from "@stellar/stellar-sdk/rpc";
import { TransactionQueue, QueueSigner, RunOptions, RpcClient } from "./queue.js";
import type { LinkoraClient } from "./client.js";

const { isSimulationError } = rpc.Api;

/**
 * Wraps a Stellar SDK `rpc.Server` to satisfy the {@link RpcClient} interface
 * expected by {@link TransactionQueue}.  The SDK's `Server` has richer
 * method signatures (accepting Transaction objects, extra params, etc.) while
 * `RpcClient` is a narrow, XDR-string-only contract used internally by the
 * queue.
 */
function createRpcAdapter(server: rpc.Server): RpcClient {
  return {
    async simulateTransaction(xdr: string): Promise<SimulationResult> {
      // The SDK's simulateTransaction expects a Transaction object.  Build a
      // minimal Transaction from the XDR string so the call succeeds.
      const { TransactionBuilder } = await import("@stellar/stellar-base");
      // Use a dummy passphrase – the simulation endpoint doesn't validate it.
      const tx = TransactionBuilder.fromXDR(xdr, "Test SDF Network ; September 2015");
      const result = await server.simulateTransaction(tx);
      const isError = isSimulationError(result);
      return {
        success: !isError,
        resourceFee: String("minResourceFee" in result ? result.minResourceFee : "0"),
        error: isError ? result.error : undefined,
      };
    },

    async sendTransaction(signedXdr: string) {
      const { TransactionBuilder } = await import("@stellar/stellar-base");
      const tx = TransactionBuilder.fromXDR(signedXdr, "Test SDF Network ; September 2015");
      const result = await server.sendTransaction(tx);
      return {
        hash: result.hash,
        status: result.status as string,
        errorResultXdr: "errorResultXdr" in result ? String(result.errorResultXdr) : undefined,
      };
    },

    async getTransaction(hash: string) {
      const result = await server.getTransaction(hash);
      return {
        status: result.status as string,
        errorResultXdr: "errorResultXdr" in result ? String(result.errorResultXdr) : undefined,
      };
    },
  };
}

/**
 * Adapt a Soroban-rpc `Server` to the narrower {@link RpcClient} interface that
 * `TransactionQueue` consumes, translating the raw SDK response shapes into the
 * simplified ones the queue expects. Without this, the native `rpc.Server`
 * (whose `simulateTransaction`/`sendTransaction`/`getTransaction` return rich,
 * differently-shaped responses) is not structurally assignable to `RpcClient`.
 */
export function serverToRpcClient(server: rpc.Server): RpcClient {
  return {
    async simulateTransaction(xdr: string): Promise<SimulationResult> {
      const response = await server.simulateTransaction(xdr);
      if (rpc.Api.isSimulationError(response)) {
        return { success: false, resourceFee: "0", error: response.error };
      }
      return { success: true, resourceFee: response.minResourceFee || "0" };
    },
    async sendTransaction(signedXdr: string) {
      const response = await server.sendTransaction(signedXdr);
      return {
        hash: response.hash,
        status: response.status,
        errorResultXdr: response.errorResultXdr,
      };
    },
    async getTransaction(hash: string) {
      const response = await server.getTransaction(hash);
      return { status: response.status, errorResultXdr: response.errorResultXdr };
    },
  };
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
      const errorResultXdr =
        rawXdr ?? (res.errorResult ? res.errorResult.toXDR("base64") : undefined);
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
