"use client";

/**
 * Optimistic follow / unfollow.
 *
 * Clicking the button must feel instant even though the follow is a Soroban
 * transaction that takes seconds to confirm. The hook therefore:
 *
 *  1. `onMutate` snapshots the current state, flips the button and adjusts the
 *     follower count in the shared optimistic store (and the query cache)
 *     before the transaction is even submitted.
 *  2. `onError` restores the snapshot and raises a descriptive toast, so a
 *     rejected or failed transaction never leaves the UI lying.
 *  3. `onSuccess` commits the optimistic value (chain now agrees) and lets the
 *     caller refetch server truth in the background.
 */

import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useWallet } from "@/components/WalletProvider";
import { submitFollowTransaction, type FollowTransactionInput } from "@/lib/followTransaction";
import { OptimisticStore, useOptimisticFollow, type FollowState } from "@/lib/optimisticStore";
import { queryKeys } from "@/lib/queryKeys";
import { toast } from "@/lib/toast";
import { classifyError } from "./usePoolContract";
import { getErrorMessage } from "@/lib/errorClassifier";

export interface UseFollowMutationOptions {
  /** Account being followed / unfollowed. */
  followee: string;
  /** Defaults to the connected wallet. */
  follower?: string | null;
  initialIsFollowing?: boolean;
  initialFollowersCount?: number;
  initialFollowingCount?: number;
  /**
   * Injected transaction submitter. Defaults to the real Stellar/Freighter
   * flow; tests pass a controllable promise.
   */
  submitFollow?: (input: FollowTransactionInput) => Promise<unknown>;
  /** Called after the transaction is confirmed so the page can refetch. */
  onConfirmed?: (state: FollowState) => void;
}

interface FollowMutationVariables {
  isFollowing: boolean;
}

interface FollowMutationContext {
  previous: FollowState;
  optimistic: FollowState;
  storeKey: string;
}

function storeKeyFor(follower: string | null, followee: string): string {
  return `${follower}:${followee}`;
}

/** Message explaining which action failed and that the UI was restored. */
function rollbackDescription(isFollowing: boolean, error: unknown): string {
  const reason = getErrorMessage(error);
  const action = isFollowing ? "Follow" : "Unfollow";
  return `${action} failed: ${reason}. Your previous state was restored.`;
}

function getTransactionHash(result: unknown): string | undefined {
  if (!result || typeof result !== "object" || !("hash" in result)) return undefined;
  const hash = result.hash;
  return typeof hash === "string" && hash ? hash : undefined;
}

