import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { Linking } from "react-native";
import {
  setWalletAddress,
  getWalletAddress,
  deleteWalletAddress,
  setConnectionState,
  getConnectionState,
  deleteConnectionState,
  type ConnectionState as StoredConnectionState,
} from "../utils/secureStorage";
import { deregisterTokenFromIndexer } from "../notifications/registerForPushNotifications";
import {
  useNetworkContext,
  NETWORK_PRESETS,
  type NetworkPreset,
  type StellarNetworkId,
} from "./NetworkContext";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WalletState = "loading" | "disconnected" | "connecting" | "connected" | "error";

export type WalletProviderKind = "freighter" | "walletconnect";

export type WalletNetwork = StellarNetworkId;

export interface WalletInfo {
  address: string | null;
  network: WalletNetwork | null;
  provider: WalletProviderKind | null;
}

/**
 * Stellar ed25519 public keys are `G` followed by 55 base32 characters.
 */
const STELLAR_ADDRESS_PATTERN = /^G[A-Z2-7]{55}$/;

const EMPTY_WALLET: WalletInfo = { address: null, network: null, provider: null };

function isStellarAddress(value: unknown): value is string {
  return typeof value === "string" && STELLAR_ADDRESS_PATTERN.test(value.trim());
}

/** #1593 — a persisted network is only trustworthy when it is a known preset. */
function isKnownNetwork(value: unknown): value is StellarNetworkId {
  return typeof value === "string" && value in NETWORK_PRESETS;
}

/**
 * Outcome of asking one adapter whether a persisted session is still usable.
 *
 * "invalid" is the only state allowed to delete stored credentials (#1593):
 * "unverifiable" means the adapter could not be asked (kit not initialised yet,
 * extension unavailable) and must leave the session on disk to be retried.
 */
type SessionProbe =
  | { status: "restored"; address: string }
  | { status: "invalid" }
  | { status: "unverifiable" };

interface WalletConnectLike {
  connect: (network: NetworkPreset) => Promise<{ publicKey?: string; address?: string }>;
  disconnect: () => Promise<void>;
  getPublicKey?: () => Promise<string>;
  isConnected?: () => Promise<boolean>;
  signTransaction?: (payload: { txXdr: string }) => Promise<WalletSignResult>;
  signAndSubmitTransaction?: (payload: {
    txXdr: string;
    rpcUrl?: string;
  }) => Promise<WalletSubmitResult>;
}

interface WalletSignResult {
  signedTxXdr?: string;
  signedXdr?: string;
  signed?: string;
}

interface WalletSubmitResult {
  hash?: string;
  txHash?: string;
}

type WalletConnectRequestArgs = {
  topic: string;
  chainId: string;
  chain: string;
  request: {
    method: string;
    params: { txXdr: string };
  };
};

type LinkoraGlobal = typeof globalThis & {
  __LINKORA_WALLET_KIT__?: WalletConnectLike;
  /** #1593 — allows tests (and the mini-app bridge) to inject a Freighter API. */
  __LINKORA_FREIGHTER_API__?: Record<string, unknown>;
};

async function createWalletConnectAdapter(): Promise<WalletConnectLike> {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const projectId = env?.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID;

  const { default: SignClient } = await import("@walletconnect/sign-client");
  let client: Awaited<ReturnType<typeof SignClient.init>> | null = null;
  let topic: string | null = null;
  let currentAddress: string | null = null;
  let connectedNetwork: NetworkPreset | null = null;

  const adapter: WalletConnectLike = {
    async connect(network: NetworkPreset) {
      if (!projectId) {
        throw new Error("WalletConnect project id not configured");
      }

      client =
        client ??
        (await SignClient.init({
          projectId,
          metadata: {
            name: "Linkora",
            description: "Linkora SocialFi mobile app",
            url: "https://github.com/Epta-Node/Linkora-social",
            icons: [],
          },
        }));

      const { uri, approval } = await client.connect({
        requiredNamespaces: {
          stellar: {
            methods: ["stellar_signXDR"],
            chains: [network.chain],
            events: ["accountsChanged"],
          },
        },
      });

      if (uri) await Linking.openURL(uri);

      const session = await approval();
      topic = session.topic;
      const account = session.namespaces.stellar?.accounts?.[0];
      currentAddress = account?.split(":").pop() ?? null;
      connectedNetwork = network;

      if (!currentAddress) throw new Error("No Stellar account returned from WalletConnect");

      return { publicKey: currentAddress };
    },

    async disconnect() {
      if (client && topic) {
        await client.disconnect({ topic, reason: { code: 6000, message: "User disconnected" } });
      }
      topic = null;
      currentAddress = null;
      connectedNetwork = null;
    },

    async getPublicKey() {
      if (!currentAddress) throw new Error("WalletConnect is not connected");
      return currentAddress;
    },

    async isConnected() {
      return Boolean(currentAddress);
    },

    async signTransaction({ txXdr }: { txXdr: string }) {
      if (!client || !topic || !connectedNetwork) throw new Error("Wallet not connected");

      const request = {
        topic,
        chainId: connectedNetwork.chain,
        chain: connectedNetwork.chain,
        request: {
          method: "stellar_signXDR",
          params: { txXdr },
        },
      } satisfies WalletConnectRequestArgs;

      const res = await client.request(request as Parameters<typeof client.request>[0]);
      return res as WalletSignResult;
    },

    async signAndSubmitTransaction({ txXdr, rpcUrl }: { txXdr: string; rpcUrl?: string }) {
      const signed = await adapter.signTransaction?.({ txXdr });
      const signedXdr = signed?.signedTxXdr || signed?.signedXdr || signed?.signed;
      if (!signedXdr) throw new Error("Wallet did not return signed transaction XDR");

      if (!rpcUrl) throw new Error("rpcUrl is required to broadcast a transaction");

      // Broadcast the signed XDR to the Soroban RPC
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "sendTransaction",
          params: [{ transaction: signedXdr }],
        }),
      });

      if (!response.ok) {
        throw new Error(`RPC HTTP error ${response.status}: ${response.statusText}`);
      }

      const json = (await response.json()) as {
        result?: { hash: string; status: string };
        error?: { message: string };
      };

      if (json.error) {
        throw new Error(`RPC error: ${json.error.message}`);
      }

      const hash = json.result?.hash;
      if (!hash) throw new Error("RPC returned no transaction hash");

      return { hash };
    },
  };

  return adapter;
}

