"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from "react";

interface WalletState {
  publicKey: string | null;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
}

interface WalletContextValue extends WalletState {
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

const STORAGE_KEY = "linkora_wallet_public_key";

declare global {
  interface Window {
    freighterApi?: {
      getPublicKey: () => Promise<{ publicKey: string }>;
      isConnected: () => Promise<boolean>;
      onNetworkChange: (callback: () => void) => void;
    };
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>({
    publicKey: null,
    isConnected: false,
    isConnecting: false,
    error: null,
  });

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setState((prev) => ({ ...prev, publicKey: stored, isConnected: true }));
    }
  }, []);

  const checkFreighter = useCallback(async (): Promise<boolean> => {
    try {
      if (window.freighterApi) {
        const connected = await window.freighterApi.isConnected();
        return connected;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const connect = useCallback(async () => {
    setState((prev) => ({ ...prev, isConnecting: true, error: null }));

    try {
      if (!window.freighterApi) {
        throw new Error(
          "Freighter wallet not detected. Please install Freighter wallet."
        );
      }

      const { publicKey } = await window.freighterApi.getPublicKey();

      localStorage.setItem(STORAGE_KEY, publicKey);

      setState({
        publicKey,
        isConnected: true,
        isConnecting: false,
        error: null,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to connect wallet";
      setState((prev) => ({
        ...prev,
        isConnecting: false,
        error: message,
      }));
    }
  }, []);

  const disconnect = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState({
      publicKey: null,
      isConnected: false,
      isConnecting: false,
      error: null,
    });
  }, []);

  return (
    <WalletContext.Provider value={{ ...state, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}

export function formatAddress(address: string | null): string {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}