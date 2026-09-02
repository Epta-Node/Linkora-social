import { useState, useCallback } from "react";
import { recordPoolDeposit } from "../utils/poolStore";
import { useSubmitTx } from "./useSubmitTx";

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

/**
 * usePoolDeposit
 *
 * Builds a contract-call XDR descriptor for a pool deposit and routes it
 * through useSubmitTx, which signs with the connected wallet and broadcasts to
 * the Soroban RPC. The deposit is recorded locally only after the chain
 * confirms the transaction.
 */
export function usePoolDeposit(): UsePoolDepositReturn {
  const [pending, setPending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string>();

  const submitTx = useSubmitTx();

  const deposit = useCallback(
    async (poolId: string, amount: string, token: string) => {
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

        // Build a structured descriptor that downstream code (SDK or contract
        // layer) turns into real XDR.  The format mirrors what useLike /
        // useFollow use today until the full Soroban SDK integration lands.
        const txDescriptor = `pool_deposit:${poolId}:${amount}:${token}`;

        const hash = await submitTx(txDescriptor);

        // Record the deposit locally only after the chain confirms it
        recordPoolDeposit(poolId, amount);

        setTxHash(hash);
        setSuccess(true);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Deposit failed. Please try again.";
        setError(message);
      } finally {
        setPending(false);
      }
    },
    [submitTx]
  );

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
