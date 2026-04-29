"use client";

import { useEffect, useState, useCallback } from "react";

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

const HORIZON_TESTNET = "https://horizon-testnet.stellar.org";

async function fetchXlmBalance(address: string): Promise<string> {
  try {
    const res = await fetch(`${HORIZON_TESTNET}/accounts/${address}`);
    if (!res.ok) return "0"; // account not funded yet
    const data = await res.json();
    const native = (data.balances as { asset_type: string; balance: string }[]).find(
      (b) => b.asset_type === "native"
    );
    return native?.balance ?? "0";
  } catch {
    return "0";
  }
}

export function useWallet() {
  const [state, setState] = useState<WalletState>("loading");
  const [wallet, setWallet] = useState<WalletInfo>({
    address: null,
    network: null,
    balance: null,
  });

  const detectState = useCallback(async () => {
    const hasFreighter =
      typeof window !== "undefined" &&
      !!(window as unknown as { freighter?: unknown }).freighter;

    if (!hasFreighter) {
      setState("not_installed");
      return;
    }

    try {
      const { isConnected, getPublicKey, getNetwork } = await import("@stellar/freighter-api");
      const connected = await isConnected();

      if (!connected) {
        setState("not_connected");
        return;
      }

      const [address, networkResult] = await Promise.all([
        getPublicKey(),
        getNetwork(),
      ]);

      if (!address) {
        setState("not_connected");
        return;
      }

      const network = networkResult ?? null;
      const balance = await fetchXlmBalance(address);

      setWallet({ address, network: network ?? null, balance });

      // TODO: replace with actual contract call to get_profile(address)
      setState("connected_no_profile");
    } catch {
      setState("not_connected");
    }
  }, []);

  useEffect(() => {
    detectState();
  }, [detectState]);

  const connect = useCallback(async () => {
    try {
      const { requestAccess } = await import("@stellar/freighter-api");
      await requestAccess();
      await detectState();
    } catch {
      // user rejected
    }
  }, [detectState]);

  const markProfileCreated = useCallback(() => setState("ready"), []);

  return { state, wallet, connect, markProfileCreated, refresh: detectState };
}
