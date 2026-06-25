"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

const LS_KEY = "linkora_wallet_address";
const LS_NETWORK_KEY = "linkora_wallet_network";

export interface WalletContextValue {
  address: string | null;
  connected: boolean;
  network: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

export const WalletContext = createContext<WalletContextValue>({
  address: null,
  connected: false,
  network: null,
  connect: async () => {},
  disconnect: () => {},
});

export function useWalletContext(): WalletContextValue {
  return useContext(WalletContext);
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);

  // Rehydrate from localStorage on mount, then verify Freighter still agrees
  useEffect(() => {
    const savedAddress = localStorage.getItem(LS_KEY);
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
          // Freighter was disconnected externally — clear persisted state
          setAddress(null);
          setNetwork(null);
          localStorage.removeItem(LS_KEY);
          localStorage.removeItem(LS_NETWORK_KEY);
          return;
        }
        const [pub, net] = await Promise.all([getPublicKey(), getNetwork()]);
        if (pub) {
          setAddress(pub);
          setNetwork(net ?? null);
          localStorage.setItem(LS_KEY, pub);
          if (net) localStorage.setItem(LS_NETWORK_KEY, net);
        }
      } catch {
        // Freighter not installed — leave persisted state as-is so UI can
        // show the "install" prompt rather than silently wiping the address.
      }
    })();
  }, []);

  const connect = useCallback(async () => {
    try {
      const { requestAccess, getPublicKey, getNetwork } = await import("@stellar/freighter-api");
      await requestAccess();
      const [pub, net] = await Promise.all([getPublicKey(), getNetwork()]);
      if (pub) {
        setAddress(pub);
        setNetwork(net ?? null);
        localStorage.setItem(LS_KEY, pub);
        if (net) localStorage.setItem(LS_NETWORK_KEY, net ?? "");
      }
    } catch {
      // User rejected the connection request — do nothing
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    setNetwork(null);
    localStorage.removeItem(LS_KEY);
    localStorage.removeItem(LS_NETWORK_KEY);
  }, []);

  return (
    <WalletContext.Provider
      value={{
        address,
        connected: !!address,
        network,
        connect,
        disconnect,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