declare global {
  // eslint-disable-next-line no-var
  var __LINKORA_WALLET_KIT__: WalletConnectLike | undefined;
  /** #1593 — test/bridge seam for the Freighter API (the extension is injected in prod). */
  // eslint-disable-next-line no-var
  var __LINKORA_FREIGHTER_API__: Record<string, unknown> | undefined;
}

export interface WalletContextType {
  state: WalletState;
  wallet: WalletInfo;
  network: WalletNetwork;
  error: string | null;
  connect: (provider?: WalletProviderKind) => Promise<void>;
  disconnect: () => Promise<void>;
  refresh: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | null>(null);

export function WalletProvider({ children }: { children: ReactNode }): JSX.Element {
  const { network: selectedNetwork } = useNetworkContext();
  const [state, setState] = useState<WalletState>("loading");
  const [wallet, setWallet] = useState<WalletInfo>(EMPTY_WALLET);
  const [error, setError] = useState<string | null>(null);

  const [walletKit, setWalletKit] = useState<WalletConnectLike | null>(
    () => globalThis.__LINKORA_WALLET_KIT__ ?? null
  );

  // #1593 — a Stellar keypair is valid on any network, so a connected wallet
  // operates on the network the app currently has selected. `network` used to be
  // standalone state seeded with a hardcoded "TESTNET", so every consumer
  // showing it went stale the moment the user switched networks in settings.
  // The session's origin network stays on `wallet.network` (and in storage) as
  // provenance for the persisted record.
  const network: WalletNetwork = selectedNetwork.id;

  // Read the selected network through a ref so switching networks does not
  // re-run the restore below. A session is network-independent, and re-probing
  // on every switch flashed "loading" and could drop an already-connected user
  // whose adapter was momentarily unreachable.
  const selectedNetworkIdRef = useRef(selectedNetwork.id);
  useEffect(() => {
    selectedNetworkIdRef.current = selectedNetwork.id;
  });

  const persistSession = useCallback(async (address: string, provider: WalletProviderKind) => {
    const connState: StoredConnectionState = {
      connected: true,
      address,
      provider,
      network: selectedNetworkIdRef.current,
      timestamp: Date.now(),
    };
    await Promise.all([setWalletAddress(address), setConnectionState(connState)]);
  }, []);

  const clearStoredSession = useCallback(async () => {
    await Promise.all([deleteWalletAddress(), deleteConnectionState()]);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        if (globalThis.__LINKORA_WALLET_KIT__) {
          setWalletKit(globalThis.__LINKORA_WALLET_KIT__);
          return;
        }

        if (!cancelled) {
          const adapter = await createWalletConnectAdapter();
          // Expose globally for other modules that expect a wallet kit
          // (tests or mini-app bridges may rely on this global).
          (globalThis as LinkoraGlobal).__LINKORA_WALLET_KIT__ = adapter;
          setWalletKit(adapter);
        }
      } catch {
        if (!cancelled) {
          setState("error");
          setError("Wallet kit not available");
        }
      }
    };

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  const importFreighterApi = useCallback(async () => {
    const injected = globalThis.__LINKORA_FREIGHTER_API__;
    if (injected) return injected;

    const loader = new Function("specifier", "return import(specifier)") as (
      specifier: string
    ) => Promise<Record<string, unknown>>;
    return loader("@stellar/freighter-api");
  }, []);

  const requestFreighterAddress = useCallback(async (): Promise<string> => {
    const freighter = await importFreighterApi();

    const available =
      typeof freighter.isConnected === "function" ? await freighter.isConnected() : true;

    if (!available) throw new Error("Freighter is not available");

    if (typeof freighter.requestAccess === "function") {
      const result = await freighter.requestAccess();
      if (typeof result === "string") return result;
      if (
        result &&
        typeof result === "object" &&
        "address" in result &&
        typeof result.address === "string"
      ) {
        return result.address;
      }
    }

    if (typeof freighter.getPublicKey === "function") {
      const publicKey = await freighter.getPublicKey();
      if (typeof publicKey === "string") return publicKey;
    }

    if (typeof freighter.getAddress === "function") {
      const result = await freighter.getAddress();
      if (typeof result === "string") return result;
      if (
        result &&
        typeof result === "object" &&
        "address" in result &&
        typeof result.address === "string"
      ) {
        return result.address;
      }
    }

    throw new Error("No address returned from Freighter");
  }, [importFreighterApi]);

  /**
   * #1593 — non-prompting Freighter check. Restore must never open the wallet's
   * permission dialog (the old code called `requestAccess()` on every cold
   * start), so this only reads state the extension already exposes.
   */
  const probeFreighterSession = useCallback(
    async (storedAddress: string): Promise<SessionProbe> => {
      let freighter: Record<string, unknown>;
      try {
        freighter = await importFreighterApi();
      } catch {
        // Extension not installed in this browser → cannot verify, keep session.
        return { status: "unverifiable" };
      }

      try {
        if (typeof freighter.isConnected === "function") {
          const connected = await (freighter.isConnected as () => Promise<boolean>)();
          if (connected === false) return { status: "invalid" };
        }

        const readPublicKey = async (): Promise<string | null> => {
          if (typeof freighter.getPublicKey === "function") {
            const value = await (freighter.getPublicKey as () => Promise<unknown>)();
            if (typeof value === "string") return value;
            if (value && typeof value === "object" && "address" in value) {
              const address = (value as { address?: unknown }).address;
              return typeof address === "string" ? address : null;
            }
          }
          if (typeof freighter.getAddress === "function") {
            const value = await (freighter.getAddress as () => Promise<unknown>)();
            if (typeof value === "string") return value;
            if (value && typeof value === "object" && "address" in value) {
              const address = (value as { address?: unknown }).address;
              return typeof address === "string" ? address : null;
            }
          }
          return null;
        };

        const address = await readPublicKey();
        if (!address || !isStellarAddress(address)) {
          return { status: "unverifiable" };
        }

        // A different account is now active → this stored session is stale.
        if (address !== storedAddress) return { status: "invalid" };

        return { status: "restored", address };
      } catch {
        return { status: "unverifiable" };
      }
    },
    [importFreighterApi]
  );

  const probeWalletConnectSession = useCallback(
    async (storedAddress: string): Promise<SessionProbe> => {
      // Kit not initialised yet: ask again later rather than wiping the session.
      if (!walletKit) return { status: "unverifiable" };

      try {
        if (walletKit.isConnected) {
          const connected = await walletKit.isConnected();
          if (connected === false) return { status: "invalid" };
        }

        const address = walletKit.getPublicKey ? await walletKit.getPublicKey() : storedAddress;

        if (!isStellarAddress(address)) return { status: "unverifiable" };
        if (address !== storedAddress) return { status: "invalid" };

        return { status: "restored", address };
      } catch {
        return { status: "unverifiable" };
      }
    },
    [walletKit]
  );

  const checkConnectionState = useCallback(
    async (signal?: AbortSignal) => {
      try {
        if (signal?.aborted) return;
        setState("loading");
        setError(null);

        const [storedAddress, storedConn] = await Promise.all([
          getWalletAddress(),
          getConnectionState(),
        ]);

        if (signal?.aborted) return;

        if (!storedAddress || !storedConn || !storedConn.connected) {
          setWallet(EMPTY_WALLET);
          setState("disconnected");
          return;
        }

        // Corrupt/legacy address: nothing to restore, and it is genuinely invalid.
        if (!isStellarAddress(storedAddress)) {
          await clearStoredSession();
          if (signal?.aborted) return;
          setWallet(EMPTY_WALLET);
          setState("disconnected");
          return;
        }

        // Prefer the adapter recorded in the session; sessions written before
        // #1593 have no provider, so probe both (cheapest/most likely first).
        const candidates: WalletProviderKind[] = storedConn.provider
          ? [storedConn.provider]
          : ["freighter", "walletconnect"];

        const results: Array<{ provider: WalletProviderKind; probe: SessionProbe }> = [];
        for (const candidate of candidates) {
          if (signal?.aborted) return;
          const probe =
            candidate === "freighter"
              ? await probeFreighterSession(storedAddress)
              : await probeWalletConnectSession(storedAddress);
          results.push({ provider: candidate, probe });
          if (probe.status === "restored") break;
        }

        if (signal?.aborted) return;

        const match = results.find((result) => result.probe.status === "restored");
        if (match && match.probe.status === "restored") {
          const { address } = match.probe;
          // A legacy record has no provider; record the one that matched so the
          // next cold start probes it directly (and not the other adapter).
          if (storedConn.provider !== match.provider) {
            await persistSession(address, match.provider);
          }
          if (signal?.aborted) return;
          setWallet({
            address,
            network: isKnownNetwork(storedConn.network)
              ? storedConn.network
              : selectedNetworkIdRef.current,
            provider: match.provider,
          });
          setState("connected");
          return;
        }

        // Only delete when every adapter we could ask said the session is gone.
        // An "unverifiable" adapter means we simply could not tell yet.
        const anyInvalid = results.some((result) => result.probe.status === "invalid");
        const anyUnverifiable = results.some((result) => result.probe.status === "unverifiable");
        if (anyInvalid && !anyUnverifiable) {
          await clearStoredSession();
        }

        if (signal?.aborted) return;

        setWallet(EMPTY_WALLET);
        setState("disconnected");
      } catch (err) {
        if (signal?.aborted) return;
        setState("error");
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    },
    [clearStoredSession, persistSession, probeFreighterSession, probeWalletConnectSession]
  );

  // #1593 — run the restore on mount even before the WalletConnect kit is ready;
  // a Freighter session does not depend on it, and a WalletConnect session is
  // retried once `walletKit` arrives (its probe reports "unverifiable" until then).
  // #1196 — use an AbortController so state setters are no-ops after unmount.
  useEffect(() => {
    const controller = new AbortController();
    checkConnectionState(controller.signal);
    return () => {
      controller.abort();
    };
  }, [checkConnectionState]);

  // #1196 — guard all post-await state setters so that unmounting mid-connect
  // does not cause state updates on an unmounted component. This must be a ref
  // tied to the effect lifecycle: an async callback cannot return a cleanup
  // function, so a local `mounted` flag was never set to false and the guard
  // silently always passed.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const connect = useCallback(
    async (provider: WalletProviderKind = "walletconnect") => {
      const guard = () => mountedRef.current;

      try {
        setState("connecting");
        setError(null);

        let address: string | null = null;

        if (provider === "freighter") {
          address = await requestFreighterAddress();
        } else {
          if (!walletKit) throw new Error("WalletConnect is not available");

          const result: { publicKey?: string; address?: string } =
            await walletKit.connect(selectedNetwork);
          address = result.publicKey ?? result.address ?? null;

          if (typeof walletKit.getPublicKey === "function") {
            address = await walletKit.getPublicKey();
          }
        }

        if (!guard()) return;

        if (!address || !isStellarAddress(address)) {
          throw new Error("No address returned from wallet");
        }

        await persistSession(address, provider);

        if (!guard()) return;

        setWallet({ address, network: selectedNetwork.id, provider });
        setState("connected");
      } catch (err) {
        if (!guard()) return;
        setState("error");
        setError(err instanceof Error ? err.message : "Connection failed");
        setWallet(EMPTY_WALLET);
      }
    },
    [persistSession, requestFreighterAddress, selectedNetwork, walletKit]
  );

  const disconnect = useCallback(async () => {
    const currentAddress = wallet.address;
    const currentProvider = wallet.provider;
    try {
      setError(null);
      // Only the WalletConnect adapter owns a remote session to tear down.
      if (walletKit && currentProvider === "walletconnect") {
        await walletKit.disconnect();
      }
    } catch {
      // ignore
    } finally {
      if (currentAddress) {
        void deregisterTokenFromIndexer(currentAddress);
      }
      await clearStoredSession();
      setWallet(EMPTY_WALLET);
      setState("disconnected");
    }
  }, [clearStoredSession, wallet.address, wallet.provider, walletKit]);

  const refresh = useCallback(async () => {
    await checkConnectionState();
  }, [checkConnectionState]);

  const value: WalletContextType = useMemo(
    () => ({
      state,
      wallet,
      network,
      error,
      connect,
      disconnect,
      refresh,
    }),
    [state, wallet, network, error, connect, disconnect, refresh]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWalletContext(): WalletContextType {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWalletContext must be used within a WalletProvider");
  return ctx;
}

export { WalletContext };
