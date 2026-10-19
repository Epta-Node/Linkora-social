import { useCallback, useState } from "react";

import { useToast } from "../context/ToastContext";
import { useWallet } from "./useWallet";
import { useSubmitTx } from "./useSubmitTx";
import { markFeedPostDeleted } from "./useFeed";

interface DeletePostOptions {
  postId: number | string;
  author: string;
}

export interface UseDeletePostResult {
  deleting: boolean;
  error: string | null;
  deletePost: (options: DeletePostOptions) => Promise<boolean>;
}

export function useDeletePost(): UseDeletePostResult {
  const { address, connected } = useWallet();
  const submitTx = useSubmitTx();
  const { showPending, showSuccess, showError } = useToast();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deletePost = useCallback(
    async ({ postId, author }: DeletePostOptions): Promise<boolean> => {
      if (deleting) {
        return false;
      }

      if (!connected || !address) {
        const message = "Connect your wallet to delete this post.";
        setError(message);
        showError(message);
        return false;
      }

      if (address !== author) {
        const message = "Only the post author can delete this post.";
        setError(message);
        showError(message);
        return false;
      }

      setDeleting(true);
      setError(null);
      showPending();

      try {
        // #1591 — submitTx builds real, simulated XDR and returns the hash the
        // chain confirmed. The feed is only updated once that hash exists.
        const txHash = await submitTx(`delete_post:${author}:${postId}`);
        markFeedPostDeleted(String(postId));
        showSuccess(txHash);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to delete post.";
        setError(message);
        showError(message);
        return false;
      } finally {
        setDeleting(false);
      }
    },
    [address, connected, deleting, showError, showPending, showSuccess, submitTx]
  );

  return { deleting, error, deletePost };
}
