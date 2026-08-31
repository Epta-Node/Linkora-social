"use client";

import { useState, useCallback } from "react";
import { parseTokenAmount } from "./usePools";
import { classifyError } from "./usePoolContract";

export type TipStatus =
  | "idle"
  | "approving" // allowance approval step
  | "awaiting_sig" // Freighter signature step
  | "submitting" // broadcast to network step
  | "success"
  | "error";

export interface TipResult {
  hash: string;
  ledger: number;
}

export function useTip() {
  const [status, setStatus] = useState<TipStatus>("idle");
  const [result, setResult] = useState<TipResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tip = useCallback(
    async (
      tipper: string,
      postId: number | bigint,
      tokenAddress: string,
      amountRaw: string,
      decimals: number,
      _contractAddress: string // Address of Linkora contract to approve spending limit
    ) => {
      setStatus("approving");
      setError(null);
      setResult(null);

      try {
        const _amount = parseTokenAmount(amountRaw, decimals);

        // Step 1: Simulate the Token allowance step (increase_allowance)
        // In a live integration, we'd invoke token::increase_allowance
        await new Promise((resolve) => setTimeout(resolve, 800));

        // Step 2: Awaiting signature for the actual 'tip' call
        setStatus("awaiting_sig");
        await new Promise((resolve) => setTimeout(resolve, 600));

        // Step 3: Broadcast transaction
        setStatus("submitting");
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Mock a successful transaction result
        const txHash = "tip_tx_" + Math.random().toString(36).substring(2, 11);
        setResult({
          hash: txHash,
          ledger: 12345682,
        });
        setStatus("success");
      } catch (err) {
        setError(classifyError(err));
        setStatus("error");
      }
    },
    []
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setResult(null);
    setError(null);
  }, []);

  return { status, result, error, tip, reset };
}
