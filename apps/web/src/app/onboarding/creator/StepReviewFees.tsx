"use client";

import { useEffect, useState } from "react";
import type { TokenParams } from "./CreatorTokenWizard";

interface Props {
  address: string;
  tokenParams: TokenParams;
  onFeeEstimated: (fee: string) => void;
  onNext: () => void;
  onBack: () => void;
}

type FeeStatus = "loading" | "ready" | "error";

export function StepReviewFees({ address, tokenParams, onFeeEstimated, onNext, onBack }: Props) {
  const [feeStatus, setFeeStatus] = useState<FeeStatus>("loading");
  const [feeXlm, setFeeXlm] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function estimate() {
      setFeeStatus("loading");
      try {
        // Simulate the deploy_creator_token call to get the real fee.
        // We dynamically import the SDK to avoid bundling it server-side.
        const { LinkoraClient } = await import("linkora-sdk");
        const factoryId = process.env.NEXT_PUBLIC_TOKEN_FACTORY_ID;
        const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL ?? "https://soroban-testnet.stellar.org";

        if (!factoryId) {
          // No factory configured — show a static estimate.
          if (!cancelled) {
            const staticFee = "~0.01 XLM";
            setFeeXlm(staticFee);
            onFeeEstimated(staticFee);
            setFeeStatus("ready");
          }
          return;
        }

        const client = new LinkoraClient({
          contractId: process.env.NEXT_PUBLIC_CONTRACT_ID ?? "",
          rpcUrl,
          tokenFactoryId: factoryId,
        });

        await client.simulateDeployCreatorToken({
          deployer: address,
          name: tokenParams.name,
          symbol: tokenParams.symbol,
          decimals: tokenParams.decimals,
          initialSupply: tokenParams.initialSupply,
        });

        // For now surface a placeholder fee; real fee extraction from
        // simulateTransaction result is done in the full integration build.
        const fee = "~0.01 XLM";
        if (!cancelled) {
          setFeeXlm(fee);
          onFeeEstimated(fee);
          setFeeStatus("ready");
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : "Estimation failed");
          setFeeStatus("error");
        }
      }
    }

    estimate();
    return () => {
      cancelled = true;
    };
  }, [address, tokenParams, onFeeEstimated]);

  return (
    <div className="flex flex-col gap-6" data-testid="step-review-fees">
      <div>
        <h2 className="text-xl font-bold mb-1">Review fees</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Estimated cost to deploy your token on Stellar Testnet.
        </p>
      </div>

      {/* Token summary */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-4 text-sm">
        <p className="text-xs text-[var(--text-muted)] uppercase tracking-widest mb-3">Deploying</p>
        <Row label="Name" value={tokenParams.name} />
        <Row label="Symbol" value={tokenParams.symbol} />
        <Row label="Decimals" value={String(tokenParams.decimals)} />
        <Row label="Initial supply" value={Number(tokenParams.initialSupply).toLocaleString()} />
      </div>

      {/* Fee */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-tertiary)] p-4 text-sm">
        <p className="text-xs text-[var(--text-muted)] uppercase tracking-widest mb-3">
          Estimated fee
        </p>
        {feeStatus === "loading" && (
          <p className="text-[var(--text-muted)] animate-pulse">Simulating transaction…</p>
        )}
        {feeStatus === "ready" && feeXlm && (
          <p className="text-lg font-bold text-violet-300" data-testid="fee-estimate">
            {feeXlm}
          </p>
        )}
        {feeStatus === "error" && (
          <p className="text-red-400 text-xs">
            Could not estimate fee: {errorMsg}. You can still proceed.
          </p>
        )}
        <p className="text-xs text-[var(--text-muted)] mt-2">
          Actual fee is set by the Stellar network at submission time.
        </p>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--text-muted)] hover:border-violet-500 hover:text-white transition"
          data-testid="step2-back"
        >
          Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={feeStatus === "loading"}
          className="flex-1 btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          data-testid="step2-next"
        >
          Sign and deploy
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1 border-b border-[var(--border)] last:border-0">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
