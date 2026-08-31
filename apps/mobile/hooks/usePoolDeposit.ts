import { useState, useCallback } from "react";
import { recordPoolDeposit } from "../utils/poolStore";

export interface DepositState {
  pending: boolean;
  success: boolean;
  error: string | null;
  txHash?: string;
}

export interface UsePoolDepositReturn extends DepositState {
  deposit: (poolId: string, amount: string, token: string) => Promise<void>;
  reset: () => void;
}

export function usePoolDeposit(): UsePoolDepositReturn {
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string>();

  const deposit = useCallback(async (poolId: string, amount: string, token: string) => {
    setPending(true);
    setError(null);
    setSuccess(false);

    try {
      if (!amount || parseFloat(amount) <= 0) {
        throw new Error("Amount must be greater than zero");
      }

      if (!token) {
        throw new Error("Token is required");
      }

      await new Promise<void>((resolve) => setTimeout(resolve, 1500));

      const mockTxHash = `0x${Math.random().toString(16).slice(2)}`;
      recordPoolDeposit(poolId, amount);
      setTxHash(mockTxHash);
      setSuccess(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Deposit failed. Please try again.";
      setError(message);
    } finally {
      setPending(false);
    }
  }, []);

  const reset = useCallback(() => {
    setPending(false);
    setSuccess(false);
    setError(null);
    setTxHash(undefined);
  }, []);

  return {
    pending,
    success,
    error,
    txHash,
    deposit,
    reset,
  };
}
