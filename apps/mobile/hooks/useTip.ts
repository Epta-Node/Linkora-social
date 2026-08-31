import { useCallback, useMemo, useState } from "react";

import { useToast } from "../context/ToastContext";
import { useWallet } from "./useWallet";

export type TipStatus = "idle" | "pending" | "success" | "error";

export interface TipToken {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
}

export interface TipResult {
  hash: string;
  amount: number;
  token: TipToken;
  protocolFee: number;
}

interface SubmitTipOptions {
  postId: number | string;
  amount: number;
  token: TipToken;
}

export interface UseTipResult {
  status: TipStatus;
  pending: boolean;
  error: string | null;
  result: TipResult | null;
  estimateProtocolFee: (amount: number) => number;
  tip: (options: SubmitTipOptions) => Promise<boolean>;
  reset: () => void;
}

const PROTOCOL_FEE_BPS = 100;

async function submitTipTransaction({
  sender,
  postId,
  amount,
  token,
}: SubmitTipOptions & { sender: string }): Promise<string> {
  // Replace with SDK-backed `tip(sender, postId, token, amount)` submission once signing is wired.
  await new Promise<void>((resolve) => setTimeout(resolve, 800));
  return `tip:${sender}:${postId}:${token.symbol}:${amount}:${Date.now()}`;
}

export function useTip(): UseTipResult {
  const { address, connected } = useWallet();
  const { showPending, showSuccess, showError } = useToast();
  const [status, setStatus] = useState<TipStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TipResult | null>(null);

  const estimateProtocolFee = useCallback((amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) {
      return 0;
    }

    return amount * (PROTOCOL_FEE_BPS / 10_000);
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setResult(null);
  }, []);

  const tip = useCallback(
    async ({ postId, amount, token }: SubmitTipOptions): Promise<boolean> => {
      if (status === "pending") {
        return false;
      }

      if (!connected || !address) {
        const message = "Connect your wallet to tip this post.";
        setStatus("error");
        setError(message);
        showError(message);
        return false;
      }

      if (!Number.isFinite(amount) || amount <= 0) {
        const message = "Enter a positive, non-zero tip amount.";
        setStatus("error");
        setError(message);
        showError(message);
        return false;
      }

      setStatus("pending");
      setError(null);
      setResult(null);
      showPending();

      try {
        const hash = await submitTipTransaction({ sender: address, postId, amount, token });
        const protocolFee = estimateProtocolFee(amount);
        setResult({ hash, amount, token, protocolFee });
        setStatus("success");
        showSuccess(hash);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to submit tip.";
        setStatus("error");
        setError(message);
        showError(message);
        return false;
      }
    },
    [address, connected, estimateProtocolFee, showError, showPending, showSuccess, status]
  );

  const pending = status === "pending";

  return useMemo(
    () => ({
      status,
      pending,
      error,
      result,
      estimateProtocolFee,
      tip,
      reset,
    }),
    [error, estimateProtocolFee, pending, reset, result, status, tip]
  );
}

export { PROTOCOL_FEE_BPS, submitTipTransaction };
