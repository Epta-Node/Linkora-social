"use client";

import { useEffect, useRef, useState } from "react";
import { TokenFormValues } from "./StepTokenDetails";
import { getLinkoraClient } from "@/lib/linkoraClient";

type DeployPhase =
  | "idle"
  | "signing_deploy"
  | "deploying"
  | "signing_profile"
  | "registering"
  | "done";

interface Props {
  deployerAddress: string;
  tokenForm: TokenFormValues;
  onSuccess: (tokenAddress: string) => void;
  onError: (message: string) => void;
  error: string | null;
  onRetry: () => void;
}

async function signWithFreighter(xdr: string): Promise<string> {
  const { signTransaction } = await import("@stellar/freighter-api");
  const result = await signTransaction(xdr, { network: "TESTNET" });
  if (typeof result === "string") return result;
  // Newer Freighter API returns an object
  if (result && typeof result === "object" && "signedTxXdr" in result) {
    return (result as { signedTxXdr: string }).signedTxXdr;
  }
  throw new Error("Unexpected response from Freighter");
}

async function submitAndGetResult(signedXdr: string, rpcUrl: string): Promise<string> {
  const { rpc: stellarRpc, TransactionBuilder } = await import("@stellar/stellar-sdk");
  const server = new stellarRpc.Server(rpcUrl);
  const tx = TransactionBuilder.fromXDR(signedXdr, "Test SDF Network ; September 2015");
  const sendResult = await server.sendTransaction(tx);
  if (sendResult.status === "ERROR")
    throw new Error("Transaction failed: " + sendResult.errorResult);

  // Poll for result
  let attempts = 0;
  while (attempts < 30) {
    await new Promise((r) => setTimeout(r, 2000));
    const getResult = await server.getTransaction(sendResult.hash);
    if (getResult.status === "SUCCESS") {
      // Extract the returned Address from the result
      const { scValToNative } = await import("@stellar/stellar-sdk");
      const retval = getResult.returnValue;
      if (!retval) throw new Error("No return value from deploy transaction");
      return scValToNative(retval) as string;
    }
    if (getResult.status === "FAILED") {
      throw new Error("Transaction failed on-chain");
    }
    attempts++;
  }
  throw new Error("Transaction confirmation timed out");
}

export function StepDeploy({
  deployerAddress,
  tokenForm,
  onSuccess,
  onError,
  error,
  onRetry,
}: Props) {
  const [phase, setPhase] = useState<DeployPhase>("idle");
  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    (async () => {
      try {
        const client = getLinkoraClient();
        const rpcUrl =
          process.env.NEXT_PUBLIC_STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org";

        // ── Step 1: Deploy token ───────────────────────────────────────────
        setPhase("signing_deploy");
        const { deployTx, setProfileTxBuilder } = client.setProfileWithNewToken(
          deployerAddress, // username placeholder — replaced after deploy
          {
            deployer: deployerAddress,
            name: tokenForm.name,
            symbol: tokenForm.symbol,
            decimals: tokenForm.decimals,
            initialSupply: BigInt(tokenForm.initialSupply || "0"),
          }
        );

        const signedDeployXdr = await signWithFreighter(deployTx);
        setPhase("deploying");
        const tokenAddress = await submitAndGetResult(signedDeployXdr, rpcUrl);

        // ── Step 2: Register profile ───────────────────────────────────────
        setPhase("signing_profile");
        const setProfileXdr = setProfileTxBuilder(tokenAddress);
        const signedProfileXdr = await signWithFreighter(setProfileXdr);
        setPhase("registering");
        // For set_profile we just need the transaction to succeed (no return value needed)
        const { rpc: stellarRpc, TransactionBuilder } = await import("@stellar/stellar-sdk");
        const server = new stellarRpc.Server(rpcUrl);
        const profileTx = TransactionBuilder.fromXDR(
          signedProfileXdr,
          "Test SDF Network ; September 2015"
        );
        const sendResult = await server.sendTransaction(profileTx);
        if (sendResult.status === "ERROR") throw new Error("Profile registration failed");

        setPhase("done");
        onSuccess(tokenAddress);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "An unexpected error occurred.";
        onError(msg);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const phaseLabel: Record<DeployPhase, string> = {
    idle: "Starting…",
    signing_deploy: "Sign the deploy transaction in Freighter…",
    deploying: "Deploying token on Stellar…",
    signing_profile: "Sign the profile registration in Freighter…",
    registering: "Registering your profile…",
    done: "All done!",
  };

  if (error) {
    return (
      <div role="alert" className="text-center">
        <p className="text-red-500 font-medium mb-2">Something went wrong</p>
        <p className="text-sm text-gray-500 mb-5">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-2 bg-violet-600 text-white text-sm rounded-lg hover:bg-violet-700"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="text-center">
      <h2 className="text-lg font-semibold mb-1">Deploying</h2>
      <p className="text-sm text-gray-500 mb-8">
        Follow the prompts in Freighter. Do not close this window.
      </p>

      <div className="flex flex-col gap-3">
        {(["signing_deploy", "deploying", "signing_profile", "registering"] as const).map(
          (p, idx) => {
            const stepLabels = [
              "Deploying token…",
              "Confirming on Stellar…",
              "Registering profile…",
              "Finalising…",
            ];
            const isActive = phase === p;
            const isDone =
              ["signing_deploy", "deploying", "signing_profile", "registering"].indexOf(phase) >
                idx || phase === "done";

            return (
              <div key={p} className="flex items-center gap-3">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs border-2 flex-shrink-0 ${
                    isDone
                      ? "bg-violet-600 border-violet-600 text-white"
                      : isActive
                        ? "border-violet-600 border-2 animate-pulse text-violet-600"
                        : "border-gray-300 text-gray-300"
                  }`}
                  aria-hidden="true"
                >
                  {isDone ? "✓" : isActive ? "●" : "○"}
                </div>
                <span
                  className={`text-sm ${
                    isDone
                      ? "text-gray-700"
                      : isActive
                        ? "text-violet-700 font-medium"
                        : "text-gray-400"
                  }`}
                >
                  {stepLabels[idx]}
                </span>
              </div>
            );
          }
        )}
      </div>

      <p
        role="status"
        aria-live="polite"
        className="mt-6 text-sm text-violet-600 font-medium animate-pulse"
      >
        {phaseLabel[phase]}
      </p>
    </div>
  );
}
