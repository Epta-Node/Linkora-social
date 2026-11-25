import { useCallback, useEffect, useMemo, useState } from "react";

import { useFollowers } from "./useFollowers";
import { useFollowing } from "./useFollowing";
import { useWallet } from "./useWallet";
import { useSubmitTx } from "./useSubmitTx";
import { useToast } from "../context/ToastContext";

export interface Profile {
  address: string;
  username?: string | null;
  bio?: string | null;
}

async function fetchMockProfile(address: string): Promise<Profile | null> {
  await new Promise<void>((resolve) => setTimeout(resolve, 300));
  if (!address) return null;
  return {
    address,
    username: `user_${address.slice(2, 8).toLowerCase()}`,
    bio: "Exploring the Linkora network.",
  };
}

export function useProfile(address: string) {
  const { address: me } = useWallet();
  const submitTx = useSubmitTx();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(!!address);
  /** True during a pull-to-refresh; the profile stays on screen meanwhile. */
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const followers = useFollowers(address ?? "");
  const following = useFollowing(address ?? "");

  const myFollowing = useFollowing(me ?? "");

  const followerCount = followers.users.length;
  const followingCount = following.users.length;

  const isFollowing = useMemo(() => {
    if (!me) return false;
    return myFollowing.users.some((u) => u.address === address);
  }, [me, myFollowing.users, address]);

  const fetchProfile = useCallback(
    async (silent = false) => {
      if (!address) return;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const p = await fetchMockProfile(address);
        setProfile(p);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("Failed to load profile", e);
        setError("Failed to load profile.");
      } finally {
        setLoading(false);
      }
    },
    [address]
  );

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const { showError } = useToast();

  const toggleFollow = useCallback(async () => {
    if (!address) return;
    if (!me) {
      showError("Connect your wallet to follow users.");
      return;
    }

    try {
      const txDescriptor = isFollowing ? `unfollow:${me}:${address}` : `follow:${me}:${address}`;
      await submitTx(txDescriptor);

      // refresh followers/following after success
      followers.refresh();
      following.refresh();
      myFollowing.refresh();
    } catch {
      // submitTx already surfaces the error toast
    }
  }, [address, me, isFollowing, submitTx, showError, followers, following, myFollowing]);

  /**
   * Re-fetches the profile and follow counts without replacing the screen with
   * the initial loading state. Resolves when the profile has reloaded.
   */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    followers.refresh();
    following.refresh();
    myFollowing.refresh();
    try {
      await fetchProfile(true);
    } finally {
      setRefreshing(false);
    }
  }, [fetchProfile, followers, following, myFollowing]);

  return {
    profile,
    loading,
    refreshing,
    error,
    followerCount,
    followingCount,
    isFollowing,
    toggleFollow,
    refresh,
  } as const;
}
