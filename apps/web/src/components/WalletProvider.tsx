"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

const LS_KEY = "linkora_wallet_address";
const LS_PUBLIC_KEY = "linkora_wallet_public_key";
const LS_NETWORK_KEY = "linkora_wallet_network";

// ---------------------------------------------------------------------------
// Typed connect-failure reasons (#1582)
// ---------------------------------------------------------------------------

/** Why a wallet connection attempt failed. */
export type ConnectErrorReason = "not-installed" | "declined" | "no-address" | "unknown";

/** Typed error thrown (and re-thrown) by connect(). */
export class ConnectError extends Error {
  constructor(
    public readonly reason: ConnectErrorReason,
    message: string
  ) {
    super(message);
    this.name = "ConnectError";
  }
}

// ---------------------------------------------------------------------------
// Context type
// ---------------------------------------------------------------------------

export interface WalletContextValue {
  address: string | null;
  publicKey: string | null;
  connected: boolean;
  isConnected: boolean;
  /** True while the connect flow is in progress (use to disable the button). */
  isConnecting: boolean;
  /** Human-readable description of the last connection failure, or null. */
  error: string | null;
  network: string | null;
  /** Resolves on success, throws ConnectError on failure. */
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

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persistWallet = useCallback((pub: string, net?: string | null) => {
    setAddress(pub);
    setNetwork(net ?? null);
    localStorage.setItem(LS_KEY, pub);
    localStorage.setItem(LS_PUBLIC_KEY, pub);
    if (net) localStorage.setItem(LS_NETWORK_KEY, net);
  }, []);

  // Rehydrate from localStorage on mount, then verify Freighter still agrees.
  useEffect(() => {
    const savedAddress = localStorage.getItem(LS_KEY) ?? localStorage.getItem(LS_PUBLIC_KEY);
    const savedNetwork = localStorage.getItem(LS_NETWORK_KEY);
    if (savedAddress) {
      setAddress(savedAddress);
      setNetwork(savedNetwork);
    }

    // Silently verify the saved session is still valid.
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
        // Freighter not installed — leave persisted state as-is so the UI can
        // show the "install" prompt rather than silently wiping the address.
      }
    })();
  }, [persistWallet]);

  /**
   * Attempt to connect a Freighter wallet.
   *
   * Contract (#1582):
   *  - Sets isConnecting = true for the duration of the attempt.
   *  - On success: persists the address and clears error.
   *  - On failure: sets error and throws a ConnectError so callers (e.g.
   *    NavBar.handleConnect) can react in their own catch block.
   *
   * Failure reasons:
   *  - "not-installed" — neither the dynamic import nor any browser global
   *    resolved to a working Freighter API.
   *  - "declined" — requestAccess() rejected (user dismissed the prompt).
   *  - "no-address" — access was granted but no public key was returned.
   */
  const connect = useCallback(async () => {
    setIsConnecting(true);
    setError(null);

    try {
      // 1. Try the browser-global API (tests + older Freighter builds).
      const fallback = await getBrowserFreighterPublicKey();
      if (fallback) {
        persistWallet(fallback, "TESTNET");
        return;
      }

      // 2. Try the npm package (modern Freighter).
      let freighterModule: {
        requestAccess: () => Promise<unknown>;
        getPublicKey: () => Promise<unknown>;
        getNetwork: () => Promise<string | null | undefined>;
      } | null = null;

      try {
        const mod = await import("@stellar/freighter-api");
        freighterModule = mod;
      } catch {
        // Dynamic import failed → extension not installed.
        throw new ConnectError("not-installed", "Freighter extension is not installed");
      }

      try {
        await freighterModule.requestAccess();
      } catch {
        // requestAccess() rejected → user declined the prompt.
        throw new ConnectError("declined", "You declined the Freighter connection prompt");
      }

      const [pub, net] = await Promise.all([
        freighterModule.getPublicKey(),
        freighterModule.getNetwork(),
      ]);

      if (pub) {
        persistWallet(readFreighterPublicKey(pub), net ?? null);
        return;
      }

      // 3. Retry the browser global (some older injections arrive after the
      //    import, e.g. in certain Freighter dev builds).
      const retryFallback = await getBrowserFreighterPublicKey();
      if (retryFallback) {
        persistWallet(retryFallback, "TESTNET");
        return;
      }

      throw new ConnectError("no-address", "Freighter did not return a public key");
    } catch (err) {
      const message =
        err instanceof ConnectError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Wallet connection failed";

      setError(message);

      // Re-throw so callers can distinguish the failure reason.
      if (err instanceof ConnectError) throw err;
      throw new ConnectError("unknown", message);
    } finally {
      setIsConnecting(false);
    }
  }, [persistWallet]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setNetwork(null);
    setError(null);
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
        isConnecting,
        error,
        network,
        connect,
        disconnect,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
