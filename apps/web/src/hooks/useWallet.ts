"use client";

import { useEffect, useState, useCallback } from "react";
import { useWalletContext } from "@/components/WalletProvider";
import { getHorizonUrl } from "@/config/networks";

// Re-export the context hook as the canonical useWallet for simple consumers
// (nav bar, header, etc.) that only need { address, connected, network,
// connect, disconnect }.
export { useWalletContext as useWallet } from "@/components/WalletProvider";

// ---------------------------------------------------------------------------
// Richer onboarding state — used by OnboardingFlow
// ---------------------------------------------------------------------------

export type WalletState =
  | "loading"
  | "not_installed"
  | "not_connected"
  | "connected_no_profile"
  | "ready";

export interface WalletInfo {
  address: string | null;
  network: string | null;
  balance: string | null;
}

export async function fetchXlmBalance(
  address: string,
  network?: string | null
): Promise<string> {
  try {
    const horizonUrl = getHorizonUrl(network);
    const res = await fetch(`${horizonUrl}/accounts/${address}`);
    if (!res.ok) return "0";
    const data = await res.json();
    const native = (
      data.balances as { asset_type: string; balance: string }[]
    ).find((b) => b.asset_type === "native");
    return native?.balance ?? "0";
  } catch {
    return "0";
  }
}

/**
 * useOnboardingWallet — full onboarding state machine used by OnboardingFlow.
 * Delegates connect/disconnect to WalletContext so state stays in sync.
 */
export function useOnboardingWallet() {
  const { address, connected, network, connect: ctxConnect } = useWalletContext();

  const [state, setState] = useState<WalletState>("loading");
  const [balance, setBalance] = useState<string | null>(null);

  const detectState = useCallback(async () => {
    const hasFreighter =
      typeof window !== "undefined" &&
      !!(window as unknown as { freighter?: unknown }).freighter;

    if (!hasFreighter) {
      setState("not_installed");
      return;
    }

    try {
      const { isConnected } = await import("@stellar/freighter-api");
      const isConn = await isConnected();

      if (!isConn || !connected || !address) {
        setState("not_connected");
        setBalance(null);
        return;
      }

      const bal = await fetchXlmBalance(address, network);
      setBalance(bal);

      // TODO: replace with actual contract call to get_profile(address)
      setState("connected_no_profile");
    } catch {
      setState("not_connected");
    }
  }, [address, connected, network]);

  useEffect(() => {
    detectState();
  }, [detectState]);

  const connect = useCallback(async () => {
    await ctxConnect();
    // detectState will re-run via the effect when `address` / `connected` change
  }, [ctxConnect]);

  const markProfileCreated = useCallback(() => setState("ready"), []);

  const wallet: WalletInfo = { address, network, balance };

  return { state, wallet, connect, markProfileCreated, refresh: detectState };
}
