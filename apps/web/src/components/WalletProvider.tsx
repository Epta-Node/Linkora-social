"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

const LS_KEY = "linkora_wallet_address";
const LS_PUBLIC_KEY = "linkora_wallet_public_key";
const LS_NETWORK_KEY = "linkora_wallet_network";

export interface WalletContextValue {
  address: string | null;
  publicKey: string | null;
  connected: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  network: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

export const WalletContext = createContext<WalletContextValue>({
  address: null,
  publicKey: null,
  connected: false,
  isConnected: false,
  isConnecting: false,
  error: null,
  network: null,
  connect: async () => {},
  disconnect: () => {},
});

export function useWalletContext(): WalletContextValue {
  return useContext(WalletContext);
}

export function useWallet(): WalletContextValue {
  return useWalletContext();
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);

  const persistWallet = useCallback((pub: string, net?: string | null) => {
    setAddress(pub);
    setNetwork(net ?? null);
    localStorage.setItem(LS_KEY, pub);
    localStorage.setItem(LS_PUBLIC_KEY, pub);
    if (net) localStorage.setItem(LS_NETWORK_KEY, net);
  }, []);

  // Rehydrate from localStorage on mount, then verify Freighter still agrees
  useEffect(() => {
    const savedAddress = localStorage.getItem(LS_KEY) ?? localStorage.getItem(LS_PUBLIC_KEY);
    const savedNetwork = localStorage.getItem(LS_NETWORK_KEY);
    if (savedAddress) {
      setAddress(savedAddress);
      setNetwork(savedNetwork);
    }

    // Silently verify the saved session is still valid
    (async () => {
      try {
        const { isConnected, getPublicKey, getNetwork } = await import("@stellar/freighter-api");
        const still = await isConnected();
        if (!still) {
          return;
        }
        const [pub, net] = await Promise.all([getPublicKey(), getNetwork()]);
        if (pub) {
          persistWallet(readFreighterPublicKey(pub), net ?? null);
        }
      } catch {
        // Freighter not installed — leave persisted state as-is so UI can
        // show the "install" prompt rather than silently wiping the address.
      }
    })();
  }, [persistWallet]);

  const connect = useCallback(async () => {
    const fallback = await getBrowserFreighterPublicKey();
    if (fallback) {
      persistWallet(fallback, "TESTNET");
      return;
    }

    try {
      const { requestAccess, getPublicKey, getNetwork } = await import("@stellar/freighter-api");
      await requestAccess();
      const [pub, net] = await Promise.all([getPublicKey(), getNetwork()]);
      if (pub) {
        persistWallet(readFreighterPublicKey(pub), net ?? null);
        return;
      }
    } catch {
      // Fall through to browser globals used by tests and older Freighter APIs.
    }

    const retryFallback = await getBrowserFreighterPublicKey();
    if (retryFallback) persistWallet(retryFallback, "TESTNET");
  }, [persistWallet]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setNetwork(null);
    localStorage.removeItem(LS_KEY);
    localStorage.removeItem(LS_PUBLIC_KEY);
    localStorage.removeItem(LS_NETWORK_KEY);
  }, []);

  return (
    <WalletContext.Provider
      value={{
        address,
        publicKey: address,
        connected: !!address,
        isConnected: !!address,
        isConnecting: false,
        error: null,
        network,
        connect,
        disconnect,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

function readFreighterPublicKey(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "publicKey" in value) {
    return String((value as { publicKey: unknown }).publicKey);
  }
  return "";
}

async function getBrowserFreighterPublicKey(): Promise<string | null> {
  const freighterGlobal = globalThis as {
    freighterApi?: { getPublicKey?: () => Promise<unknown> | unknown };
    freighter?: { getPublicKey?: () => Promise<unknown> | unknown };
  };
  const api = freighterGlobal.freighterApi ?? freighterGlobal.freighter;
  const pub = await api?.getPublicKey?.();
  return readFreighterPublicKey(pub) || null;
}
