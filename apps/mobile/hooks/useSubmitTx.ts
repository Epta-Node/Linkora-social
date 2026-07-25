import { useCallback } from "react";
import { useToast } from "../context/ToastContext";

export function useSubmitTx() {
  const { showPending, showSuccess, showError } = useToast();

  const submitTx = useCallback(
    async (txXdr: string): Promise<string> => {
      showPending();
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, 600));
        const txHash = `mock-tx:${txXdr}:${Date.now()}`;
        showSuccess(txHash);
        return txHash;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to submit transaction";
        showError(msg);
        throw err;
      }
    },
    [showPending, showSuccess, showError]
  );

  return submitTx;
}
