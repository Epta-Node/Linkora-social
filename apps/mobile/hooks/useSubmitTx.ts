import { useCallback } from "react";
import { useToast } from "../context/ToastContext";
import { useNetworkContext } from "../context/NetworkContext";

// ---------------------------------------------------------------------------
// Types for the Soroban RPC responses we care about
// ---------------------------------------------------------------------------

interface SendTransactionResponse {
  hash: string;
  status: "PENDING" | "DUPLICATE" | "TRY_AGAIN_LATER" | "ERROR";
  errorResult?: unknown;
}

interface GetTransactionResponse {
  status: "SUCCESS" | "FAILED" | "NOT_FOUND";
  resultXdr?: string;
  resultMetaXdr?: string;
  envelopeXdr?: string;
  createdAt?: number;
}

// ---------------------------------------------------------------------------
// Soroban RPC helpers
// ---------------------------------------------------------------------------

async function rpcRequest<T>(
  rpcUrl: string,
  method: string,
  params: unknown[]
): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC HTTP error ${response.status}: ${response.statusText}`);
  }

  const json = (await response.json()) as { result?: T; error?: { message: string } };

  if (json.error) {
    throw new Error(`RPC error: ${json.error.message}`);
  }

  if (json.result === undefined) {
    throw new Error("RPC returned no result");
  }

  return json.result;
}

/**
 * Submit a signed transaction XDR to the Soroban RPC and return the tx hash.
 * Throws if the RPC rejects submission.
 */
async function sendTransaction(
  rpcUrl: string,
  signedXdr: string
): Promise<SendTransactionResponse> {
  return rpcRequest<SendTransactionResponse>(rpcUrl, "sendTransaction", [{ transaction: signedXdr }]);
}

/**
 * Poll getTransaction until the chain confirms (SUCCESS/FAILED) or the timeout
 * elapses. Defaults: poll every 1 s, give up after 30 s.
 */
async function pollTransaction(
  rpcUrl: string,
  hash: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<GetTransactionResponse> {
  const { intervalMs = 1_000, timeoutMs = 30_000 } = opts;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await rpcRequest<GetTransactionResponse>(rpcUrl, "getTransaction", [{ hash }]);

    if (result.status === "SUCCESS") return result;
    if (result.status === "FAILED") {
      throw new Error(`Transaction failed on-chain (hash: ${hash})`);
    }

    // NOT_FOUND — still pending, wait and try again
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Transaction confirmation timed out (hash: ${hash})`);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useSubmitTx
 *
 * Returns a `submitTx(txXdr)` function that:
 *   1. Asks the connected wallet SDK to sign the provided XDR.
 *   2. Broadcasts the signed XDR via the Soroban RPC sendTransaction endpoint.
 *   3. Polls getTransaction until the chain confirms or a 30 s timeout elapses.
 *   4. Returns the real transaction hash.
 *
 * Toasts are shown for pending / success / error states.
 */
export function useSubmitTx() {
  const { showPending, showSuccess, showError } = useToast();
  const { rpcUrl } = useNetworkContext();

  const submitTx = useCallback(
    async (txXdr: string): Promise<string> => {
      showPending();

      try {
        // Obtain the wallet adapter that was injected into the global by WalletContext
        const walletKit = (globalThis as { __LINKORA_WALLET_KIT__?: {
          signTransaction?: (payload: { txXdr: string }) => Promise<{
            signedTxXdr?: string;
            signedXdr?: string;
            signed?: string;
          }>;
          signAndSubmitTransaction?: (payload: {
            txXdr: string;
            rpcUrl?: string;
          }) => Promise<{ hash?: string; txHash?: string }>;
        } }).__LINKORA_WALLET_KIT__;

        if (!walletKit) {
          throw new Error("No wallet connected. Please connect your wallet first.");
        }

        // ------------------------------------------------------------------
        // Sign + broadcast
        // ------------------------------------------------------------------

        // Prefer the full sign-and-submit path if the adapter exposes it
        // (some wallet SDKs handle the broadcast internally).
        if (typeof walletKit.signAndSubmitTransaction === "function") {
          const result = await walletKit.signAndSubmitTransaction({ txXdr, rpcUrl });
          const hash = result.hash ?? result.txHash;
          if (!hash) throw new Error("Wallet returned no transaction hash");
          showSuccess(hash);
          return hash;
        }

        // Otherwise: sign → broadcast → poll
        if (typeof walletKit.signTransaction !== "function") {
          throw new Error("Wallet does not support transaction signing");
        }

        const signed = await walletKit.signTransaction({ txXdr });
        const signedXdr = signed.signedTxXdr ?? signed.signedXdr ?? signed.signed;
        if (!signedXdr) {
          throw new Error("Wallet did not return a signed transaction XDR");
        }

        const submission = await sendTransaction(rpcUrl, signedXdr);

        if (submission.status === "ERROR") {
          throw new Error(`Transaction rejected by network (status: ${submission.status})`);
        }

        // Wait for chain confirmation
        await pollTransaction(rpcUrl, submission.hash);

        showSuccess(submission.hash);
        return submission.hash;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to submit transaction";
        showError(msg);
        throw err;
      }
    },
    [showPending, showSuccess, showError, rpcUrl]
  );

  return submitTx;
}
