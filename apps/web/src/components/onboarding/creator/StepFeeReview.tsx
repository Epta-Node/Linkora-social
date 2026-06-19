"use client";

import { useEffect } from "react";
import { TokenFormValues } from "./StepTokenDetails";
import { getLinkoraClient } from "@/lib/linkoraClient";

interface Props {
  deployerAddress: string;
  tokenForm: TokenFormValues;
  estimatedFee: string | null;
  onFeeLoaded: (fee: string) => void;
  onBack: () => void;
  onProceed: () => void;
}

export function StepFeeReview({
  deployerAddress,
  tokenForm,
  estimatedFee,
  onFeeLoaded,
  onBack,
  onProceed,
}: Props) {
  useEffect(() => {
    if (estimatedFee !== null) return;

    let cancelled = false;
    (async () => {
      try {
        const client = getLinkoraClient();
        // Simulate the deploy_creator_token call to get a fee estimate
        const deployXdr = client.deployCreatorToken({
          deployer: deployerAddress,
          name: tokenForm.name,
          symbol: tokenForm.symbol,
          decimals: tokenForm.decimals,
          initialSupply: BigInt(tokenForm.initialSupply || "0"),
        });
        // The XDR size gives a rough proxy; real simulation would call rpc.simulateTransaction
        // For now we return an estimated range based on typical Soroban contract deploy costs.
        // A full implementation would submit `deployXdr` to simulateTransaction.
        void deployXdr;
        if (!cancelled) onFeeLoaded("~0.05–0.20 XLM");
      } catch {
        if (!cancelled) onFeeLoaded("Unable to estimate");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deployerAddress, estimatedFee, onFeeLoaded, tokenForm]);

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">Review Estimated Fees</h2>
      <p className="text-sm text-gray-500 mb-5">
        Deploying a token on Stellar incurs network fees. Review before signing.
      </p>

      <dl className="divide-y divide-gray-100 text-sm mb-6">
        <div className="py-3 flex justify-between">
          <dt className="text-gray-500">Token name</dt>
          <dd className="font-medium">{tokenForm.name}</dd>
        </div>
        <div className="py-3 flex justify-between">
          <dt className="text-gray-500">Symbol</dt>
          <dd className="font-mono font-medium">{tokenForm.symbol}</dd>
        </div>
        <div className="py-3 flex justify-between">
          <dt className="text-gray-500">Decimals</dt>
          <dd>{tokenForm.decimals}</dd>
        </div>
        <div className="py-3 flex justify-between">
          <dt className="text-gray-500">Initial supply</dt>
          <dd>
            {tokenForm.initialSupply ? Number(tokenForm.initialSupply).toLocaleString() : "0"}
          </dd>
        </div>
        <div className="py-3 flex justify-between">
          <dt className="text-gray-500">Estimated deploy fee</dt>
          <dd>
            {estimatedFee === null ? (
              <span className="animate-pulse text-gray-400">Calculating…</span>
            ) : (
              <span className="font-semibold text-violet-700">{estimatedFee}</span>
            )}
          </dd>
        </div>
        <div className="py-3 flex justify-between">
          <dt className="text-gray-500">Set profile fee</dt>
          <dd className="font-semibold text-violet-700">~0.005 XLM</dd>
        </div>
      </dl>

      <p className="text-xs text-gray-400 mb-6">
        Fees are paid in XLM from your wallet. Actual fees may vary with network congestion.
      </p>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 px-4 py-2 border border-gray-300 text-sm font-medium rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-violet-500"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onProceed}
          disabled={estimatedFee === null}
          className="flex-1 px-4 py-2 bg-violet-600 text-white text-sm font-medium rounded-lg hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-violet-500"
        >
          Proceed to Sign →
        </button>
      </div>
    </div>
  );
}
