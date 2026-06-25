import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LinkoraClient } from "linkora-sdk";

import { useNetwork } from "./useNetwork";
import { useFollowers } from "./useFollowers";
import { useFollowing } from "./useFollowing";
import { useWallet } from "./useWallet";
import { useToast } from "../context/ToastContext";

export interface Profile {
  address: string;
  username?: string | null;
  bio?: string | null;
}

interface WalletKitWithSigning {
  signAndSubmitTransaction?: (opts: {
    txXdr: string;
  }) => Promise<{ hash?: string; txHash?: string }>;
  signTransaction?: (opts: { txXdr: string }) => Promise<{
    signedTxXdr?: string;
    signedXdr?: string;
    signedTx?: string;
  }>;
}

interface StellarServerWithSubmit {
  submitTransaction: (signedXdr: string) => Promise<{ hash?: string }>;
}

export function useProfile(address: string) {
  const { rpcUrl, contractId } = useNetwork();
  const { address: me } = useWallet();

  const clientRef = useRef<LinkoraClient | null>(null);
  clientRef.current = clientRef.current ?? new LinkoraClient({ contractId, rpcUrl });

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(!!address);
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

  const fetchProfile = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      const client = clientRef.current as LinkoraClient;
      const p = await client.getProfile(address);
      setProfile(
        p
          ? {
              address,
              username: p.username ?? null,
              bio: (p.bio as string) ?? null,
            }
          : null
      );
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("Failed to load profile", e);
      setError("Failed to load profile.");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const { showPending, showSuccess, showError } = useToast();

  const toggleFollow = useCallback(async () => {
    if (!address) return;
    if (!me) {
      showError("Connect your wallet to follow users.");
      return;
    }

    const client = clientRef.current as LinkoraClient;
    if (!client) {
      showError("SDK client not available");
      return;
    }

    const txXdr = isFollowing ? client.unfollow(me, address) : client.follow(me, address);

    showPending();

    try {
      // Try to use an injected wallet kit that can sign/submit
      const kit = (
        globalThis as unknown as {
          __LINKORA_WALLET_KIT__?: WalletKitWithSigning;
        }
      ).__LINKORA_WALLET_KIT__;

      if (kit && typeof kit.signAndSubmitTransaction === "function") {
        const res = await kit.signAndSubmitTransaction({ txXdr });
        const txHash = res?.hash ?? res?.txHash ?? "";
        showSuccess(txHash);
      } else if (kit && typeof kit.signTransaction === "function") {
        const signed = await kit.signTransaction({ txXdr });
        const signedXdr = signed?.signedTxXdr ?? signed?.signedXdr ?? signed?.signedTx;
        if (!signedXdr) throw new Error("Wallet did not return signed transaction XDR");

        const { rpc } = await import("@stellar/stellar-sdk");
        const server = new rpc.Server(rpcUrl);
        const submitRes = await (server as unknown as StellarServerWithSubmit).submitTransaction(
          signedXdr
        );
        const txHash = submitRes?.hash ?? "";
        showSuccess(txHash);
      } else {
        throw new Error("Wallet signing not available in this environment");
      }

      // refresh followers/following after success
      followers.refresh();
      following.refresh();
      myFollowing.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to submit transaction";
      showError(msg);
    }
  }, [
    address,
    me,
    isFollowing,
    rpcUrl,
    showError,
    showPending,
    showSuccess,
    followers,
    following,
    myFollowing,
  ]);

  const refresh = useCallback(() => {
    fetchProfile();
    // trigger followers/following refresh by calling their refresh methods if available
    followers.refresh();
    following.refresh();
    myFollowing.refresh();
  }, [fetchProfile, followers, following, myFollowing]);

  return {
    profile,
    loading,
    error,
    followerCount,
    followingCount,
    isFollowing,
    toggleFollow,
    refresh,
  } as const;
}
