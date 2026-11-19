"use client";

/**
 * Optimistic post like.
 *
 * The heart and the like counter flip on click; the transaction is submitted
 * afterwards. A failure restores the previous heart/count and shows a toast
 * explaining that the like was not recorded.
 */

import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@/components/WalletProvider";
import { submitLikeTransaction } from "@/lib/likeTransaction";
import { OptimisticStore, useOptimisticLike, type LikeState } from "@/lib/optimisticStore";
import { queryKeys } from "@/lib/queryKeys";
import { toast } from "@/lib/toast";
import { classifyError } from "./usePoolContract";
import { getErrorMessage } from "@/lib/errorClassifier";

export interface UseLikeMutationOptions {
  postId: string | number;
  /** Defaults to the connected wallet. */
  user?: string | null;
  /** `has_liked` for the connected user. */
  initialHasLiked?: boolean;
  /** Current like count used to seed the optimistic counter. */
  initialLikeCount: number;
  /** Injected transaction submitter (tests use a controllable promise). */
  submitLike?: (user: string, postId: string | number) => Promise<unknown>;
  onConfirmed?: (state: LikeState) => void;
}

interface LikeMutationContext {
  previous: LikeState;
  optimistic: LikeState;
  storeKey: string;
}

function likeStoreKey(user: string | null, postId: string | number): string {
  return `${user}:${postId}`;
}

function getTransactionHash(result: unknown): string | undefined {
  if (!result || typeof result !== "object" || !("hash" in result)) return undefined;
  const hash = result.hash;
  return typeof hash === "string" && hash ? hash : undefined;
}

export function useLikeMutation({
  postId,
  user: userOverride,
  initialHasLiked = false,
  initialLikeCount,
  submitLike,
  onConfirmed,
}: UseLikeMutationOptions) {
  const wallet = useWallet();
  const user = userOverride === undefined ? wallet.address : userOverride;
  const queryClient = useQueryClient();

  const queryKey = queryKeys.postLike(user, postId);
  const storeKey = likeStoreKey(user, postId);

  const serverStateRef = useRef<LikeState>({
    isLiked: initialHasLiked,
    likeCount: initialLikeCount,
  });
  serverStateRef.current = {
    isLiked: initialHasLiked,
    likeCount: initialLikeCount,
  };

  const state = useOptimisticLike(user, postId, serverStateRef.current);

  const mutation = useMutation<{ txHash?: string }, Error, void, LikeMutationContext>({
    mutationFn: async () => {
      if (!user) {
        throw new Error("Connect your wallet to like posts.");
      }
      const submit = submitLike ?? submitLikeTransaction;
      const result = await submit(user, postId);
      return { txHash: getTransactionHash(result) };
    },

    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey });

      const previous = queryClient.getQueryData<LikeState>(queryKey) ?? serverStateRef.current;
      // Liking is idempotent on-chain, so there is no unlike path to
      // optimistically apply.
      const optimistic: LikeState = {
        isLiked: true,
        likeCount: previous.likeCount + 1,
      };

      queryClient.setQueryData<LikeState>(queryKey, optimistic);
      OptimisticStore.snapshotLikeState(storeKey);
      OptimisticStore.setLikeState(storeKey, optimistic);

      return { previous, optimistic, storeKey };
    },

    onError: (error, _variables, context) => {
      if (context) {
        queryClient.setQueryData<LikeState>(queryKey, context.previous);
        const rolledBack = OptimisticStore.rollbackLikeState(context.storeKey);
        if (!rolledBack) OptimisticStore.clearLikeState(context.storeKey);
      } else {
        queryClient.setQueryData<LikeState>(queryKey, serverStateRef.current);
        OptimisticStore.clearLikeState(storeKey);
      }

      toast.error({
        title: "Like didn't go through",
        description: `${getErrorMessage(error)}. Your like was rolled back.`,
        duration: 5000,
      });
    },

    onSuccess: (result, _variables, context) => {
      if (!context) return;

      queryClient.setQueryData<LikeState>(queryKey, context.optimistic);
      OptimisticStore.commitLikeState(context.storeKey);
      onConfirmed?.(context.optimistic);
      toast.success({
        title: "Like confirmed",
        txHash: result.txHash,
        duration: 5000,
      });
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey, refetchType: "none" });
    },
  });

  // Drop the overlay once the server's like state/count match it, so refetches
  // are allowed to update the card again.
  useEffect(() => {
    if (mutation.isPending) return;

    const optimistic = OptimisticStore.getLikeState(storeKey);
    if (!optimistic) return;

    if (optimistic.isLiked === initialHasLiked && optimistic.likeCount === initialLikeCount) {
      OptimisticStore.clearLikeState(storeKey);
    }
  }, [initialHasLiked, initialLikeCount, storeKey, mutation.isPending]);

  const like = useCallback(async (): Promise<boolean> => {
    // Idempotent: ignore repeat clicks and clicks while a transaction is
    // already in flight.
    if (state.isLiked || mutation.isPending) return false;

    if (!user) {
      toast.error({
        title: "Wallet not connected",
        description: "Connect your wallet to like posts.",
      });
      return false;
    }

    try {
      await mutation.mutateAsync();
      return true;
    } catch {
      // onError already rolled back the optimistic state and raised a toast.
      return false;
    }
  }, [state.isLiked, mutation, user]);

  return {
    liked: state.isLiked,
    isLiked: state.isLiked,
    likeCount: state.likeCount,
    pending: mutation.isPending,
    isPending: mutation.isPending,
    error: mutation.error ? classifyError(mutation.error) : null,
    like,
    reset: mutation.reset,
  };
}