export function useFollowMutation({
  followee,
  follower: followerOverride,
  initialIsFollowing = false,
  initialFollowersCount = 0,
  initialFollowingCount = 0,
  submitFollow,
  onConfirmed,
}: UseFollowMutationOptions) {
  const wallet = useWallet();
  const follower = followerOverride === undefined ? wallet.address : followerOverride;
  const queryClient = useQueryClient();

  const queryKey = queryKeys.followState(follower, followee);
  const storeKey = storeKeyFor(follower, followee);

  // Latest server truth, used to seed the first mutation and as the fallback
  // for a rollback if no snapshot was captured (e.g. onMutate threw).
  const serverStateRef = useRef<FollowState>({
    isFollowing: initialIsFollowing,
    followersCount: initialFollowersCount,
    followingCount: initialFollowingCount,
  });
  serverStateRef.current = {
    isFollowing: initialIsFollowing,
    followersCount: initialFollowersCount,
    followingCount: initialFollowingCount,
  };

  // Reading through the optimistic store means the button re-renders the
  // moment `onMutate` runs, independently of when React processes the click.
  const state = useOptimisticFollow(follower, followee, serverStateRef.current);

  const mutation = useMutation<
    { isFollowing: boolean; txHash?: string },
    Error,
    FollowMutationVariables,
    FollowMutationContext
  >({
    mutationFn: async ({ isFollowing }) => {
      if (!follower) {
        throw new Error("Connect your wallet to follow accounts.");
      }

      const submit = submitFollow ?? submitFollowTransaction;
      const result = await submit({ follower, followee, isFollowing });

      return { isFollowing, txHash: getTransactionHash(result) };
    },

    onMutate: async ({ isFollowing }) => {
      // Cancel in-flight reads so a late response cannot overwrite the
      // optimistic value.
      await queryClient.cancelQueries({ queryKey });

      const previous = queryClient.getQueryData<FollowState>(queryKey) ?? serverStateRef.current;

      const optimistic: FollowState = {
        isFollowing,
        // Never render a negative follower count, even if the cached server
        // value was stale.
        followersCount: Math.max(0, previous.followersCount + (isFollowing ? 1 : -1)),
        followingCount: previous.followingCount,
      };

      queryClient.setQueryData<FollowState>(queryKey, optimistic);

      OptimisticStore.snapshotFollowState(storeKey);
      OptimisticStore.setFollowState(storeKey, optimistic);

      return { previous, optimistic, storeKey };
    },

    onError: (error, variables, context) => {
      if (context) {
        queryClient.setQueryData<FollowState>(queryKey, context.previous);
        const rolledBack = OptimisticStore.rollbackFollowState(context.storeKey);
        if (!rolledBack) {
          // No snapshot existed (defensive): clear the overlay so the UI falls
          // back to server truth instead of keeping the phantom state.
          OptimisticStore.clearFollowState(context.storeKey);
        }
      } else {
        queryClient.setQueryData<FollowState>(queryKey, serverStateRef.current);
        OptimisticStore.clearFollowState(storeKey);
      }

      toast.error({
        title: variables.isFollowing ? "Follow didn't go through" : "Unfollow didn't go through",
        description: rollbackDescription(variables.isFollowing, error),
        duration: 5000,
      });
    },

    onSuccess: (result, variables, context) => {
      if (!context) return;

      // Chain agrees with the optimistic value: keep it and drop the rollback
      // snapshot so a later failure cannot restore a stale state.
      queryClient.setQueryData<FollowState>(queryKey, context.optimistic);
      OptimisticStore.commitFollowState(context.storeKey);
      onConfirmed?.(context.optimistic);
      toast.success({
        title: variables.isFollowing ? "Follow confirmed" : "Unfollow confirmed",
        txHash: result.txHash,
        duration: 5000,
      });
    },

    onSettled: () => {
      // Mark the entry stale without a network round-trip; callers decide when
      // to refetch (the profile page refetches on the FollowEvent).
      void queryClient.invalidateQueries({ queryKey, refetchType: "none" });
    },
  });

  // Once the server state catches up with the optimistic value (profile
  // refetch / live FollowEvent), drop the overlay so later server updates are
  // not masked by a stale cache entry.
  useEffect(() => {
    if (mutation.isPending) return;

    const optimistic = OptimisticStore.getFollowState(storeKey);
    if (!optimistic) return;

    if (
      optimistic.isFollowing === initialIsFollowing &&
      optimistic.followersCount === initialFollowersCount &&
      optimistic.followingCount === initialFollowingCount
    ) {
      OptimisticStore.clearFollowState(storeKey);
    }
  }, [
    initialIsFollowing,
    initialFollowersCount,
    initialFollowingCount,
    storeKey,
    mutation.isPending,
  ]);

  const toggle = useCallback(
    (next?: boolean) => {
      if (mutation.isPending) return;

      // Without a wallet there is nothing to sign: surface that immediately
      // instead of flashing an optimistic state that can never be confirmed.
      if (!follower) {
        toast.error({
          title: "Wallet not connected",
          description: "Connect your wallet to follow accounts.",
        });
        return;
      }

      mutation.mutate({ isFollowing: next ?? !state.isFollowing });
    },
    [follower, mutation, state.isFollowing]
  );

  const follow = useCallback(() => toggle(true), [toggle]);
  const unfollow = useCallback(() => toggle(false), [toggle]);

  return {
    /** Optimistic state: flips immediately, rolls back on failure. */
    state,
    isFollowing: state.isFollowing,
    followersCount: state.followersCount,
    isPending: mutation.isPending,
    error: mutation.error ? classifyError(mutation.error) : null,
    toggle,
    follow,
    unfollow,
    reset: mutation.reset,
  };
}
